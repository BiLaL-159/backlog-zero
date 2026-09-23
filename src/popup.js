// Popup: a dumb UI that asks the background worker to do the real work.
// Shows the cached backlog on open; "Sync" re-fetches from YouTube.
import { isInBacklog } from "./lib/sync.js";

const btn = document.getElementById("sync");
const status = document.getElementById("status");
const list = document.getElementById("list");

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
function send(msg, onReply) {
  chrome.runtime.sendMessage(msg, (res) => {
    if (onReply?.()) return;
    if (chrome.runtime.lastError) return showError(chrome.runtime.lastError.message);
    if (!res?.ok) return showError(res?.error || "Unknown error");
    render(res);
  });
}

function render({ videos = {}, playlists = [], lastSyncedAt }) {
  list.innerHTML = "";
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

function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function showError(msg) {
  status.textContent = "Error";
  status.className = "error";
  list.innerHTML = "";
  const li = document.createElement("li");
  li.className = "error";
  li.textContent = msg;
  list.appendChild(li);
}
