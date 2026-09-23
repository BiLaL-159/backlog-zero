// The popup ↔ background message protocol, shared so both sides agree on shapes.
import type { VideoMap } from "./sync.ts";
import type { Playlist } from "./youtube.ts";

export type Message = { type: "SYNC" } | { type: "GET_BACKLOG" };

// chrome.storage.local layout. Every key is absent until the first sync.
export interface Backlog {
  videos?: VideoMap;
  playlists?: Playlist[];
  lastSyncedAt?: string; // ISO timestamp of the last successful sync
}

export type Response = ({ ok: true } & Backlog) | { ok: false; error: string };
