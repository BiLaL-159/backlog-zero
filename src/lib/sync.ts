// Pure sync logic: turns fresh YouTube data into the chrome.storage.local backlog
// model. No chrome.* or network calls here, so it runs (and is tested) under Node.

export type VideoStatus = "unseen" | "watched" | "kept" | "archived";

// One stored backlog entry, keyed by videoId in the `videos` map.
export interface Video {
  title: string;
  durationSec: number;
  playlistIds: string[];
  dateAdded: string; // ISO timestamp of the earliest save
  status: VideoStatus;
  snoozedUntil: string | null;
  lastShownAt: string | null;
  removedAt: string | null;
  // Fields added by later features survive a re-sync untouched.
  [extra: string]: unknown;
}

export type VideoMap = Record<string, Video>;

// One (playlist, video) pair from playlistItems.list.
export interface PlaylistItem {
  videoId: string;
  title: string;
  addedAt: string;
  playlistId: string;
}

// A PlaylistItem with its duration from videos.list (null when unavailable).
export interface FetchedItem extends PlaylistItem {
  durationSec: number | null;
}

// ISO 8601 duration ("PT1H2M3S", "P1DT1S", "P0D") → seconds.
export function parseDuration(iso: string | null | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return ((d * 24 + h) * 60 + min) * 60 + s;
}

// Merge one full fetch into the stored backlog and return the new videos map.
//   prev    – stored map: videoId → record
//   fetched – one entry per (playlist, video) pair from YouTube, with durationSec
//             attached from videos.list (null when the video is unavailable)
//   now     – ISO timestamp for this sync
export function mergeBacklog(prev: VideoMap, fetched: FetchedItem[], now: string): VideoMap {
  const videos: VideoMap = {};
  for (const it of fetched) {
    // videos.list returns nothing for deleted/private videos, so they have no
    // duration. They can't be watched — leave them out.
    if (it.durationSec == null) continue;
    const existing = videos[it.videoId];
    if (existing) {
      // Same video saved in another playlist: one record, every playlist,
      // earliest save date (ISO strings compare chronologically).
      if (!existing.playlistIds.includes(it.playlistId)) existing.playlistIds.push(it.playlistId);
      if (it.addedAt < existing.dateAdded) existing.dateAdded = it.addedAt;
      continue;
    }
    videos[it.videoId] = {
      // Defaults for a new video, then everything already stored (user state and
      // any fields later features add), then the YouTube-owned fields on top.
      status: "unseen",
      snoozedUntil: null,
      lastShownAt: null,
      ...(prev[it.videoId] as Video | undefined),
      title: it.title,
      durationSec: it.durationSec,
      playlistIds: [it.playlistId],
      dateAdded: it.addedAt,
      removedAt: null,
    };
  }
  // Gone from every playlist on YouTube: keep the record (and its history) but
  // flag it, so the picker can skip it and a re-save restores it as it was.
  for (const [id, old] of Object.entries(prev)) {
    if (videos[id]) continue;
    videos[id] = { ...old, playlistIds: [], removedAt: old.removedAt ?? now };
  }
  return videos;
}

// Still saved on YouTube and not yet dealt with (watched/kept/archived).
export function isInBacklog(video: Video): boolean {
  return !video.removedAt && video.status === "unseen";
}
