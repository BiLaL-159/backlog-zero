// The only writer of the stored backlog (chrome.storage.local, layout in Backlog in
// messages.ts). The background worker owns the one instance; everything else asks
// it by message. Storage is injected so this runs (and is tested) under Node.
import type { Backlog } from "./messages.ts";
import type { Playlist } from "./youtube.ts";
import { mergeBacklog, type FetchedItem, type Video } from "./sync.ts";

const KEYS: (keyof Backlog)[] = ["videos", "playlists", "lastSyncedAt"];

// The slice of chrome.storage.local we use.
export interface BacklogStorage {
  get(keys: (keyof Backlog)[]): Promise<Backlog>;
  set(items: Backlog): Promise<void>;
}

export function createStore(storage: BacklogStorage) {
  // Every operation queues behind the previous one, so each read-modify-write
  // sees the result of the last and a sync can't overwrite a user's change (or
  // vice versa). Keep slow work (API fetches) outside: it would stall the queue.
  let tail: Promise<unknown> = Promise.resolve();
  function serialized<T>(op: () => Promise<T>): Promise<T> {
    const run = tail.then(op);
    tail = run.catch(() => {}); // one failed write mustn't block the rest
    return run;
  }

  // Queued too, so a read issued after a write sees it.
  function read(): Promise<Backlog> {
    return serialized(() => storage.get(KEYS));
  }

  // Merge fields into one stored video (e.g. status, lastShownAt). A video that
  // isn't stored is left alone.
  function patchVideo(id: string, patch: Partial<Video>): Promise<void> {
    return serialized(async () => {
      const { videos = {} } = await storage.get(["videos"]);
      const video = videos[id];
      if (!video) return;
      await storage.set({ videos: { ...videos, [id]: { ...video, ...patch } } });
    });
  }

  // Merge one full YouTube fetch into whatever is stored at this moment.
  function applySync(fetched: FetchedItem[], playlists: Playlist[], now: string): Promise<Required<Backlog>> {
    return serialized(async () => {
      const { videos: prev = {} } = await storage.get(["videos"]);
      const next = { videos: mergeBacklog(prev, fetched, now), playlists, lastSyncedAt: now };
      await storage.set(next);
      return next;
    });
  }

  return { read, patchVideo, applySync };
}
