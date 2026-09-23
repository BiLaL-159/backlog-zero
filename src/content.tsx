// Content script on youtube.com: on the home page, hides YouTube's recommendation
// feed and renders the user's backlog grid (Preact in a Shadow DOM) in its place.
// Bundled as a classic script — see vite.config.ts.
//
// Resilience against YouTube reshipping its frontend (see the spec):
//   - anchor to stable component tags, never hashed CSS classes
//   - re-inject on yt-navigate-finish (YouTube's soft navigations), no polling
//   - Shadow DOM so YouTube's CSS can't reach the grid
import { render, type ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState, type Dispatch, type StateUpdater } from "preact/hooks";
import { pickCards, fillSlots, pickShelf, formatDuration, PICKER, type Card } from "./lib/grid.ts";
import type { Backlog, Message, Response, VideoPatch } from "./lib/messages.ts";
import type { VideoMap } from "./lib/sync.ts";
import type { Playlist } from "./lib/youtube.ts";

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
  // it comes back untouched if we unmount. The frosted header behind the masthead
  // stretches to cover the feed's chip bar; shrink it back so it doesn't cover us.
  hideFeed = document.createElement("style");
  hideFeed.textContent = `
    ${FEED} { display: none !important; }
    #frosted-glass.with-chipbar { height: 56px !important; }
  `;
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
    const res = await send({ type: "GET_BACKLOG" });
    return res?.ok ? { kind: "ready", backlog: res } : { kind: "error", error: res?.error ?? "No response" };
  } catch (err) {
    // e.g. "Extension context invalidated" after the extension is reloaded
    return { kind: "error", error: (err as Error).message };
  }
}

function send(msg: Message): Promise<Response> {
  return chrome.runtime.sendMessage<Message, Response>(msg);
}

// Any sync (popup, grid button, timer) ends by writing one of these keys, so a
// change to them means there's something new to show.
const SYNC_KEYS = ["lastSyncedAt", "signInNeeded"];

function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    const reload = () => loadBacklog().then((s) => live && setState(s));
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && SYNC_KEYS.some((k) => k in changes)) reload();
    };
    reload();
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div class="root">
        <Body state={state} />
      </div>
    </>
  );
}

function Body({ state }: { state: State }) {
  if (state.kind === "loading") return null;
  if (state.kind === "error") return <Notice title="Backlog Zero couldn't load your backlog" text={state.error} />;

  return (
    <>
      {state.backlog.lastSyncedAt ? (
        <Home backlog={state.backlog} />
      ) : (
        <Notice title="Nothing synced yet" text="Click the Backlog Zero icon in the toolbar, then Sync from YouTube." />
      )}
    </>
  );
}

// Fixed for the whole page view, so a live update after a sync re-picks the same
// cards unless the backlog itself changed (see wasShownRecently in lib/grid.ts),
// and the Kept shelf either shows for the whole visit or not at all.
function usePageView() {
  const [view] = useState(() => {
    const draws = new Map<string, number>();
    return {
      now: new Date(),
      shelfRoll: Math.random(),
      random: (id: string) => draws.get(id) ?? draws.set(id, Math.random()).get(id)!,
    };
  });
  return view;
}

type PageView = ReturnType<typeof usePageView>;

// The tabs, the grid and, on some visits, the Kept shelf after the grid's first
// page. Switching tabs re-picks from the cached backlog.
function Home({ backlog: { videos = {}, playlists = [] } }: { backlog: Backlog }) {
  const view = usePageView();
  const [tab, setTab] = useState<string | null>(null); // a playlist id; null = All
  // Videos dealt with on this page (any action, re-roll included), across every
  // tab. They leave at once, without waiting for the write, and a sync landing
  // mid-write can't bring them back.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // A sync can drop the selected playlist; fall back to All.
  const playlist = playlists.find((p) => p.id === tab);
  return (
    <>
      <Tabs playlists={playlists} active={playlist?.id ?? null} onSelect={setTab} />
      {/* Keyed so each tab starts from its own top picks, not the last tab's slots. */}
      <Grid
        key={playlist?.id ?? ""}
        videos={videos}
        view={view}
        playlist={playlist}
        gone={gone}
        setGone={setGone}
        shelf={<Shelf videos={videos} view={view} />}
      />
    </>
  );
}

