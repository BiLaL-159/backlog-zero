// Background service worker: the only place that holds the OAuth token and talks
// to the YouTube API. The popup (and later the content script) send it messages;
// it does the privileged work and sends data back.
import { getToken, removeCachedToken } from "./lib/auth.ts";
import { listMyPlaylists, listPlaylistItems, getVideoDurations, ApiError } from "./lib/youtube.ts";
import { mergeBacklog, parseDuration, type FetchedItem, type VideoMap } from "./lib/sync.ts";
import type { Backlog, Message, Response } from "./lib/messages.ts";

// chrome.storage.local layout (see Backlog in lib/messages.ts):
//   videos       videoId → { title, durationSec, playlistIds, dateAdded, status,
//                            snoozedUntil, lastShownAt, removedAt }
//   playlists    [{ id, title, count }]
//   lastSyncedAt ISO timestamp of the last successful sync
const STORAGE_KEYS: (keyof Backlog)[] = ["videos", "playlists", "lastSyncedAt"];

const handlers: Record<Message["type"], () => Promise<Backlog>> = {
  SYNC: syncBacklog,
  GET_BACKLOG: () => chrome.storage.local.get<Backlog>(STORAGE_KEYS),
};

chrome.runtime.onMessage.addListener(
  (msg: Message | undefined, _sender, sendResponse: (res: Response) => void) => {
    const handler = msg && handlers[msg.type];
    if (!handler) return;
    handler()
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the channel open for the async sendResponse
  }
);

// One sync at a time: a second request (popup click, later the alarm) joins the
// one already running instead of starting a parallel fetch.
let inFlight: Promise<Backlog> | null = null;
function syncBacklog(): Promise<Backlog> {
  inFlight ??= withToken(fetchAndStore).finally(() => (inFlight = null));
  return inFlight;
}

// Run fn(token); on a 401 drop the stale cached token and retry once.
async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getToken({ interactive: true });
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    await removeCachedToken(token);
    return fn(await getToken({ interactive: true }));
  }
}

// All-or-nothing: any API failure throws before we write, so a half-finished
// fetch can never mark the rest of the backlog as removed.
async function fetchAndStore(token: string): Promise<Required<Backlog>> {
  const playlists = await listMyPlaylists(token);
  const items = [];
  for (const p of playlists) items.push(...(await listPlaylistItems(token, p.id)));

  const durations = await getVideoDurations(token, [...new Set(items.map((it) => it.videoId))]);
  const fetched: FetchedItem[] = items.map((it) => ({
    ...it,
    durationSec: durations.has(it.videoId) ? parseDuration(durations.get(it.videoId)) : null,
  }));

  // Read the stored backlog only now, after the slow fetch, to shrink the window
  // in which a user action could be overwritten by a stale copy. It is still a
  // non-atomic read-modify-write; step 5's action writes must account for that.
  const { videos: prev = {} } = await chrome.storage.local.get<{ videos?: VideoMap }>("videos");
  const lastSyncedAt = new Date().toISOString();
  const videos = mergeBacklog(prev, fetched, lastSyncedAt);
  await chrome.storage.local.set({ videos, playlists, lastSyncedAt });
  console.log(`[Backlog Zero] synced ${Object.keys(videos).length} videos`);
  return { videos, playlists, lastSyncedAt };
}
