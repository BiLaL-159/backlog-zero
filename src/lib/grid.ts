// Pure helpers for the on-page grid. No chrome.* or DOM here, so it runs (and is
// tested) under Node.
import { isInBacklog, type Video, type VideoMap } from "./sync.ts";

// Every picker tunable, in one place.
export const PICKER = {
  // score = old × howOld + short × howShort + random × variety, each part in 0..1
  weights: { old: 0.4, short: 0.4, random: 0.2 },
  // Cards per page of the grid; scrolling near the bottom loads another page.
  gridSize: 12,
  // A video shown this recently sits out, while enough others remain to fill the grid.
  recentlyShownMs: 3 * 24 * 60 * 60 * 1000,
  // How long the Snooze action hides a video.
  snoozeMs: 7 * 24 * 60 * 60 * 1000,
  // The Kept shelf: the share of home page views that show it (0 = never, 1 =
  // every visit), and how many kept videos it holds.
  shelf: { chance: 0.25, size: 4 },
};

export interface Card extends Video {
  id: string;
}

export interface PickOptions {
  now: Date;
  n?: number;
  // 0..1 variety for one video (and the playlist order in the All view);
  // injectable so tests are deterministic.
  random?: (id: string) => number;
  // A playlist tab: pick from just this playlist's videos, ranked among
  // themselves. Omitted for the All view.
  playlist?: string;
}

