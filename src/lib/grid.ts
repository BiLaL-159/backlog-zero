// Pure helpers for the on-page grid. No chrome.* or DOM here, so it runs (and is
// tested) under Node.
import { isInBacklog, type Video, type VideoMap } from "./sync.ts";

// Every picker tunable, in one place.
export const PICKER = {
  // score = old × howOld + short × howShort + random × variety, each part in 0..1
  weights: { old: 0.4, short: 0.4, random: 0.2 },
  gridSize: 12,
  // A video shown this recently sits out, while enough others remain to fill the grid.
  recentlyShownMs: 3 * 24 * 60 * 60 * 1000,
};

export interface Card extends Video {
  id: string;
}

export interface PickOptions {
  now: Date;
  n?: number;
  // 0..1 variety for one video; injectable so tests are deterministic.
  random?: (id: string) => number;
}

// The videos the grid shows, best first. Hard filters drop anything watched,
// kept, archived, removed from YouTube or still snoozed; the rest are scored and
// the top n shown. Recently shown videos only fill in when the others run out,
// so a small backlog never leaves the grid empty.
export function pickCards(videos: VideoMap, { now, n = PICKER.gridSize, random = () => Math.random() }: PickOptions): Card[] {
  const eligible = Object.entries(videos)
    .filter(([, v]) => isInBacklog(v) && !isSnoozed(v, now))
    .map(([id, v]): Card => ({ ...v, id }));

  // Scored across every eligible video, so fresh and fallback cards share a scale.
  const howOld = ranks(eligible.map((c) => -Date.parse(c.dateAdded)));
  const howShort = ranks(eligible.map((c) => -c.durationSec));
  const { weights: w } = PICKER;
  const scored = eligible.map((card, i) => ({
    card,
    score: w.old * howOld[i] + w.short * howShort[i] + w.random * random(card.id),
    recent: wasShownRecently(card, now),
  }));

  const best = (list: typeof scored) => list.sort((a, b) => b.score - a.score).map((s) => s.card);
  return [...best(scored.filter((s) => !s.recent)), ...best(scored.filter((s) => s.recent))].slice(0, n);
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

// Seconds → YouTube-style timestamp: "0:45", "12:05", "1:02:03".
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
