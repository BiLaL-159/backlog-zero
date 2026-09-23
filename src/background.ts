// Background service worker: the only place that holds the OAuth token and talks
// to the YouTube API. The popup and the content script send it messages;
// it does the privileged work and sends data back.
import { getToken, removeCachedToken } from "./lib/auth.ts";
import { listMyPlaylists, listPlaylistItems, getVideoDurations, ApiError } from "./lib/youtube.ts";
import { parseDuration, type FetchedItem } from "./lib/sync.ts";
import { createStore } from "./lib/store.ts";
import type { Backlog, Message, Response } from "./lib/messages.ts";

// Every read and write of the stored backlog goes through this one store, which
// serializes them (layout: Backlog in lib/messages.ts).
const store = createStore(chrome.storage.local);

type Handlers = { [T in Message["type"]]: (msg: Extract<Message, { type: T }>) => Promise<Backlog> };
const handlers: Handlers = {
  SYNC: () => syncBacklog({ interactive: true }), // the user clicked: showing sign-in is fine
  GET_BACKLOG: store.read,
  MARK_SHOWN: async ({ ids }) => {
    await store.markShown(ids, new Date().toISOString());
    return {};
  },
};

chrome.runtime.onMessage.addListener(
  (msg: Message | undefined, _sender, sendResponse: (res: Response) => void) => {
    const handler = msg && (handlers[msg.type] as ((msg: Message) => Promise<Backlog>) | undefined);
    if (!handler) return;
    handler(msg)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the channel open for the async sendResponse
  }
);

// Background sync every ~6h. Chrome can drop alarms on a browser restart or an
// extension update, so re-create it whenever the worker starts and it's missing.
const SYNC_ALARM = "sync";
chrome.alarms.get(SYNC_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 6 * 60 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  syncBacklog({ interactive: false }).catch((err: Error) => {
    // No token is flagged in storage for the popup/grid; just wait for the next alarm.
    if (err instanceof SignInNeeded) console.log("[Backlog Zero] background sync skipped: sign-in needed");
    else console.warn("[Backlog Zero] background sync failed:", err.message);
  });
});

// One sync at a time: a second request (popup, grid, alarm) joins the one
// already running instead of starting a parallel fetch.
let inFlight: Promise<Backlog> | null = null;
function syncBacklog({ interactive }: { interactive: boolean }): Promise<Backlog> {
  inFlight ??= withToken(fetchAndStore, interactive).finally(() => (inFlight = null));
  return inFlight;
}

// Run fn(token); on a 401 drop the stale cached token and retry once.
async function withToken<T>(fn: (token: string) => Promise<T>, interactive: boolean): Promise<T> {
  const token = await signIn(interactive);
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    await removeCachedToken(token);
    return fn(await signIn(interactive));
  }
}

class SignInNeeded extends Error {
  constructor() {
    super("Sign-in needed");
  }
}

// Non-interactive (the alarm) never opens Google's consent screen: with no
// cached token it flags the backlog as needing sign-in and gives up.
async function signIn(interactive: boolean): Promise<string> {
  try {
    return await getToken({ interactive });
  } catch (err) {
    if (interactive) throw err;
    await store.flagSignInNeeded();
    throw new SignInNeeded();
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
