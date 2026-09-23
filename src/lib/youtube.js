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
    const err = new Error(`YouTube API ${res.status}: ${body}`);
    err.status = res.status; // lets callers spot a 401 and refresh the token
    throw err;
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
// Video duration is NOT available here — see getVideoDurations.
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

// videoId → ISO 8601 duration, looked up 50 ids per call (1 quota unit each).
// Deleted/private videos are simply absent from the result.
export async function getVideoDurations(token, videoIds) {
  const durations = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    const data = await apiGet(
      "/videos",
      {
        part: "contentDetails",
        id: videoIds.slice(i, i + 50).join(","), // maxResults isn't allowed with id
      },
      token
    );
    for (const v of data.items) durations.set(v.id, v.contentDetails.duration);
  }
  return durations;
}
