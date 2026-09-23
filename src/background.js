// Background service worker: the only place that holds the OAuth token and talks
// to the YouTube API. The popup (and later the content script) send it messages;
// it does the privileged work and sends data back.
import { getToken } from "./lib/auth.js";
import { listMyPlaylists } from "./lib/youtube.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_PLAYLISTS") {
    handleGetPlaylists()
      .then((playlists) => sendResponse({ ok: true, playlists }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the channel open for the async sendResponse
  }
});

async function handleGetPlaylists() {
  const token = await getToken({ interactive: true });
  const playlists = await listMyPlaylists(token);
  console.log("[Backlog Zero] playlists:", playlists);
  return playlists;
}
