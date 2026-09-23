import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCards, fillSlots, pickShelf, formatDuration, formatViews, publishedAgo, timeAgo, PICKER, type Card } from "../src/lib/grid.ts";
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

test("a playlist tab picks only that playlist's videos", () => {
  const videos: VideoMap = {
    pasta: video({ playlistIds: ["PLcooking"] }),
    pitch: video({ playlistIds: ["PLstartups"] }),
    watched: video({ playlistIds: ["PLcooking"], status: "watched" }),
  };
  assert.deepEqual(pickCards(videos, { now: NOW, playlist: "PLcooking" }).map((c) => c.id), ["pasta"]);
  assert.deepEqual(pick(videos).sort(), ["pasta", "pitch"]);
});

test("a video saved in several playlists is eligible under each tab", () => {
  const videos: VideoMap = { both: video({ playlistIds: ["PLcooking", "PLstartups"] }) };
  for (const playlist of ["PLcooking", "PLstartups"]) {
    assert.deepEqual(pickCards(videos, { now: NOW, playlist }).map((c) => c.id), ["both"]);
  }
});

test("an empty playlist tab picks nothing", () => {
  assert.deepEqual(pickCards({ a: video() }, { now: NOW, playlist: "PLempty" }), []);
});

// A roll under the chance shows the shelf; one at or over it hides it.
const SHOW = 0;
const shelf = (videos: VideoMap, roll = SHOW, n?: number, random: (id: string) => number = () => 0) =>
  pickShelf(videos, { now: NOW, roll, n, random }).map((c) => c.id);

test("the shelf holds only kept videos", () => {
  const videos: VideoMap = {
    unseen: video(),
    watched: video({ status: "watched" }),
    kept: video({ status: "kept" }),
    archived: video({ status: "archived" }),
  };
  assert.deepEqual(shelf(videos), ["kept"]);
});

test("kept videos never appear in the backlog grid", () => {
  const videos: VideoMap = { a: video(), kept: video({ status: "kept" }) };
  assert.deepEqual(pick(videos), ["a"]);
  assert.deepEqual(pickCards(videos, { now: NOW, playlist: "PLcooking" }).map((c) => c.id), ["a"]);
});

test("the shelf shows only when the page view's roll is under the tunable chance", () => {
  const videos: VideoMap = { kept: video({ status: "kept" }) };
  const { chance } = PICKER.shelf;
  assert.deepEqual(shelf(videos, chance - 0.01), ["kept"]);
  assert.deepEqual(shelf(videos, chance), []);
  assert.deepEqual(shelf(videos, 0.99), []);
});

test("the shelf chance is a share of page views, strictly between never and always", () => {
  const { chance } = PICKER.shelf;
  assert.ok(chance > 0 && chance < 1);
});

test("with no kept videos there is no shelf", () => {
  assert.deepEqual(shelf({ a: video(), w: video({ status: "watched" }) }), []);
  assert.deepEqual(shelf({}), []);
});

test("a kept video removed from YouTube leaves the shelf", () => {
  const videos: VideoMap = { kept: video({ status: "kept" }), gone: video({ status: "kept", removedAt: daysAgo(1), playlistIds: [] }) };
  assert.deepEqual(shelf(videos), ["kept"]);
});

test("the shelf rotates: never-shown first, then the longest since shown", () => {
  const videos: VideoMap = {
    yesterday: video({ status: "kept", lastShownAt: daysAgo(1) }),
    lastMonth: video({ status: "kept", lastShownAt: daysAgo(30) }),
    never: video({ status: "kept" }),
    lastWeek: video({ status: "kept", lastShownAt: daysAgo(7) }),
  };
  assert.deepEqual(shelf(videos, SHOW, 3), ["never", "lastMonth", "lastWeek"]);
});

test("never-shown kept videos are ordered by the random draw", () => {
  const videos: VideoMap = { a: video({ status: "kept" }), b: video({ status: "kept" }) };
  assert.deepEqual(shelf(videos, SHOW, 2, (id) => (id === "b" ? 1 : 0)), ["b", "a"]);
});

