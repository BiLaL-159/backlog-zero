// The message protocol between the background worker and its callers (popup,
// content script), shared so every side agrees on shapes.
import type { VideoMap } from "./sync.ts";
import type { Playlist } from "./youtube.ts";

export type Message =
  | { type: "SYNC" }
  | { type: "GET_BACKLOG" }
  | { type: "MARK_SHOWN"; ids: string[] }; // the grid rendered these cards

// chrome.storage.local layout. Every key is absent until the first sync.
export interface Backlog {
  videos?: VideoMap;
  playlists?: Playlist[];
  lastSyncedAt?: string; // ISO timestamp of the last successful sync
  signInNeeded?: boolean; // the background sync found no cached token; cleared by the next sync
}

export type Response = ({ ok: true } & Backlog) | { ok: false; error: string };
