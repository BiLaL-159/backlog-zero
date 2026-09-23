// Popup: a dumb UI that asks the background worker to do the real work.
// Shows the cached backlog on open; "Sync" re-fetches from YouTube.
import { isInBacklog } from "./lib/sync.ts";
import { timeAgo } from "./lib/grid.ts";
import type { Backlog, Message, Response, Settings } from "./lib/messages.ts";

const btn = document.getElementById("sync") as HTMLButtonElement;
const count = document.getElementById("count") as HTMLSpanElement;
const status = document.getElementById("status") as HTMLSpanElement;
const pause = document.getElementById("pause") as HTMLButtonElement;

let syncing = false;

// A slow cache read must not overwrite "Syncing…" once the user has clicked.
send({ type: "GET_BACKLOG" }, () => syncing);

btn.addEventListener("click", () => {
  status.textContent = "Syncing…";
  status.className = "";
  btn.disabled = syncing = true;
  send({ type: "SYNC" }, () => {
    btn.disabled = syncing = false;
  });
});

// Open youtube.com tabs pick the change up from storage and swap the feed in place.
let paused = false;
chrome.storage.local.get<Settings>("paused").then((s) => showPaused(!!s.paused));
pause.addEventListener("click", () => {
  showPaused(!paused);
  chrome.storage.local.set<Settings>({ paused });
});

function showPaused(value: boolean) {
  paused = value;
  pause.textContent = paused ? "Show my backlog on YouTube" : "Show YouTube's normal home";
}

// onReply runs before rendering; returning true skips the render.
function send(msg: Message, onReply?: () => boolean | void) {
  chrome.runtime.sendMessage(msg, (res?: Response) => {
    if (onReply?.()) return;
    if (chrome.runtime.lastError) return showError(chrome.runtime.lastError.message ?? "Unknown error");
    if (!res?.ok) return showError(res?.error || "Unknown error");
    render(res);
  });
}

function render({ videos = {}, playlists = [], lastSyncedAt, signInNeeded }: Backlog) {
  count.textContent = "";
  status.className = "";
  if (signInNeeded) {
    status.textContent = "Sign-in needed — click Sync to sign in again.";
    status.className = "error";
    return;
  }
  if (!lastSyncedAt) {
    status.textContent = "Not synced yet.";
    return;
  }
  const backlog = Object.values(videos).filter(isInBacklog);
  count.textContent = `${backlog.length} to watch`;
  status.textContent =
    `across ${playlists.length} playlist${playlists.length === 1 ? "" : "s"} · synced ${timeAgo(lastSyncedAt)}`;
}

function showError(msg: string) {
  count.textContent = "";
  status.textContent = msg;
  status.className = "error";
}
