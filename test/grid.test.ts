import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCards, fillSlots, formatDuration, timeAgo, PICKER, type Card } from "../src/lib/grid.ts";
import type { Video, VideoMap } from "../src/lib/sync.ts";

const NOW = new Date("2026-09-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const inDays = (d: number) => daysAgo(-d);

const video = (over: Partial<Video> = {}): Video => ({
  title: "How to make pasta",
  durationSec: 600,
  playlistIds: ["PLcooking"],
  dateAdded: "2025-01-10T08:00:00Z",
  status: "unseen",
  snoozedUntil: null,
  lastShownAt: null,
  removedAt: null,
  ...over,
});

// No variety unless a test asks for it, so the order is deterministic.
const pick = (videos: VideoMap, n = 10, random: (id: string) => number = () => 0) =>
  pickCards(videos, { now: NOW, n, random }).map((c) => c.id);

test("older saves rank higher", () => {
  const videos = { mid: video({ dateAdded: daysAgo(30) }), old: video({ dateAdded: daysAgo(300) }), new: video({ dateAdded: daysAgo(1) }) };
  assert.deepEqual(pick(videos), ["old", "mid", "new"]);
});

test("shorter videos rank higher", () => {
  const videos = { mid: video({ durationSec: 1200 }), long: video({ durationSec: 7200 }), short: video({ durationSec: 90 }) };
  assert.deepEqual(pick(videos), ["short", "mid", "long"]);
});

test("old-and-short beats one-or-the-other beats neither", () => {
  const videos = {
    neither: video({ dateAdded: daysAgo(1), durationSec: 7200 }),
    oldOnly: video({ dateAdded: daysAgo(300), durationSec: 7200 }),
    both: video({ dateAdded: daysAgo(300), durationSec: 90 }),
  };
  assert.deepEqual(pick(videos), ["both", "oldOnly", "neither"]);
});

test("the random part adds variety without overriding age and length", () => {
  const videos = {
    a: video({ dateAdded: daysAgo(300) }),
    b: video({ dateAdded: daysAgo(299) }),
    c: video({ dateAdded: daysAgo(100) }),
    d: video({ dateAdded: daysAgo(1), durationSec: 7200 }),
  };
  // Lucky b overtakes a's small age lead; d is so new and long that luck can't save it.
  const lucky = (id: string) => (id === "b" || id === "d" ? 1 : 0);
  assert.deepEqual(pick(videos, 10, lucky), ["b", "a", "c", "d"]);
});

test("the score weights sum to 1", () => {
  const { old, short, random } = PICKER.weights;
  assert.equal(old + short + random, 1);
});

test("watched, kept, archived and removed videos never appear", () => {
  const videos: VideoMap = {
    a: video(),
    watched: video({ status: "watched" }),
    kept: video({ status: "kept" }),
    archived: video({ status: "archived" }),
    removed: video({ removedAt: daysAgo(2), playlistIds: [] }),
  };
  assert.deepEqual(pick(videos), ["a"]);
});

test("a snoozed video stays hidden until its snooze ends", () => {
  const videos: VideoMap = { a: video(), snoozed: video({ snoozedUntil: inDays(2) }), woke: video({ snoozedUntil: daysAgo(1) }) };
  assert.deepEqual(pick(videos).sort(), ["a", "woke"]);
});

test("recently shown videos sit out while enough others remain", () => {
  const videos: VideoMap = {
    shownToday: video({ lastShownAt: daysAgo(0.1) }),
    shownLongAgo: video({ lastShownAt: daysAgo(30) }),
    a: video(),
    b: video(),
  };
  assert.deepEqual(pick(videos, 3).sort(), ["a", "b", "shownLongAgo"]);
});

test("stamps from this page view (at or after now) don't count as recently shown", () => {
  // A live re-pick after a sync must keep the cards the grid just stamped.
  const later = new Date(NOW.getTime() + 60_000).toISOString();
  const videos: VideoMap = { onScreen: video({ lastShownAt: later }), shownYesterday: video({ lastShownAt: daysAgo(1) }) };
  assert.deepEqual(pick(videos, 1), ["onScreen"]);
});

test("a small backlog fills the grid from recently shown videos instead of going empty", () => {
  const videos: VideoMap = {
    shownOld: video({ lastShownAt: daysAgo(1), dateAdded: daysAgo(300) }),
    shownNew: video({ lastShownAt: daysAgo(1), dateAdded: daysAgo(1) }),
    fresh: video({ dateAdded: daysAgo(1) }),
  };
  // The fresh video still leads, then the recently shown ones by score.
  assert.deepEqual(pick(videos, 3), ["fresh", "shownOld", "shownNew"]);
  assert.deepEqual(pick({ only: video({ lastShownAt: daysAgo(0.1) }) }), ["only"]);
});

test("the grid is capped at n cards, keeping the best", () => {
  const videos: VideoMap = {};
  for (let i = 1; i <= 30; i++) videos[`v${i}`] = video({ dateAdded: daysAgo(i) });
  assert.equal(pickCards(videos, { now: NOW }).length, PICKER.gridSize);
  assert.deepEqual(pick(videos, 2), ["v30", "v29"]);
});

test("cards carry the video's id and fields", () => {
  const [card] = pickCards({ a: video({ title: "Startup advice" }) }, { now: NOW });
  assert.equal(card.id, "a");
  assert.equal(card.title, "Startup advice");
});

test("an empty backlog picks nothing", () => {
  assert.deepEqual(pick({}), []);
});

const cards = (...ids: string[]): Card[] => ids.map((id) => ({ ...video(), id }));
const ids = (list: Card[]) => list.map((c) => c.id);

test("fillSlots with no previous cards shows the top n", () => {
  assert.deepEqual(ids(fillSlots([], cards("a", "b", "c", "d"), 3)), ["a", "b", "c"]);
});

test("a card that leaves is replaced in its own slot by the best card not on screen", () => {
  // b was acted on; d is the best of the rest, so it takes b's slot.
  assert.deepEqual(ids(fillSlots(["a", "b", "c"], cards("a", "c", "d", "e"), 3)), ["a", "d", "c"]);
});

test("cards still on screen keep their slots even if they'd rank differently now", () => {
  assert.deepEqual(ids(fillSlots(["a", "b", "c"], cards("c", "b", "a"), 3)), ["a", "b", "c"]);
});

test("with nothing left to backfill the grid shrinks instead of leaving a hole", () => {
  assert.deepEqual(ids(fillSlots(["a", "b", "c"], cards("a", "c"), 3)), ["a", "c"]);
});

test("new room (e.g. a sync added videos) fills from the end", () => {
  assert.deepEqual(ids(fillSlots(["a"], cards("x", "a", "y"), 3)), ["a", "x", "y"]);
});

test("formatDuration matches YouTube's timestamps", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(725), "12:05");
  assert.equal(formatDuration(3723), "1:02:03");
  assert.equal(formatDuration(36000), "10:00:00");
});

test("timeAgo rounds to minutes, hours, then days", () => {
  const now = NOW.getTime();
  assert.equal(timeAgo(NOW.toISOString(), now), "just now");
  assert.equal(timeAgo(new Date(now - 5 * 60_000).toISOString(), now), "5 min ago");
  assert.equal(timeAgo(new Date(now - 2 * 3600_000).toISOString(), now), "2h ago");
  assert.equal(timeAgo(daysAgo(3), now), "3d ago");
});
