# Backlog Zero

**Replace YouTube's home feed with your own playlist backlog — so you actually watch it.**

Backlog Zero is a Chrome extension for people whose "save for later" playlists only ever
grow. Open youtube.com and, instead of recommendations, you get a grid of videos you already
chose to watch, weighted toward the ones that have waited longest and take the least time.
Mark them watched, snooze or keep them, and watch the pile shrink to zero.

<!-- Demo video: drag the .mp4 into this README on github.com and GitHub inserts the link here. -->

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Project structure](#project-structure)
- [Privacy](#privacy)
- [Contributing](#contributing)

---

## Features

- **Your backlog instead of recommendations.** The home feed on youtube.com is hidden and
  replaced by a grid of videos from your own playlists. Everything else on YouTube works as normal.
- **A weighted pick, not a list.** Older and shorter videos come up first, with a dash of
  randomness so the grid doesn't look the same every visit. The **All** view deals from each
  playlist in turn, so one huge playlist can't crowd out the rest.
- **One-click card actions.** Hover a card for **Watched**, **Snooze** (7 days), **Keep** and
  **Re-roll**. The card leaves at once and the next pick takes its slot.
- **Playlist tabs.** Filter the grid to a single playlist.
- **"Worth a rewatch" shelf.** Videos you've kept turn up now and then, rotating so each gets a turn.
- **Endless scroll.** 12 cards at a time, with more loading as you scroll.
- **Background sync.** Re-syncs with YouTube about every 6 hours, or on demand from the popup.
- **One-click off switch.** A popup button brings YouTube's normal home feed back (and your
  backlog again when you want it), without losing anything.
- **Read-only access.** The extension only ever *reads* your playlists; it can't change
  anything on your YouTube account.

## How it works

1. You sign in with Google once, granting the read-only `youtube.readonly` scope.
2. The extension fetches every video in your **custom playlists** (with durations, channel,
   views and publish date) and stores them locally in `chrome.storage.local`.
3. On youtube.com's home page it hides the recommendation feed and renders your backlog in its
   place, inside a Shadow DOM so YouTube's styles can't interfere.
4. Each video is scored `0.4 × how old + 0.4 × how short + 0.2 × random`. Videos shown in the
   last 3 days sit out while there are enough others. (All tunable in `PICKER`,
   [`src/lib/grid.ts`](./src/lib/grid.ts).)
5. Syncs merge fresh data from YouTube into what's stored, so what you've marked is never lost.

> **Note:** YouTube's API doesn't expose **Watch Later** or **Liked videos**, so only playlists
> you've created show up. To include them, copy those videos into a custom playlist.

---

## Installation

Backlog Zero isn't on the Chrome Web Store. You build it from source and load it as an
unpacked extension. Because it talks to the YouTube Data API, you also need your own (free)
Google Cloud OAuth client. This takes about 15 minutes, once.

### Prerequisites

| Requirement | Notes |
|---|---|
| **Google Chrome** (or another Chromium browser: Edge, Brave, Arc) | Must allow unpacked extensions (Developer mode). |
| **Node.js 23.6 or newer** | Needed to build. Check with `node --version`. Get it from [nodejs.org](https://nodejs.org/). |
| **Git** | To clone the repository. |
| **A Google account** | The one whose YouTube playlists you want to use. |

### Step 1 — Clone and build

```bash
git clone https://github.com/BiLaL-159/backlog-zero.git
cd backlog-zero
npm install
npm run build
```

`npm run build` bundles `src/` into `dist/`, which is what Chrome loads. You should now have
a `dist/` folder containing `background.js`, `content.js`, `popup.html` and `popup.js`.

### Step 2 — Load the extension and copy its ID

1. Open **`chrome://extensions`** in Chrome.
2. Turn on **Developer mode** (toggle, top-right).
3. Click **Load unpacked** and select the `backlog-zero` folder (the one containing `manifest.json`).
4. Backlog Zero appears in the list. Copy its **ID**: the 32-letter string under its name,
   e.g. `abcdefghijklmnopabcdefghijklmnop`. You need it in Step 5.

> **Keep the folder where it is.** For unpacked extensions Chrome derives the ID from the
> folder's path. If you move or rename the folder, the ID changes and sign-in stops working
> until you update the OAuth client (Step 5) with the new ID.

### Step 3 — Create a Google Cloud project and enable the YouTube API

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and sign in.
2. Click the project picker at the top → **New Project**. Name it e.g. `Backlog Zero` → **Create**.
   Make sure the new project is selected.
3. Open **APIs & Services → Library**, search for **YouTube Data API v3**, open it and click **Enable**.

### Step 4 — Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen** (in newer consoles: **Google Auth Platform → Branding**).
2. Choose user type **External** → **Create**.
3. Fill in the required fields: **App name** (e.g. `Backlog Zero`), **User support email**
   and **Developer contact email** (your own email is fine). Save and continue.
4. **Scopes** (or **Data Access**): click **Add or remove scopes**, find
   `https://www.googleapis.com/auth/youtube.readonly` (you can paste it in the filter),
   tick it, then **Update** and save.
5. **Test users** (or **Audience**): click **Add users** and add the Google account you'll
   use with YouTube. Save.

> While the app is in **Testing**, only the test users you list can sign in. That's all you
> need for personal use; there's no need to publish or verify the app.

### Step 5 — Create the OAuth client ID

1. Go to **APIs & Services → Credentials** → **Create credentials** → **OAuth client ID**.
2. **Application type:** **Chrome Extension**.
3. **Name:** anything, e.g. `Backlog Zero`.
4. **Item ID:** paste the extension ID you copied in Step 2.
5. Click **Create** and copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

### Step 6 — Put the client ID in the manifest

1. Open `manifest.json` in the `backlog-zero` folder.
2. Find the `oauth2` section and replace the placeholder:

   ```json
   "oauth2": {
     "client_id": "PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/youtube.readonly"]
   }
   ```

   with your Client ID, e.g. `"client_id": "1234567890-abc123.apps.googleusercontent.com"`.
3. Save the file, go back to `chrome://extensions` and click the **reload** icon (↻) on Backlog Zero.

> Don't commit your client ID if you plan to contribute. Keep the placeholder in pull requests.

### Step 7 — Sign in and sync

1. Click the puzzle-piece icon in Chrome's toolbar and **pin** Backlog Zero.
2. Click the Backlog Zero icon → **Sync from YouTube**.
3. Pick your Google account and approve access. You'll probably see
   **"Google hasn't verified this app"**. That's expected for a personal testing app:
   click **Continue** (or **Advanced → Go to Backlog Zero**).
4. The popup shows how many videos are left to watch, across how many playlists.
5. Open [youtube.com](https://www.youtube.com/). The home feed is replaced by your backlog. 🎉

### Updating

```bash
git pull
npm install
npm run build
```

Then click **reload** on Backlog Zero in `chrome://extensions`, and refresh any open YouTube tabs.
Your `manifest.json` client ID survives as long as `git pull` doesn't conflict with it; if it
does, stash it (`git stash`), pull, and re-apply (`git stash pop`).

---

## Usage

| Where | What you can do |
|---|---|
| **youtube.com home** | Browse your backlog grid. Scroll for more. Use the tabs above the grid to filter by playlist. |
| **Card, on hover** | **Watched**: gone for good. **Snooze**: hidden for 7 days. **Keep**: moves it to the "Worth a rewatch" shelf. **Re-roll**: swap it for another pick. |
| **Toolbar popup** | See what's left, when you last synced, **Sync from YouTube** now, or **Show YouTube's normal home** to turn the grid off (and back on). |

Everything is saved immediately. New videos you add to your playlists appear after the next
sync, either automatic (about every 6 hours) or from the popup.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **`bad client id` / `invalid_client`** | The OAuth client's **Item ID** doesn't match the extension's current ID, or `manifest.json` has the wrong client ID. Recheck Steps 2, 5 and 6. Moving the folder changes the ID. |
| **`access_denied` when signing in** | Your Google account isn't in the **Test users** list (Step 4.5). |
| **Popup says "Sign-in needed"** | Your Google session expired. Click **Sync from YouTube** to sign in again. |
| **Synced, but no playlists or videos** | You may have no *custom* playlists. Watch Later and Liked videos aren't available through the API. |
| **Grid doesn't appear on youtube.com** | Check the popup's second button: if it says **Show my backlog on YouTube**, the grid is switched off; click it. Otherwise reload the extension and refresh the tab. |
| **Changes to the code don't show up** | Run `npm run build`, then reload the extension in `chrome://extensions`. Chrome doesn't pick up `dist/` changes on its own. |
| **Anything else** | Open `chrome://extensions` → Backlog Zero → **service worker** → **Console**, and check the **Errors** button on the extension card. |

---

## Development

```bash
npm install
npm run build      # bundle src/ → dist/ with Vite
npm run watch      # rebuild dist/ on every save (still reload the extension in Chrome)
npm run typecheck  # type-check src + tests (Vite strips types without checking them)
npm test           # run the unit tests (Node runs the .ts tests directly; Node 23.6+)
```

- Written in **TypeScript**, UI in **Preact**, bundled with **Vite**, Manifest V3.
- The popup and background service worker are built as ES modules; the content script is
  built as a classic script, since MV3 content scripts can't be modules (see
  [`vite.config.ts`](./vite.config.ts)).
- The pure logic (picker, merge, store) lives in `src/lib/` and is covered by `node:test`
  specs in `test/`.
- To resist YouTube redesigns, the content script anchors to YouTube's stable component tags
  (never hashed CSS classes), re-injects on YouTube's `yt-navigate-finish` event instead of
  polling, and hides the feed rather than removing it.

## Project structure

```
manifest.json        MV3 manifest: permissions, OAuth scope, background worker, popup, content script
vite.config.ts       build: pages + worker pass, then a classic-script pass for the content script
src/
  background.ts      service worker: holds the token, calls the API, answers messages, 6h sync alarm
  popup.html/ts      popup: backlog summary, Sync, and the normal-home switch
  content.tsx        content script: swaps YouTube's home feed for the backlog grid
  lib/
    auth.ts          chrome.identity token helpers
    youtube.ts       read-only YouTube Data API v3 wrappers (playlists, items, durations, channels)
    sync.ts          backlog data model + pure merge of fresh YouTube data into it
    store.ts         the one serialized path for reading/writing the stored backlog
    grid.ts          weighted picker, slot backfill after card actions, Kept shelf, formatting
    messages.ts      popup/content ↔ background message and storage types
icons/               extension icons
test/                node:test specs for the pure logic
dist/                build output that the manifest loads (git-ignored; `npm run build`)
```

---

## Privacy

- The only permission requested on your Google account is **`youtube.readonly`**: read-only
  access to your YouTube data. The extension cannot post, delete, like or subscribe.
- Your backlog is stored **locally in your browser** (`chrome.storage.local`). There is no
  server; nothing is sent anywhere except requests to Google's YouTube Data API.
- You own the OAuth client, so you can revoke access at any time from
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Contributing

Issues and pull requests are welcome.

1. Fork the repo and create a branch from `main`.
2. Make your change, then run `npm run typecheck` and `npm test`.
3. Keep `manifest.json`'s client ID as the placeholder.
4. Open a pull request describing what changed and how you tested it.
