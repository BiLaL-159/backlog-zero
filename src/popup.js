// Popup: a dumb UI that asks the background worker to do the real work.
// This is the fast feedback loop for step 1 — prove auth + fetch work before
// we ever touch youtube.com's DOM.
const btn = document.getElementById("signin");
const status = document.getElementById("status");
const list = document.getElementById("list");

btn.addEventListener("click", () => {
  status.textContent = "Signing in…";
  status.className = "muted";
  list.innerHTML = "";

  chrome.runtime.sendMessage({ type: "GET_PLAYLISTS" }, (res) => {
    if (chrome.runtime.lastError) {
      showError(chrome.runtime.lastError.message);
      return;
    }
    if (!res?.ok) {
      showError(res?.error || "Unknown error");
      return;
    }
    status.textContent = `${res.playlists.length} playlists:`;
    status.className = "muted";
    for (const p of res.playlists) {
      const li = document.createElement("li");
      li.textContent = `${p.title} (${p.count})`;
      list.appendChild(li);
    }
  });
});

function showError(msg) {
  status.textContent = "Error";
  status.className = "error";
  const li = document.createElement("li");
  li.className = "error";
  li.textContent = msg;
  list.appendChild(li);
}
