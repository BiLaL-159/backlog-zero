# Backlog Zero

A Chrome extension that replaces YouTube's home feed with your own playlist backlog,
weighted so you actually watch it and the pile shrinks to zero.

## Status: step 2 — backlog synced to local storage
Zero-build MV3 extension. Signs in with Google (`youtube.readonly`), fetches every
video in your custom playlists (with durations), and merges them into a backlog in
`chrome.storage.local` without losing what you've marked. No bundler yet; Vite +
Preact arrive when we build the on-page grid (step 3).

## Getting started
See [`SETUP.md`](./SETUP.md) — one-time Google Cloud + OAuth setup, then load unpacked.

## Layout
```
manifest.json        MV3 manifest — permissions, OAuth scope, background worker, popup
src/
  background.js      service worker: holds the token, calls the API, answers messages
  popup.html/js      dumb UI: shows the cached backlog, "Sync" re-fetches
  lib/
    auth.js          chrome.identity token helpers
    youtube.js       read-only YouTube Data API v3 wrappers (playlists, items, durations)
    sync.js          pure merge of fresh YouTube data into the stored backlog
test/                node:test specs for the pure logic — run `npm test` (Node 18+)
```

## Roadmap (from the spec)
1. MV3 skeleton + sign-in + fetch playlists
2. **Normalize into `chrome.storage.local` model + cache/refresh** ← you are here
3. Content-script injection on youtube.com (Preact in Shadow DOM) — *add Vite here*
4. Weighted picker + hard filters
5. Actions: watched / snooze / keep + live grid updates
6. Filter tabs (All + per-playlist)
7. Manual refresh + `chrome.alarms` timer