// The videos the grid shows, best first. Hard filters drop anything watched,
// kept, archived, removed from YouTube or still snoozed; the rest are scored and
// the top n shown. Recently shown videos only fill in when the others run out,
// so a small backlog never leaves the grid empty.
//
// A playlist tab ranks that playlist's videos. The All view ranks each playlist
// on its own and deals from them in turn, so one playlist full of old saves
// can't crowd out the rest (a new playlist gets a card in the first round).
export function pickCards(
  videos: VideoMap,
  { now, n = PICKER.gridSize, random = () => Math.random(), playlist }: PickOptions
): Card[] {
  const eligible = Object.entries(videos)
    .filter(([, v]) => isInBacklog(v) && !isSnoozed(v, now))
    .filter(([, v]) => playlist == null || v.playlistIds.includes(playlist))
    .map(([id, v]): Card => ({ ...v, id }));

  if (playlist != null) {
    const { fresh, recent } = rank(eligible, now, random);
    return [...fresh, ...recent].slice(0, n);
  }

  // A video saved in several playlists deals from the first one.
  const groups = new Map<string, Card[]>();
  for (const card of eligible) {
    const key = card.playlistIds[0] ?? "";
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const ranked = [...groups]
    .sort(([a], [b]) => random(a) - random(b))
    .map(([, cards]) => rank(cards, now, random));
  return [...interleave(ranked.map((r) => r.fresh)), ...interleave(ranked.map((r) => r.recent))].slice(0, n);
}

// One pool's videos, best first, split into not-recently-shown and recently
// shown. Scored across the whole pool, so both parts share a scale.
function rank(cards: Card[], now: Date, random: (id: string) => number): { fresh: Card[]; recent: Card[] } {
  const howOld = ranks(cards.map((c) => -Date.parse(c.dateAdded)));
  const howShort = ranks(cards.map((c) => -c.durationSec));
  const { weights: w } = PICKER;
  const scored = cards
    .map((card, i) => ({
      card,
      score: w.old * howOld[i] + w.short * howShort[i] + w.random * random(card.id),
      recent: wasShownRecently(card, now),
    }))
    .sort((a, b) => b.score - a.score);
  return {
    fresh: scored.filter((s) => !s.recent).map((s) => s.card),
    recent: scored.filter((s) => s.recent).map((s) => s.card),
  };
}

// Round-robin: the first of each list, then the second of each, and so on.
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < lists.reduce((sum, l) => sum + l.length, 0); i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

// The cards to show after the pool changed (an action, a re-roll, a sync). Cards
// still in `ranked` keep their slot, a slot whose card left takes the best card
// not on screen, and leftover room fills from the end. With no previous slots
// it's just the top n.
export function fillSlots(prev: string[], ranked: Card[], n = PICKER.gridSize): Card[] {
  const byId = new Map(ranked.map((c) => [c.id, c]));
  const onScreen = new Set(prev.filter((id) => byId.has(id)));
  const spare = ranked.filter((c) => !onScreen.has(c.id));
  const slots = prev.map((id) => byId.get(id) ?? spare.shift()).filter((c) => c != null);
  return [...slots, ...spare].slice(0, n);
}

export interface ShelfOptions {
  now: Date;
  // 0..1, drawn once per page view; the shelf shows when it's under the chance.
  roll: number;
  n?: number;
  // 0..1 tie-break between videos never shown; injectable so tests are deterministic.
  random?: (id: string) => number;
}

// The Kept shelf for this page view: nothing on most visits (see PICKER.shelf),
// otherwise the kept videos shown least recently, so the shelf rotates through
// them. Kept videos never reach the grid (pickCards drops them), so the two
// never overlap.
export function pickShelf(
  videos: VideoMap,
  { now, roll, n = PICKER.shelf.size, random = () => Math.random() }: ShelfOptions
): Card[] {
  if (roll >= PICKER.shelf.chance) return [];
  // Like wasShownRecently, a stamp from this page view doesn't count, so a live
  // re-pick after a sync keeps the shelf it just stamped.
  const shownAt = (v: Video) =>
    v.lastShownAt != null && Date.parse(v.lastShownAt) < now.getTime() ? Date.parse(v.lastShownAt) : -Infinity;
  return Object.entries(videos)
    .filter(([, v]) => v.status === "kept" && !v.removedAt)
    .map(([id, v]) => ({ card: { ...v, id }, shownAt: shownAt(v), draw: random(id) }))
    .sort((a, b) => a.shownAt - b.shownAt || b.draw - a.draw)
    .slice(0, n)
    .map((s) => s.card);
}

function isSnoozed(video: Video, now: Date): boolean {
  return video.snoozedUntil != null && Date.parse(video.snoozedUntil) > now.getTime();
}

// Stamps at or after `now` come from this same page view (the grid picks, then
// stamps), so they don't count: a live re-pick keeps the cards already on screen.
function wasShownRecently(video: Video, now: Date): boolean {
  if (video.lastShownAt == null) return false;
  const ago = now.getTime() - Date.parse(video.lastShownAt);
  return ago > 0 && ago < PICKER.recentlyShownMs;
}

// Each value's place among all of them, 0 (smallest) → 1 (largest); ties share a
// place. Ranks rather than raw values, so one 4-hour podcast or one ancient save
// doesn't squash everything else together.
function ranks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const place = new Map<number, number>();
  sorted.forEach((v, i) => place.has(v) || place.set(v, i));
  return values.map((v) => (sorted.length > 1 ? place.get(v)! / (sorted.length - 1) : 1));
}

// ISO timestamp → "just now", "5 min ago", "2h ago", "3d ago".
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// View count → YouTube's wording: "1 view", "842 views", "1.2K views", "3.4M views".
// Truncated, not rounded, like YouTube (1,999 → "1.9K").
const compact = new Intl.NumberFormat("en", { notation: "compact", roundingMode: "trunc" });
export function formatViews(count: number): string {
  return count === 1 ? "1 view" : `${compact.format(count)} views`;
}

// Publish date → YouTube's wording: "3 hours ago", "1 day ago", "2 years ago".
// Each unit counts whole units elapsed, so 23 hours stays "23 hours ago".
const UNITS: [string, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];
export function publishedAgo(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso));
  for (const [unit, size] of UNITS) {
    const n = Math.floor(ms / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

// Seconds → YouTube-style timestamp: "0:45", "12:05", "1:02:03".
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
