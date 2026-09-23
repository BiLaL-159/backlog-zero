// Content script on youtube.com: on the home page, hides YouTube's recommendation
// feed and renders the user's backlog grid (Preact in a Shadow DOM) in its place.
// Bundled as a classic script — see vite.config.ts.
//
// Resilience against YouTube reshipping its frontend (see the spec):
//   - anchor to stable component tags, never hashed CSS classes
//   - re-inject on yt-navigate-finish (YouTube's soft navigations), no polling
//   - Shadow DOM so YouTube's CSS can't reach the grid
import { render } from "preact";
import { useEffect, useMemo, useRef, useState, type Dispatch, type StateUpdater } from "preact/hooks";
import { pickCards, fillSlots, pickShelf, formatDuration, timeAgo, PICKER, type Card } from "./lib/grid.ts";
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
      <Body state={state} />
    </>
  );
}

function Body({ state }: { state: State }) {
  if (state.kind === "loading") return null;
  if (state.kind === "error") return <Notice title="Backlog Zero couldn't load your backlog" text={state.error} />;

  return (
    <>
      <Toolbar backlog={state.backlog} />
      {state.backlog.lastSyncedAt ? (
        <Home backlog={state.backlog} />
      ) : (
        <Notice title="Nothing synced yet" text="Hit Refresh to pull in your playlists." />
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

// The tabs, the grid and, on some visits, the Kept shelf below them. Switching
// tabs re-picks from the cached backlog.
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
      />
      <Shelf videos={videos} view={view} />
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

function Grid({ videos, view, playlist, gone, setGone }: {
  videos: VideoMap;
  view: PageView;
  playlist: Playlist | undefined;
  gone: ReadonlySet<string>;
  setGone: Dispatch<StateUpdater<ReadonlySet<string>>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const ranked = useMemo(
    () => pickCards(videos, { ...view, playlist: playlist?.id, n: Infinity }).filter((c) => !gone.has(c.id)),
    [videos, view, playlist?.id, gone]
  );
  // The previous cards' order, so a backfill lands in the slot that emptied.
  const slots = useRef<string[]>([]);
  const cards = useMemo(() => {
    const next = fillSlots(slots.current, ranked);
    slots.current = next.map((c) => c.id);
    return next;
  }, [ranked]);
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

  return (
    <>
      {error && <p class="grid-error">{error}</p>}
      {cards.length ? (
        <div class="grid">
          {cards.map((c) => (
            <VideoCard key={c.id} card={c} onAction={(patch) => act(c, patch)} />
          ))}
        </div>
      ) : playlist ? (
        <Notice title="Nothing left here" text={`Everything in ${playlist.title} is watched, kept or snoozed.`} />
      ) : (
        <Notice title="Backlog zero 🎉" text="Nothing left to watch in your playlists." />
      )}
    </>
  );
}

type SyncState = { kind: "idle" } | { kind: "syncing" } | { kind: "error"; error: string };

// "Synced 2h ago" + Refresh. A successful sync needs no handling here: the new
// backlog arrives through App's storage listener, like any other sync.
function Toolbar({ backlog: { lastSyncedAt, signInNeeded } }: { backlog: Backlog }) {
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000); // keep "X ago" current
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    setSync({ kind: "syncing" });
    try {
      const res = await send({ type: "SYNC" });
      setSync(res?.ok ? { kind: "idle" } : { kind: "error", error: res?.error ?? "No response" });
    } catch (err) {
      setSync({ kind: "error", error: (err as Error).message });
    }
  }

  const [text, isError] =
    sync.kind === "syncing" ? ["Syncing…", false]
    : sync.kind === "error" ? [`Sync failed: ${sync.error}`, true]
    : signInNeeded ? ["Sign-in needed — hit Refresh to sign in", true]
    : lastSyncedAt ? [`Synced ${timeAgo(lastSyncedAt)}`, false]
    : ["Not synced yet", false];
  return (
    <div class="toolbar">
      <span class={isError ? "status error" : "status"}>{text}</span>
      <button onClick={refresh} disabled={sync.kind === "syncing"}>
        Refresh
      </button>
    </div>
  );
}

// The card actions and what each stores. Re-roll stores nothing: the video only
// leaves this page view, its status untouched.
const ACTIONS: { label: string; hint: string; patch: () => VideoPatch | null }[] = [
  { label: "Watched", hint: "Mark as watched", patch: () => ({ status: "watched" }) },
  {
    label: "Snooze",
    hint: `Hide for ${Math.round(PICKER.snoozeMs / 86_400_000)} days`,
    patch: () => ({ snoozedUntil: new Date(Date.now() + PICKER.snoozeMs).toISOString() }),
  },
  { label: "Keep", hint: "Worth rewatching: move to the Kept shelf", patch: () => ({ status: "kept" }) },
  { label: "Re-roll", hint: "Show another video instead", patch: () => null },
];

function VideoCard({ card, onAction }: { card: Card; onAction: (patch: VideoPatch | null) => void }) {
  return (
    <div class="card">
      <CardLink card={card} />
      <div class="actions">
        {ACTIONS.map((a) => (
          <button key={a.label} title={a.hint} onClick={() => onAction(a.patch())}>
            {a.label}
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
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-bottom: 16px;
    font-size: 14px;
  }
  .status { color: var(--yt-spec-text-secondary, #606060); }
  .status.error { color: #e00; }
  button {
    font: inherit;
    font-weight: 500;
    padding: 0 16px;
    height: 36px;
    border: none;
    border-radius: 18px;
    cursor: pointer;
    color: inherit;
    background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05));
  }
  button:hover { background: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, 0.1)); }
  button:disabled { opacity: 0.5; cursor: default; }
  .tabs { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
  .tab {
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
  }
  .tab.active, .tab.active:hover {
    background: var(--yt-spec-text-primary, #0f0f0f);
    color: var(--yt-spec-base-background, #fff);
  }
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
  .card a:hover .title { text-decoration: underline; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .actions button { height: 28px; padding: 0 10px; font-size: 12px; }
  .shelf {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
  }
  .shelf h2 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
  .grid-error { margin: 0 0 16px; font-size: 14px; color: #e00; }
  .notice { max-width: 480px; margin: 80px auto; text-align: center; }
  .notice h2 { font-size: 20px; font-weight: 500; margin: 0 0 8px; }
  .notice p {
    font-size: 14px;
    line-height: 20px;
    margin: 0;
    color: var(--yt-spec-text-secondary, #606060);
  }
`;