// Kept videos, apart from the backlog and only on some visits (PICKER.shelf), so
// rewatching doesn't compete with draining the pile.
function Shelf({ videos, view }: { videos: VideoMap; view: PageView }) {
  const cards = useMemo(
    () => pickShelf(videos, { now: view.now, roll: view.shelfRoll, random: view.random }),
    [videos, view]
  );
  // Stamped like the grid's cards, so the next shelf shows other kept videos.
  useEffect(() => {
    if (cards.length) send({ type: "MARK_SHOWN", ids: cards.map((c) => c.id) }).catch(() => {}); // best effort
  }, [cards]);
  if (!cards.length) return null;
  return (
    <section class="shelf">
      <h2>Worth a rewatch</h2>
      <div class="grid">
        {cards.map((c) => (
          <div class="card" key={c.id}>
            <CardLink card={c} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Tabs({ playlists, active, onSelect }: {
  playlists: Playlist[];
  active: string | null;
  onSelect: (id: string | null) => void;
}) {
  const tabs = [{ id: null, title: "All" }, ...playlists];
  return (
    <div class="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id ?? ""}
          role="tab"
          aria-selected={t.id === active}
          class={t.id === active ? "tab active" : "tab"}
          onClick={() => onSelect(t.id)}
        >
          {t.title}
        </button>
      ))}
    </div>
  );
}

// Endless: a page of cards to start, another each time the end scrolls near.
function Grid({ videos, view, playlist, gone, setGone, shelf }: {
  videos: VideoMap;
  view: PageView;
  playlist: Playlist | undefined;
  gone: ReadonlySet<string>;
  setGone: Dispatch<StateUpdater<ReadonlySet<string>>>;
  shelf: ComponentChildren;
}) {
  const [error, setError] = useState<string | null>(null);
  const ranked = useMemo(
    () => pickCards(videos, { ...view, playlist: playlist?.id, n: Infinity }).filter((c) => !gone.has(c.id)),
    [videos, view, playlist?.id, gone]
  );
  // The previous cards' order, so a backfill lands in the slot that emptied.
  const slots = useRef<string[]>([]);
  const [limit, setLimit] = useState(PICKER.gridSize);
  const cards = useMemo(() => {
    const next = fillSlots(slots.current, ranked, limit);
    slots.current = next.map((c) => c.id);
    return next;
  }, [ranked, limit]);
  // Re-observed after every page, so a screen tall enough to still show the end
  // keeps loading until it's filled.
  const end = useRef<HTMLDivElement>(null);
  const hasMore = ranked.length > limit;
  useEffect(() => {
    if (!hasMore || !end.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setLimit((l) => l + PICKER.gridSize),
      { rootMargin: "600px" }
    );
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [hasMore, limit]);
  // Only the cards actually rendered count as shown.
  useEffect(() => {
    if (cards.length) send({ type: "MARK_SHOWN", ids: cards.map((c) => c.id) }).catch(() => {}); // best effort
  }, [cards]);

  async function act(card: Card, patch: VideoPatch | null) {
    setError(null);
    setGone((g) => new Set(g).add(card.id));
    if (!patch) return; // re-roll: nothing to store
    try {
      const res = await send({ type: "UPDATE_VIDEO", id: card.id, patch });
      if (!res?.ok) throw new Error(res?.error ?? "No response");
    } catch (err) {
      // Not saved: let the video back into the pool rather than lose it silently.
      setGone((g) => new Set([...g].filter((id) => id !== card.id)));
      setError(`Couldn't save "${card.title}": ${(err as Error).message}`);
    }
  }

  const renderCards = (list: Card[]) => (
    <div class="grid">
      {list.map((c) => (
        <VideoCard key={c.id} card={c} onAction={(patch) => act(c, patch)} />
      ))}
    </div>
  );

  return (
    <>
      {error && <p class="grid-error">{error}</p>}
      {cards.length ? (
        <>
          {renderCards(cards.slice(0, PICKER.gridSize))}
          {shelf}
          {cards.length > PICKER.gridSize && renderCards(cards.slice(PICKER.gridSize))}
          <div ref={end} />
        </>
      ) : (
        <>
          {playlist ? (
            <Notice title="Nothing left here" text={`Everything in ${playlist.title} is watched, kept or snoozed.`} />
          ) : (
            <Notice title="Backlog zero 🎉" text="Nothing left to watch in your playlists." />
          )}
          {shelf}
        </>
      )}
    </>
  );
}

// The card actions and what each stores. Re-roll stores nothing: the video only
// leaves this page view, its status untouched.
const ACTIONS: { label: string; hint: string; icon: string; patch: () => VideoPatch | null }[] = [
  { label: "Watched", hint: "Mark as watched", icon: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z", patch: () => ({ status: "watched" }) },
  {
    label: "Snooze",
    hint: `Snooze: hide for ${Math.round(PICKER.snoozeMs / 86_400_000)} days`,
    icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z",
    patch: () => ({ snoozedUntil: new Date(Date.now() + PICKER.snoozeMs).toISOString() }),
  },
  {
    label: "Keep",
    hint: "Keep: worth rewatching, move to the Kept shelf",
    icon: "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15-5-2.2L7 18V5h10v13z",
    patch: () => ({ status: "kept" }),
  },
  {
    label: "Re-roll",
    hint: "Re-roll: show another video instead",
    icon: "M17.6 6.4A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4l-2.4 2.4z",
    patch: () => null,
  },
];

function VideoCard({ card, onAction }: { card: Card; onAction: (patch: VideoPatch | null) => void }) {
  return (
    <div class="card">
      <CardLink card={card} />
      <div class="actions">
        {ACTIONS.map((a) => (
          <button key={a.label} title={a.hint} aria-label={a.label} onClick={() => onAction(a.patch())}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// Thumbnail, duration and title, linking to the video.
function CardLink({ card }: { card: Card }) {
  return (
    <a href={`/watch?v=${encodeURIComponent(card.id)}`}>
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

// The grid's own colors, switched by the `dark` attribute YouTube sets on <html>.
// (YouTube's --yt-spec-* theme variables used to cover this, but they're gone.)
const CSS = `
  :host {
    all: initial;
    display: block;
    font-family: Roboto, Arial, sans-serif;
    --text: #0f0f0f;
    --text-2: #606060;
    --chip: rgba(0, 0, 0, 0.05);
    --chip-hover: rgba(0, 0, 0, 0.1);
    --line: rgba(0, 0, 0, 0.1);
    --bg: #fff;
    --error: #cc0000;
    color: var(--text);
  }
  :host-context(html[dark]) {
    --text: #f1f1f1;
    --text-2: #aaa;
    --chip: rgba(255, 255, 255, 0.1);
    --chip-hover: rgba(255, 255, 255, 0.2);
    --line: rgba(255, 255, 255, 0.2);
    --bg: #0f0f0f;
    --error: #ff6b6b;
  }
  /* Padding lives here, not on :host, because YouTube's global reset
     (div { padding: 0 }) beats :host rules. */
  .root { padding: 16px 24px 48px; }
  button {
    font: inherit;
    font-weight: 500;
    padding: 0 16px;
    height: 36px;
    border: none;
    border-radius: 18px;
    cursor: pointer;
    color: inherit;
    background: var(--chip);
  }
  button:hover { background: var(--chip-hover); }
  button:disabled { opacity: 0.5; cursor: default; }
  .tabs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .tab {
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
  }
  .tab.active, .tab.active:hover {
    background: var(--text);
    color: var(--bg);
  }
  .grid + .grid { margin-top: 40px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 40px 16px;
  }
  .card a { color: inherit; text-decoration: none; display: block; }
  .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    background: var(--chip);
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
  .card a:hover .title { text-decoration: underline; }
  /* Card actions: icon buttons over the thumbnail's top-right corner, shown on
     hover or keyboard focus (always on touch screens, which can't hover). */
  .card { position: relative; }
  .actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .card:hover .actions, .card:focus-within .actions { opacity: 1; }
  @media (hover: none) { .actions { opacity: 1; } }
  .actions button {
    width: 32px;
    height: 32px;
    padding: 0;
    display: grid;
    place-items: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.7);
  }
  .actions button:hover { background: rgba(0, 0, 0, 0.9); }
  .actions svg { width: 18px; height: 18px; fill: currentColor; }
  .shelf {
    margin: 48px 0;
    padding: 24px 0;
    border-bottom: 1px solid var(--line);
    border-top: 1px solid var(--line);
  }
  .shelf h2 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
  .grid-error { margin: 0 0 16px; font-size: 14px; color: var(--error); }
  .notice { max-width: 480px; margin: 80px auto; text-align: center; }
  .notice h2 { font-size: 20px; font-weight: 500; margin: 0 0 8px; }
  .notice p {
    font-size: 14px;
    line-height: 20px;
    margin: 0;
    color: var(--text-2);
  }
`;
