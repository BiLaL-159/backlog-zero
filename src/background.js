// Background service worker: the only place that holds the OAuth token and talks
// to the YouTube API. The popup (and later the content script) send it messages;
// it does the privileged work and sends data back.
import { getToken, removeCachedToken } from "./lib/auth.js";
import { listMyPlaylists, listPlaylistItems, getVideoDurations } from "./lib/youtube.js";
import { mergeBacklog, parseDuration } from "./lib/sync.js";

// chrome.storage.local layout:
//   videos       videoId → { title, durationSec, playlistIds, dateAdded, status,
//                            snoozedUntil, lastShownAt, removedAt }
//   playlists    [{ id, title, count }]
//   lastSyncedAt ISO timestamp of the last successful sync
const STORAGE_KEYS = ["videos", "playlists", "lastSyncedAt"];

const handlers = {
  SYNC: syncBacklog,
  GET_BACKLOG: () => chrome.storage.local.get(STORAGE_KEYS),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return;
  handler()
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // keep the channel open for the async sendResponse
});

// One sync at a time: a second request (popup click, later the alarm) joins the
// one already running instead of starting a parallel fetch.
let inFlight = null;
function syncBacklog() {
  inFlight ??= withToken(fetchAndStore).finally(() => (inFlight = null));
  return inFlight;
}

// Run fn(token); on a 401 drop the stale cached token and retry once.
async function withToken(fn) {
  const token = await getToken({ interactive: true });
  try {
    return await fn(token);
  } catch (err) {
    if (err.status !== 401) throw err;
    await removeCachedToken(token);
    return fn(await getToken({ interactive: true }));
  }
}

// All-or-nothing: any API failure throws before we write, so a half-finished
// fetch can never mark the rest of the backlog as removed.
async function fetchAndStore(token) {
  const playlists = await listMyPlaylists(token);
  const items = [];
  for (const p of playlists) items.push(...(await listPlaylistItems(token, p.id)));

  const durations = await getVideoDurations(token, [...new Set(items.map((it) => it.videoId))]);
  const fetched = items.map((it) => ({
    ...it,
    durationSec: durations.has(it.videoId) ? parseDuration(durations.get(it.videoId)) : null,
  }));

  // Read the stored backlog only now, after the slow fetch, to shrink the window
  // in which a user action could be overwritten by a stale copy. It is still a
  // non-atomic read-modify-write; step 5's action writes must account for that.
  const { videos: prev = {} } = await chrome.storage.local.get("videos");
  const lastSyncedAt = new Date().toISOString();
  const videos = mergeBacklog(prev, fetched, lastSyncedAt);
  await chrome.storage.local.set({ videos, playlists, lastSyncedAt });
  console.log(`[Backlog Zero] synced ${Object.keys(videos).length} videos`);
  return { videos, playlists, lastSyncedAt };
}
