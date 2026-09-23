// Content script on youtube.com: on the home page, hides YouTube's recommendation
// feed and renders the user's backlog grid (Preact in a Shadow DOM) in its place.
// Bundled as a classic script — see vite.config.ts.
//
// Resilience against YouTube reshipping its frontend (see the spec):
//   - anchor to stable component tags, never hashed CSS classes
//   - re-inject on yt-navigate-finish (YouTube's soft navigations), no polling
//   - Shadow DOM so YouTube's CSS can't reach the grid
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { pickCards, formatDuration, type Card } from "./lib/grid.ts";
import type { Backlog, Message, Response } from "./lib/messages.ts";

const GRID_SIZE = 24;
// YouTube keeps every page it has visited in the DOM and just hides the inactive
// ones, so scope to the home browse page.
const FEED = 'ytd-browse[page-subtype="home"] ytd-two-column-browse-results-renderer ytd-rich-grid-renderer';

let host: HTMLElement | null = null;
let hideFeed: HTMLStyleElement | null = null;
let waitForFeed: MutationObserver | null = null;

document.addEventListener("yt-navigate-finish", update);
update(); // the first yt-navigate-finish may have fired before we loaded

function update() {
  unmount();
  if (location.pathname === "/") mount();
}

function mount() {
  const feed = document.querySelector(FEED);
  if (!feed) {
    // Home is still rendering: wait for the feed to appear, once.
    waitForFeed = new MutationObserver(() => document.querySelector(FEED) && update());
    waitForFeed.observe(document.documentElement, { childList: true, subtree: true });
    return;
  }
  // Hide the feed rather than remove it, so YouTube's own code keeps working and
  // it comes back untouched if we unmount.
  hideFeed = document.createElement("style");
  hideFeed.textContent = `${FEED} { display: none !important; }`;
  document.head.append(hideFeed);

  host = document.createElement("div");
  host.id = "backlog-zero";
  feed.before(host);
  render(<App />, host.attachShadow({ mode: "open" }));
}

function unmount() {
  waitForFeed?.disconnect();
  hideFeed?.remove();
  if (host?.shadowRoot) render(null, host.shadowRoot); // runs effect cleanups
  host?.remove();
  waitForFeed = hideFeed = host = null;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; backlog: Backlog };

// The page never calls the API itself: it reads the cached backlog through the
// background worker.
async function loadBacklog(): Promise<State> {
  try {
    const res: Response = await chrome.runtime.sendMessage<Message>({ type: "GET_BACKLOG" });
    return res?.ok ? { kind: "ready", backlog: res } : { kind: "error", error: res?.error ?? "No response" };
  } catch (err) {
    // e.g. "Extension context invalidated" after the extension is reloaded
    return { kind: "error", error: (err as Error).message };
  }
}

function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    loadBacklog().then((s) => live && setState(s));
    return () => void (live = false);
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <Body state={state} />
    </>
  );
}

function Body({ state }: { state: State }) {
  if (state.kind === "loading") return null;
  if (state.kind === "error") return <Notice title="Backlog Zero couldn't load your backlog" text={state.error} />;

  const { videos = {}, lastSyncedAt } = state.backlog;
  if (!lastSyncedAt) {
    return (
      <Notice
        title="Nothing synced yet"
        text="Click the Backlog Zero icon in your browser toolbar and hit “Sync from YouTube” to pull in your playlists."
      />
    );
  }
  const cards = pickCards(videos, GRID_SIZE);
  if (!cards.length) return <Notice title="Backlog zero 🎉" text="Nothing left to watch in your playlists." />;
  return (
    <div class="grid">
      {cards.map((c) => (
        <VideoCard key={c.id} card={c} />
      ))}
    </div>
  );
}

function VideoCard({ card }: { card: Card }) {
  return (
    <a class="card" href={`/watch?v=${encodeURIComponent(card.id)}`}>
      <div class="thumb">
        <img src={`https://i.ytimg.com/vi/${encodeURIComponent(card.id)}/mqdefault.jpg`} alt="" loading="lazy" />
        <span class="duration">{formatDuration(card.durationSec)}</span>
      </div>
      <div class="title">{card.title}</div>
    </a>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div class="notice">
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

// Colors come from YouTube's own theme variables (custom properties inherit into
// the shadow root even after `all: initial`), so the grid follows light/dark
// mode; the fallbacks are YouTube's light theme.
const CSS = `
  :host {
    all: initial;
    display: block;
    padding: 24px 16px;
    font-family: Roboto, Arial, sans-serif;
    color: var(--yt-spec-text-primary, #0f0f0f);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 40px 16px;
  }
  .card { color: inherit; text-decoration: none; display: block; }
  .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .duration {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 1px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
  }
  .title {
    margin-top: 12px;
    font-size: 16px;
    font-weight: 500;
    line-height: 22px;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
  .card:hover .title { text-decoration: underline; }
  .notice { max-width: 480px; margin: 80px auto; text-align: center; }
  .notice h2 { font-size: 20px; font-weight: 500; margin: 0 0 8px; }
  .notice p {
    font-size: 14px;
    line-height: 20px;
    margin: 0;
    color: var(--yt-spec-text-secondary, #606060);
  }
`;
