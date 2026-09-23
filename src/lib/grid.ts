// Pure helpers for the on-page grid. No chrome.* or DOM here, so it runs (and is
// tested) under Node.
import { isInBacklog, type Video, type VideoMap } from "./sync.ts";

export interface Card extends Video {
  id: string;
}

// The videos the grid shows. No ranking yet (the weighted picker comes later):
// just the first n still in the backlog, in stored order.
export function pickCards(videos: VideoMap, n: number): Card[] {
  const cards: Card[] = [];
  for (const [id, video] of Object.entries(videos)) {
    if (cards.length >= n) break;
    if (isInBacklog(video)) cards.push({ ...video, id });
  }
  return cards;
}

// Seconds → YouTube-style timestamp: "0:45", "12:05", "1:02:03".
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
