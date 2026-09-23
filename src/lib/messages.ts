// The message protocol between the background worker and its callers (popup,
// content script), shared so every side agrees on shapes.
import type { Video, VideoMap } from "./sync.ts";
import type { Playlist } from "./youtube.ts";

export type Message =
  | { type: "SYNC" }
  | { type: "GET_BACKLOG" }
  | { type: "MARK_SHOWN"; ids: string[] } // the grid rendered these cards
  | { type: "UPDATE_VIDEO"; id: string; patch: VideoPatch }; // a card action

// What a card action may change on a video: watched/kept, or a snooze.
export type VideoPatch = Partial<Pick<Video, "status" | "snoozedUntil">>;

// chrome.storage.local layout. Every key is absent until the first sync.
export interface Backlog {
  videos?: VideoMap;
  playlists?: Playlist[];
  lastSyncedAt?: string; // ISO timestamp of the last successful sync
  signInNeeded?: boolean; // the background sync found no cached token; cleared by the next sync
}

// chrome.storage.local keys the popup writes directly: plain settings, not backlog
// data, so they bypass the store.
export interface Settings {
  paused?: boolean; // show YouTube's own home feed instead of the grid
}

export type Response = ({ ok: true } & Backlog) | { ok: false; error: string };
