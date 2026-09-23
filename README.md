# Backlog Zero

A Chrome extension that replaces YouTube's home feed with your own playlist backlog,
weighted so you actually watch it and the pile shrinks to zero.

## Status: step 1 skeleton
Zero-build MV3 extension. Signs in with Google (`youtube.readonly`) and fetches your
custom playlists — the foundation everything else builds on. No bundler yet; Vite +
Preact arrive when we build the on-page grid (step 3).

## Getting started
See [`SETUP.md`](./SETUP.md) — one-time Google Cloud + OAuth setup, then load unpacked.

## Layout
```
manifest.json        MV3 manifest — permissions, OAuth scope, background worker, popup
src/
  background.js      service worker: holds the token, calls the API, answers messages
  popup.html/js      dumb UI to trigger sign-in and list playlists (fast feedback loop)
  lib/
    auth.js          chrome.identity token helpers
    youtube.js       read-only YouTube Data API v3 wrappers (playlists, playlist items)
```

## Roadmap (from the spec)
1. **MV3 skeleton + sign-in + fetch playlists** ← you are here
2. Normalize into `chrome.storage.local` model + cache/refresh
3. Content-script injection on youtube.com (Preact in Shadow DOM) — *add Vite here*
4. Weighted picker + hard filters
5. Actions: watched / snooze / keep + live grid updates
6. Filter tabs (All + per-playlist)
7. Manual refresh + `chrome.alarms` timer
