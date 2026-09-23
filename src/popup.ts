// Popup: a dumb UI that asks the background worker to do the real work.
// Shows the cached backlog on open; "Sync" re-fetches from YouTube.
import { isInBacklog } from "./lib/sync.ts";
import { timeAgo } from "./lib/grid.ts";
import type { Backlog, Message, Response } from "./lib/messages.ts";

const btn = document.getElementById("sync") as HTMLButtonElement;
const count = document.getElementById("count") as HTMLSpanElement;
const status = document.getElementById("status") as HTMLSpanElement;
const list = document.getElementById("list") as HTMLUListElement;

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
  for (const p of playlists) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = p.title;
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(backlog.filter((v) => v.playlistIds.includes(p.id)).length);
    li.append(name, n);
    list.appendChild(li);
  }
}

function showError(msg: string) {
  list.innerHTML = "";
  count.textContent = "";
  status.textContent = msg;
  status.className = "error";
}
