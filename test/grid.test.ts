import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCards, formatDuration } from "../src/lib/grid.ts";
import type { Video, VideoMap } from "../src/lib/sync.ts";

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

test("pickCards shows only unseen videos still saved on YouTube", () => {
  const videos: VideoMap = {
    a: video(),
    watched: video({ status: "watched" }),
    kept: video({ status: "kept" }),
    removed: video({ removedAt: "2026-01-01T00:00:00Z", playlistIds: [] }),
    b: video({ title: "Startup advice" }),
  };
  const cards = pickCards(videos, 10);
  assert.deepEqual(cards.map((c) => c.id), ["a", "b"]);
  assert.equal(cards[1].title, "Startup advice");
});

test("pickCards caps the grid at n cards", () => {
  const videos: VideoMap = { a: video(), b: video(), c: video() };
  assert.deepEqual(pickCards(videos, 2).map((c) => c.id), ["a", "b"]);
});

test("pickCards on an empty backlog is empty", () => {
  assert.deepEqual(pickCards({}, 10), []);
});

test("formatDuration matches YouTube's timestamps", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(725), "12:05");
  assert.equal(formatDuration(3723), "1:02:03");
  assert.equal(formatDuration(36000), "10:00:00");
});
