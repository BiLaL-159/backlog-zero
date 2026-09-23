// Thin read-only wrappers over the YouTube Data API v3.
// Every call costs ~1 quota unit; you get 10,000/day.
const API = "https://www.googleapis.com/youtube/v3";

async function apiGet(path, params, token) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body}`);
  }
  return res.json();
}

// Every custom playlist the signed-in user owns. Handles pagination.
// NOTE: "Watch Later" is intentionally unreachable via the API and won't appear.
export async function listMyPlaylists(token) {
  const playlists = [];
  let pageToken;
  do {
    const data = await apiGet(
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
// Video duration is NOT available here — it needs a separate videos.list call
// (part=contentDetails), added in step 2.
export async function listPlaylistItems(token, playlistId) {
  const items = [];
  let pageToken;
  do {
    const data = await apiGet(
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
