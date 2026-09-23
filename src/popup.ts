// Popup: a dumb UI that asks the background worker to do the real work.
// Shows the cached backlog on open; "Sync" re-fetches from YouTube.
import { isInBacklog } from "./lib/sync.ts";
import { timeAgo } from "./lib/grid.ts";
import type { Backlog, Message, Response } from "./lib/messages.ts";

const btn = document.getElementById("sync") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;
const list = document.getElementById("list") as HTMLUListElement;

let syncing = false;

// A slow cache read must not overwrite "Syncing…" once the user has clicked.
send({ type: "GET_BACKLOG" }, () => syncing);

btn.addEventListener("click", () => {
  status.textContent = "Syncing…";
  status.className = "muted";
  btn.disabled = syncing = true;
  send({ type: "SYNC" }, () => {
    btn.disabled = syncing = false;
  });
});

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
  list.innerHTML = "";
  if (signInNeeded) {
    status.textContent = "Sign-in needed — click Sync to sign in again.";
    status.className = "error";
    return;
  }
  if (!lastSyncedAt) {
    status.textContent = "Not synced yet.";
    status.className = "muted";
    return;
  }
  const backlog = Object.values(videos).filter(isInBacklog);
  status.textContent =
    `${backlog.length} videos to watch across ${playlists.length} playlists · ` +
    `synced ${timeAgo(lastSyncedAt)}`;
  status.className = "muted";
  for (const p of playlists) {
    const n = backlog.filter((v) => v.playlistIds.includes(p.id)).length;
    const li = document.createElement("li");
    li.textContent = `${p.title} (${n})`;
    list.appendChild(li);
  }
}

function showError(msg: string) {
  status.textContent = "Error";
  status.className = "error";
  list.innerHTML = "";
  const li = document.createElement("li");
  li.className = "error";
  li.textContent = msg;
  list.appendChild(li);
}
