// Bundles src/ → dist/, which is what manifest.json loads. Two passes, because
// MV3 content scripts can't be ES modules:
//   vite build                 popup page + background worker (ES modules, shared chunks)
//   vite build --mode content  content script, as one self-contained classic script
import { resolve } from "node:path";
import { defineConfig, type BuildOptions } from "vite";

type Pass = NonNullable<BuildOptions["rolldownOptions"]>;
const src = (file: string) => resolve(import.meta.dirname, "src", file);

const pages: Pass = {
  input: { popup: src("popup.html"), background: src("background.ts") },
  // Fixed names: the manifest points at dist/background.js.
  output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name].js" },
};

const content: Pass = {
  input: { content: src("content.tsx") },
  output: { format: "iife", entryFileNames: "[name].js" },
};

export default defineConfig(({ mode }) => ({
  root: "src",
  base: "./", // extension pages live under chrome-extension://<id>/dist/, not at /
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    outDir: "../dist",
    emptyOutDir: false, // the two passes share dist/; `npm run build` clears it first
    modulePreload: false, // extension pages load from disk, nothing to preload
    minify: false, // keep stack traces in the service worker console readable
    rolldownOptions: mode === "content" ? content : pages,
  },
}));
