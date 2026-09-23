// Content script on youtube.com. Stub for now: the on-page backlog grid (Preact in
// a Shadow DOM) lands here. Bundled as a classic script — see vite.config.ts.
import { render } from "preact";

function Grid() {
  return <div>Backlog Zero</div>;
}

// Rendered into a detached element, so nothing shows on the page yet; this just
// proves Preact + TSX go through the build.
render(<Grid />, document.createElement("div"));
