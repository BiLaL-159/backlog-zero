// Background service worker: the only place that holds the OAuth token and talks
// to the YouTube API. The popup (and later the content script) send it messages;
// it does the privileged work and sends data back.
import { getToken, removeCachedToken } from "./lib/auth.ts";
import { listMyPlaylists, listPlaylistItems, getVideoDurations, ApiError } from "./lib/youtube.ts";
import { parseDuration, type FetchedItem } from "./lib/sync.ts";
import { createStore } from "./lib/store.ts";
import type { Backlog, Message, Response } from "./lib/messages.ts";

// Every read and write of the stored backlog goes through this one store, which
// serializes them (layout: Backlog in lib/messages.ts).
const store = createStore(chrome.storage.local);

const handlers: Record<Message["type"], () => Promise<Backlog>> = {
  SYNC: syncBacklog,
  GET_BACKLOG: store.read,
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

  // The slow fetch is done; the merge runs in the store's queue against whatever
  // is stored by then, so user changes made during the fetch survive.
  const synced = await store.applySync(fetched, playlists, new Date().toISOString());
  console.log(`[Backlog Zero] synced ${Object.keys(synced.videos).length} videos`);
  return synced;
}
