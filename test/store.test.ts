import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { createStore, type BacklogStorage } from "../src/lib/store.ts";
import type { FetchedItem, Video } from "../src/lib/sync.ts";

// In-memory stand-in for chrome.storage.local. Like the real one, reads and
// writes each take a trip through the event loop, so unserialized
// read-modify-writes can interleave and clobber each other.
function memoryStorage(initial: Record<string, unknown> = {}): BacklogStorage {
  let data = structuredClone(initial);
  return {
    async get(keys) {
      await tick();
      return structuredClone(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])));
    },
    async set(items) {
      await tick();
      data = { ...data, ...structuredClone(items) };
    },
  };
}

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

test("a patched video reads back with the patch applied", async () => {
  const store = createStore(memoryStorage({ videos: { v1: video() } }));
  await store.patchVideo("v1", { status: "watched" });
  const { videos } = await store.read();
  assert.equal(videos?.v1.status, "watched");
  assert.equal(videos?.v1.title, "How to make pasta");
});

const NOW = "2026-09-23T12:00:00.000Z";
const PLAYLISTS = [{ id: "PLcooking", title: "Cooking", count: 1 }];
const fetched = (over: Partial<FetchedItem> = {}): FetchedItem => ({
  videoId: "v1",
  title: "How to make pasta (new title)",
  addedAt: "2025-01-10T08:00:00Z",
  playlistId: "PLcooking",
  durationSec: 600,
  ...over,
});

test("a patch made while a sync is writing is still there after the sync", async () => {
  const store = createStore(memoryStorage({ videos: { v1: video() } }));
  await Promise.all([
    store.patchVideo("v1", { lastShownAt: NOW }),
    store.applySync([fetched()], PLAYLISTS, NOW),
  ]);
  const { videos, lastSyncedAt } = await store.read();
  assert.equal(videos?.v1.lastShownAt, NOW);
  assert.equal(videos?.v1.title, "How to make pasta (new title)");
  assert.equal(lastSyncedAt, NOW);
});

test("a patch made while a sync is writing doesn't undo the sync", async () => {
  const store = createStore(memoryStorage({ videos: { v1: video() } }));
  await Promise.all([
    store.applySync([fetched(), fetched({ videoId: "v2", title: "Knife skills" })], PLAYLISTS, NOW),
    store.patchVideo("v1", { status: "watched" }),
  ]);
  const { videos } = await store.read();
  assert.equal(videos?.v1.status, "watched");
  assert.equal(videos?.v1.title, "How to make pasta (new title)");
  assert.equal(videos?.v2.title, "Knife skills");
});

test("a sync that starts after a patch sees the patched state", async () => {
  const store = createStore(memoryStorage({ videos: { v1: video() } }));
  await store.patchVideo("v1", { status: "kept", snoozedUntil: "2026-10-01T00:00:00Z" });
  const synced = await store.applySync([fetched()], PLAYLISTS, NOW);
  assert.equal(synced.videos.v1.status, "kept");
  assert.equal(synced.videos.v1.snoozedUntil, "2026-10-01T00:00:00Z");
});

test("patching a video that isn't stored changes nothing", async () => {
  const store = createStore(memoryStorage({ videos: { v1: video() } }));
  await store.patchVideo("nope", { status: "watched" });
  assert.deepEqual(await store.read(), { videos: { v1: video() } });
});

test("a failed write doesn't block the writes queued behind it", async () => {
  const storage = memoryStorage({ videos: { v1: video() } });
  const set = storage.set;
  let failNext = true;
  storage.set = async (items) => {
    if (failNext) {
      failNext = false;
      throw new Error("QUOTA_BYTES quota exceeded");
    }
    return set(items);
  };
  const store = createStore(storage);
  const [first, second] = await Promise.allSettled([
    store.patchVideo("v1", { status: "watched" }),
    store.patchVideo("v1", { lastShownAt: NOW }),
  ]);
  assert.equal(first.status, "rejected");
  assert.equal(second.status, "fulfilled");
  const { videos } = await store.read();
  assert.equal(videos?.v1.lastShownAt, NOW);
});
