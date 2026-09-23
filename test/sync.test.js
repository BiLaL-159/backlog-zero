import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, mergeBacklog, isInBacklog } from "../src/lib/sync.js";

test("parseDuration converts ISO 8601 durations to seconds", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT4M"), 240);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("P1DT1S"), 86401);
  assert.equal(parseDuration("P0D"), 0); // live streams
});

const NOW = "2026-09-23T12:00:00.000Z";

const item = (over = {}) => ({
  videoId: "v1",
  title: "How to make pasta",
  addedAt: "2025-01-10T08:00:00Z",
  playlistId: "PLcooking",
  durationSec: 600,
  ...over,
});

test("a newly saved video enters the backlog as unseen", () => {
  const videos = mergeBacklog({}, [item()], NOW);
  assert.deepEqual(videos, {
    v1: {
      title: "How to make pasta",
      durationSec: 600,
      playlistIds: ["PLcooking"],
      dateAdded: "2025-01-10T08:00:00Z",
      status: "unseen",
      snoozedUntil: null,
      lastShownAt: null,
      removedAt: null,
    },
  });
});

test("re-sync keeps the user's status, snooze and last-shown, but refreshes the title", () => {
  const prev = {
    v1: {
      title: "Old title",
      durationSec: 600,
      playlistIds: ["PLcooking"],
      dateAdded: "2025-01-10T08:00:00Z",
      status: "kept",
      snoozedUntil: "2026-10-01T00:00:00Z",
      lastShownAt: "2026-09-20T00:00:00Z",
      removedAt: null,
    },
  };
  const videos = mergeBacklog(prev, [item({ title: "New title" })], NOW);
  assert.equal(videos.v1.title, "New title");
  assert.equal(videos.v1.status, "kept");
  assert.equal(videos.v1.snoozedUntil, "2026-10-01T00:00:00Z");
  assert.equal(videos.v1.lastShownAt, "2026-09-20T00:00:00Z");
});

test("a video saved in two playlists is one record listing both, dated by its earliest save", () => {
  const videos = mergeBacklog(
    {},
    [
      item({ playlistId: "PLcooking", addedAt: "2025-03-01T00:00:00Z" }),
      item({ playlistId: "PLfavs", addedAt: "2024-06-01T00:00:00Z" }),
    ],
    NOW
  );
  assert.equal(Object.keys(videos).length, 1);
  assert.deepEqual(videos.v1.playlistIds, ["PLcooking", "PLfavs"]);
  assert.equal(videos.v1.dateAdded, "2024-06-01T00:00:00Z");
});

const stored = (over = {}) => ({
  title: "How to make pasta",
  durationSec: 600,
  playlistIds: ["PLcooking"],
  dateAdded: "2025-01-10T08:00:00Z",
  status: "kept",
  snoozedUntil: null,
  lastShownAt: null,
  removedAt: null,
  ...over,
});

test("a video no longer in any playlist is kept but marked removed, with its status intact", () => {
  const videos = mergeBacklog({ v1: stored() }, [], NOW);
  assert.equal(videos.v1.removedAt, NOW);
  assert.deepEqual(videos.v1.playlistIds, []);
  assert.equal(videos.v1.status, "kept");
});

test("a removed video keeps its original removal time on later syncs", () => {
  const prev = { v1: stored({ playlistIds: [], removedAt: "2026-09-01T00:00:00Z" }) };
  const videos = mergeBacklog(prev, [], NOW);
  assert.equal(videos.v1.removedAt, "2026-09-01T00:00:00Z");
});

test("a removed video that is saved again comes back with its old status", () => {
  const prev = { v1: stored({ playlistIds: [], removedAt: "2026-09-01T00:00:00Z" }) };
  const videos = mergeBacklog(prev, [item()], NOW);
  assert.equal(videos.v1.removedAt, null);
  assert.equal(videos.v1.status, "kept");
  assert.deepEqual(videos.v1.playlistIds, ["PLcooking"]);
});

test("deleted or private videos (no details from videos.list) are left out", () => {
  const videos = mergeBacklog(
    {},
    [item(), item({ videoId: "gone", title: "Private video", durationSec: null })],
    NOW
  );
  assert.deepEqual(Object.keys(videos), ["v1"]);
});

test("a stored video that turns private is marked removed", () => {
  const videos = mergeBacklog({ v1: stored() }, [item({ durationSec: null })], NOW);
  assert.equal(videos.v1.removedAt, NOW);
});

test("re-sync keeps fields it doesn't know about (added by later features)", () => {
  const videos = mergeBacklog({ v1: stored({ keptAt: "2026-09-10T00:00:00Z" }) }, [item()], NOW);
  assert.equal(videos.v1.keptAt, "2026-09-10T00:00:00Z");
});

test("isInBacklog: only unseen videos still saved on YouTube count", () => {
  assert.equal(isInBacklog(stored({ status: "unseen" })), true);
  assert.equal(isInBacklog(stored({ status: "watched" })), false);
  assert.equal(isInBacklog(stored({ status: "unseen", removedAt: NOW })), false);
});
