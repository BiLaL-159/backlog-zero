# Backlog Zero — Setup (do this once)

To read your playlists, the extension signs in with Google. That requires an OAuth
client tied to **this extension's ID**. There's a chicken-and-egg (you need the ID to
make the client, and you load the extension to get the ID), so do these steps **in order**.

---

## 1. Load the extension to get its ID

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `backlog-zero/` folder.
4. It will load with an error about the OAuth client — that's expected. **Copy the
   extension's ID** (the long string of letters under its name). You'll need it next.

> Keep loading it from the **same folder path** — the ID is derived from the path, so
> moving the folder changes the ID and breaks the OAuth client.

## 2. Create a Google Cloud project + enable the API

1. Go to <https://console.cloud.google.com/>, create a new project (e.g. "Backlog Zero").
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen.**
2. User type: **External** → Create.
3. Fill the required app name + your email. Save through the steps.
4. **Scopes:** add `https://www.googleapis.com/auth/youtube.readonly`.
5. **Test users:** add your own Google account. (While the app is unverified, only
   listed test users can sign in — that's fine, it's just you for now.)

## 4. Create the OAuth client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
2. Application type: **Chrome Extension**.
3. **Item ID:** paste the extension ID you copied in step 1.
4. Create → **copy the Client ID** (ends in `.apps.googleusercontent.com`).

## 5. Wire the client ID into the extension

1. Open `manifest.json`.
2. Replace `PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com` with your Client ID.
3. Back on `chrome://extensions`, click the **reload** icon on Backlog Zero.

## 6. Test it

1. Click the Backlog Zero toolbar icon → **Sync from YouTube**.
2. Approve the Google consent screen (you may see an "unverified app" notice — expected;
   continue as the test user you added).
3. You should see how many videos are left to watch, then each custom playlist with
   its count. 🎉
   (Also check the service worker console: `chrome://extensions` → Backlog Zero →
   **service worker** link → Console.)

---

## Troubleshooting

- **`bad client id` / `invalid_client`** — the Item ID on the OAuth client doesn't match
  the current extension ID, or the manifest client_id is wrong. Recheck steps 1, 4, 5.
- **`access_denied`** — your Google account isn't in the **Test users** list (step 3.5).
- **No playlists shown but no error** — you may genuinely have no *custom* playlists;
  remember Watch Later is invisible to the API by design.
- **Nothing happens on click** — open the service worker console (step 6) for the error.
