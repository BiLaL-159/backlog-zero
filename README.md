# Backlog Zero

A Chrome extension that replaces YouTube's home feed with your own playlist backlog,
weighted so you actually watch it and the pile shrinks to zero.

## Status: step 2 — backlog synced to local storage
MV3 extension written in TypeScript. Signs in with Google (`youtube.readonly`), fetches every
video in your custom playlists (with durations), and merges them into a backlog in
`chrome.storage.local` without losing what you've marked. Vite bundles `src/` into
`dist/`: the popup and background worker as ES modules, the content script as a classic
script (MV3 content scripts can't be modules). Preact is set up for the on-page grid (step 3).

```
npm install
npm run build      # bundle src/ → dist/ with Vite
npm run watch      # rebuild dist/ on every save (still reload the extension in Chrome)
npm run typecheck  # type-check src + tests (Vite strips types without checking them)
npm test           # Node runs the .ts tests directly (Node 23.6+)
```

## Getting started
See [`SETUP.md`](./SETUP.md) — one-time Google Cloud + OAuth setup, then load unpacked.

## Layout
```
manifest.json        MV3 manifest — permissions, OAuth scope, background worker, popup, content script
vite.config.ts       build: pages + worker pass, then a classic-script pass for the content script
src/
  background.ts      service worker: holds the token, calls the API, answers messages
  popup.html/ts      dumb UI: shows the cached backlog, "Sync" re-fetches
  content.tsx        content script on youtube.com (stub until the grid lands)
  lib/
    auth.ts          chrome.identity token helpers
    youtube.ts       read-only YouTube Data API v3 wrappers (playlists, items, durations)
    sync.ts          backlog data model + pure merge of fresh YouTube data into it
    store.ts         the one serialized path for reading/writing the stored backlog
    messages.ts      popup ↔ background message and storage types
dist/                bundled output that the manifest loads (git-ignored; `npm run build`)
test/                node:test specs for the pure logic — run `npm test` (Node 23.6+)
```

## Roadmap (from the spec)
1. MV3 skeleton + sign-in + fetch playlists
2. **Normalize into `chrome.storage.local` model + cache/refresh** ← you are here
3. Content-script injection on youtube.com (Preact in Shadow DOM)
4. Weighted picker + hard filters
5. Actions: watched / snooze / keep + live grid updates
6. Filter tabs (All + per-playlist)
7. Manual refresh + `chrome.alarms` timer
