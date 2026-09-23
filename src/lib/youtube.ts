// Thin read-only wrappers over the YouTube Data API v3.
// Every call costs ~1 quota unit; you get 10,000/day.
import type { PlaylistItem } from "./sync.ts";

const API = "https://www.googleapis.com/youtube/v3";

export interface Playlist {
  id: string;
  title: string;
  count: number;
}

// The slice of each list response we read.
interface ListResponse<T> {
  items: T[];
  nextPageToken?: string;
}

// Carries the HTTP status so callers can spot a 401 and refresh the token.
export class ApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`YouTube API ${status}: ${body}`);
    this.status = status;
  }
}

async function apiGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
}

// Every custom playlist the signed-in user owns. Handles pagination.
// NOTE: "Watch Later" is intentionally unreachable via the API and won't appear.
export async function listMyPlaylists(token: string): Promise<Playlist[]> {
  const playlists: Playlist[] = [];
  let pageToken: string | undefined;
  do {
    const data = await apiGet<
      ListResponse<{ id: string; snippet: { title: string }; contentDetails: { itemCount: number } }>
    >(
      "/playlists",
      {
        part: "snippet,contentDetails",
        mine: "true",
        maxResults: "50",
        ...(pageToken ? { pageToken } : {}),
      },
      token
    );
    for (const item of data.items) {
      playlists.push({
        id: item.id,
        title: item.snippet.title,
        count: item.contentDetails.itemCount,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return playlists;
}

// Every video in a playlist. Handles pagination.
// snippet.publishedAt here = when the item was ADDED to the playlist (our dateAdded).
// Duration, channel and views are NOT available here — see getVideoDetails.
export async function listPlaylistItems(token: string, playlistId: string): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;
  do {
    const data = await apiGet<
      ListResponse<{
        snippet: { title: string; publishedAt: string };
        contentDetails: { videoId: string };
      }>
    >(
      "/playlistItems",
      {
        part: "snippet,contentDetails",
        playlistId,
        maxResults: "50",
        ...(pageToken ? { pageToken } : {}),
      },
      token
    );
    for (const it of data.items) {
      items.push({
        videoId: it.contentDetails.videoId,
        title: it.snippet.title,
        addedAt: it.snippet.publishedAt,
        playlistId,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

// The per-video details the grid shows. The playlist item alone doesn't have them.
export interface VideoDetails {
  duration: string; // ISO 8601
  channelId: string;
  channelTitle: string;
  publishedAt: string; // when the video went up on YouTube
  viewCount: number | null; // null when the uploader hides it
}

// videoId → VideoDetails, looked up 50 ids per call (1 quota unit each, whatever
// the parts). Deleted/private videos are simply absent from the result.
export async function getVideoDetails(token: string, videoIds: string[]): Promise<Map<string, VideoDetails>> {
  const details = new Map<string, VideoDetails>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const data = await apiGet<
      ListResponse<{
        id: string;
        snippet: { channelId: string; channelTitle: string; publishedAt: string };
        contentDetails: { duration: string };
        statistics?: { viewCount?: string };
      }>
    >(
      "/videos",
      {
        part: "snippet,contentDetails,statistics",
        id: videoIds.slice(i, i + 50).join(","), // maxResults isn't allowed with id
      },
      token
    );
    for (const v of data.items) {
      const views = v.statistics?.viewCount;
      details.set(v.id, {
        duration: v.contentDetails.duration,
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
        viewCount: views == null ? null : Number(views),
      });
    }
  }
  return details;
}

// channelId → avatar image URL (88×88), looked up 50 ids per call (1 quota unit
// each). Closed channels are simply absent from the result.
export async function getChannelAvatars(token: string, channelIds: string[]): Promise<Map<string, string>> {
  const avatars = new Map<string, string>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const data = await apiGet<
      ListResponse<{ id: string; snippet: { thumbnails: { default?: { url: string } } } }>
    >(
      "/channels",
      {
        part: "snippet",
        id: channelIds.slice(i, i + 50).join(","), // maxResults isn't allowed with id
      },
      token
    );
    for (const c of data.items) {
      const url = c.snippet.thumbnails.default?.url;
      if (url) avatars.set(c.id, url);
    }
  }
  return avatars;
}
