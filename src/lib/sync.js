// Pure sync logic: turns fresh YouTube data into the chrome.storage.local backlog
// model. No chrome.* or network calls here, so it runs (and is tested) under Node.

// ISO 8601 duration ("PT1H2M3S", "P1DT1S", "P0D") → seconds.
export function parseDuration(iso) {
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
export function mergeBacklog(prev, fetched, now) {
  const videos = {};
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
      ...prev[it.videoId],
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
export function isInBacklog(video) {
  return !video.removedAt && video.status === "unseen";
}