test("the shelf is capped at its size", () => {
  const videos: VideoMap = {};
  for (let i = 0; i < 10; i++) videos[`k${i}`] = video({ status: "kept" });
  assert.equal(shelf(videos).length, PICKER.shelf.size);
});

test("stamps from this page view keep the shelf's cards on a live re-pick", () => {
  const later = new Date(NOW.getTime() + 60_000).toISOString();
  const videos: VideoMap = {
    onShelf: video({ status: "kept", lastShownAt: later }),
    lastMonth: video({ status: "kept", lastShownAt: daysAgo(30) }),
  };
  assert.deepEqual(shelf(videos, SHOW, 1), ["onShelf"]);
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

test("formatViews matches YouTube's view counts", () => {
  assert.equal(formatViews(0), "0 views");
  assert.equal(formatViews(1), "1 view");
  assert.equal(formatViews(842), "842 views");
  assert.equal(formatViews(1999), "1.9K views");
  assert.equal(formatViews(12_345), "12K views");
  assert.equal(formatViews(3_456_789), "3.4M views");
  assert.equal(formatViews(1_200_000_000), "1.2B views");
});

test("publishedAgo counts whole units, like YouTube", () => {
  const now = NOW.getTime();
  assert.equal(publishedAgo(NOW.toISOString(), now), "just now");
  assert.equal(publishedAgo(new Date(now - 90 * 60_000).toISOString(), now), "1 hour ago");
  assert.equal(publishedAgo(new Date(now - 23 * 3600_000).toISOString(), now), "23 hours ago");
  assert.equal(publishedAgo(daysAgo(1), now), "1 day ago");
  assert.equal(publishedAgo(daysAgo(13), now), "1 week ago");
  assert.equal(publishedAgo(daysAgo(65), now), "2 months ago");
  assert.equal(publishedAgo(daysAgo(800), now), "2 years ago");
});

test("the All view deals from each playlist in turn, so one playlist can't crowd out the rest", () => {
  const videos: VideoMap = {
    old1: video({ playlistIds: ["PLweb3"], dateAdded: "2021-01-01T00:00:00Z" }),
    old2: video({ playlistIds: ["PLweb3"], dateAdded: "2021-02-01T00:00:00Z" }),
    old3: video({ playlistIds: ["PLweb3"], dateAdded: "2021-03-01T00:00:00Z" }),
    fresh: video({ playlistIds: ["PLnew"], dateAdded: daysAgo(1) }),
  };
  assert.deepEqual(pick(videos, 2).sort(), ["fresh", "old1"]);
  assert.deepEqual(pick(videos).sort(), ["fresh", "old1", "old2", "old3"]);
});

test("each playlist keeps its own order within the All view", () => {
  const videos: VideoMap = {
    a2: video({ playlistIds: ["PLa"], dateAdded: daysAgo(10) }),
    a1: video({ playlistIds: ["PLa"], dateAdded: daysAgo(100) }),
    b1: video({ playlistIds: ["PLb"], dateAdded: daysAgo(50) }),
  };
  const ids = pick(videos);
  assert.ok(ids.indexOf("a1") < ids.indexOf("a2"));
  assert.ok(ids.indexOf("b1") < ids.indexOf("a2"));
});

test("in the All view, recently shown videos still come after every fresh one", () => {
  const videos: VideoMap = {
    seen: video({ playlistIds: ["PLa"], lastShownAt: daysAgo(1), dateAdded: "2020-01-01T00:00:00Z" }),
    b1: video({ playlistIds: ["PLb"] }),
    b2: video({ playlistIds: ["PLb"] }),
  };
  assert.equal(pick(videos).at(-1), "seen");
});

test("a video in several playlists appears once in the All view", () => {
  const videos: VideoMap = { both: video({ playlistIds: ["PLa", "PLb"] }), b: video({ playlistIds: ["PLb"] }) };
  assert.deepEqual(pick(videos).sort(), ["b", "both"]);
});
