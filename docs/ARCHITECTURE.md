# ReactCanvas — Architecture & Maintainer's Guide

This document is written for one specific reader: someone who wants to **own**
ReactCanvas but has never built a VS Code extension before. It starts from
zero (what a VS Code extension even *is*), then walks through how this codebase
is put together, where state lives, and how a single keystroke turns into a
re-rendered preview. By the end you should be able to open any file in `src/`
and know why it exists and what it talks to.

Read it top to bottom the first time. After that it works as a reference — the
table of contents mirrors the mental model you'll build.

---

## Table of contents

1. [What a VS Code extension is (the 15-minute primer)](#1-what-a-vs-code-extension-is)
2. [What ReactCanvas does, in one paragraph](#2-what-reactcanvas-does)
3. [The two worlds: extension host vs. webview](#3-the-two-worlds)
4. [Repository map](#4-repository-map)
5. [The core data flow (one keystroke, end to end)](#5-the-core-data-flow)
6. [Where state lives](#6-where-state-lives)
7. [Module-by-module reference](#7-module-by-module-reference)
8. [The transpile & bundling pipeline in depth](#8-the-transpile--bundling-pipeline-in-depth)
9. [The webview runtime in depth](#9-the-webview-runtime-in-depth)
10. [Build, test, and release toolchain](#10-build-test-and-release-toolchain)
11. [How to make common changes](#11-how-to-make-common-changes)
12. [Glossary](#12-glossary)
13. [A learning path to true ownership](#13-a-learning-path)

---

## 1. What a VS Code extension is

If you've never written one, three ideas unlock everything else.

**a) An extension is just a Node.js module that VS Code loads.** VS Code looks
for a `main` field in `package.json` (ours points to `dist/extension.js`) and
`require()`s it. That module exports two functions:

```ts
export function activate(context) { /* set things up */ }
export function deactivate() { /* optional cleanup */ }
```

VS Code calls `activate` once, the first time your extension is "needed", and
hands you a `context` object you use to register everything.

**b) `package.json` is half the program.** Beyond normal npm metadata, VS Code
reads a `contributes` section that *declaratively* tells the editor what your
extension adds — commands, menu items, settings, keybindings. You declare a
command in `package.json`, then bind a function to it in code with
`vscode.commands.registerCommand`. The declaration and the implementation are
two halves of the same feature. If they drift (declared but not registered, or
vice-versa), the command silently misbehaves.

**c) "Activation" is lazy.** Extensions don't all run at startup — that would
make VS Code slow. Instead each declares *activation events*: the conditions
under which it should wake up. Ours (in `package.json`) are:

```json
"activationEvents": [
  "onLanguage:javascriptreact",
  "onLanguage:typescriptreact"
]
```

So ReactCanvas stays dormant until you open a `.jsx`/`.tsx` file (or run one of
its commands, which VS Code treats as an implicit activation event). This is
why the extension does almost nothing in `activate` beyond registering things —
the real work happens later, on demand.

**The `vscode` module.** Inside the extension you `import * as vscode from
'vscode'`. This module is *not* on npm as runtime code — it's injected by the
host at runtime. That's why our build marks it `external` (see
`esbuild.mjs`): we must never bundle it. The `@types/vscode` dev-dependency
provides the type definitions so TypeScript understands the API.

That's the whole foundation. Everything below is ReactCanvas-specific.

---

## 2. What ReactCanvas does

ReactCanvas opens a **live preview** of a React component file beside your
editor. When the active file is `.jsx`/`.tsx`, ReactCanvas transpiles it in
memory, follows its relative imports and npm imports, and renders the default
export inside a sandboxed iframe — re-rendering ~300 ms after you stop typing.
No dev server, no `npm install`, no build config.

Everything it does is a variation on that sentence: the version selector
changes *which* React renders it, the console panel surfaces `console.log` from
inside the preview, multi-file support widens *what* gets transpiled, and npm
support widens *what* the preview can import.

---

## 3. The two worlds

This is the single most important concept in the codebase. ReactCanvas runs in
**two separate JavaScript environments** that cannot share objects and can only
communicate by passing JSON messages.

```
┌───────────────────────────────┐         ┌──────────────────────────────────┐
│      EXTENSION HOST            │         │           WEBVIEW                 │
│      (Node.js / Electron)      │         │      (a sandboxed browser page)   │
│                               │  post   │                                   │
│  • has the `vscode` API        │ ──────► │  • has the DOM, no `vscode` API    │
│  • reads files, editor text    │ Message │  • renders the preview "chrome"    │
│  • transpiles / bundles        │ ◄────── │  • hosts the user-code iframe      │
│  • decides what to render      │  post   │                                   │
│                               │ Message │                                   │
│  src/extension.ts             │         │  src/webview/main.ts               │
│  src/previewPanel.ts          │         │                                    │
│  src/transpiler/**            │         │      ┌───────────────────────────┐ │
│  src/csp.ts                   │         │      │  SANDBOXED IFRAME         │ │
│                               │         │      │  (user's component runs)  │ │
│                               │         │      │  no vscode, no same-origin│ │
│                               │         │      └───────────────────────────┘ │
└───────────────────────────────┘         └──────────────────────────────────┘
```

Why the separation exists:

- **Security.** User component code is untrusted-ish — you don't want a
  preview able to read your files or drive VS Code. So user code runs in an
  iframe with `sandbox="allow-scripts"` (and *not* `allow-same-origin`), nested
  inside the webview, which itself can't touch the extension host except through
  messages.
- **Capability.** Only the extension host can read files and editor state
  (`vscode` API). Only the webview has a DOM to render into. Neither can do the
  other's job, so they cooperate.

There are actually **three** nested contexts: extension host → webview →
iframe. Keep them straight and the whole codebase reads cleanly. The contract
between host and webview is the set of message types in `src/messages.ts`; the
contract between webview and iframe is the `IframeMessage` type inside
`src/webview/main.ts`.

---

## 4. Repository map

```
reactcanvas/
├── package.json            Manifest: identity, contributes (commands/menus),
│                           activation events, scripts, deps.
├── esbuild.mjs             Build script: bundles the extension and the webview.
├── tsconfig.json           Strict TypeScript config.
├── eslint.config.mjs       Lint rules.
├── .vscodeignore           What is EXCLUDED from the published .vsix.
│
├── src/
│   ├── extension.ts        ENTRY POINT. activate(): registers commands,
│   │                       status bar, and lazily builds the transpiler.
│   ├── previewPanel.ts     The heart. Owns the webview panel, watches the
│   │                       editor, runs the transpile/bundle, posts renders.
│   ├── messages.ts         The host⇄webview message contract (types only).
│   ├── csp.ts              Builds the Content-Security-Policy string (pure).
│   ├── types.d.ts          A tiny ambient type shim for esbuild-wasm.
│   │
│   ├── transpiler/         The "compile user code" subsystem (no vscode dep).
│   │   ├── index.ts        Engines (esbuild-wasm + babel) and bundle() walk.
│   │   ├── pathResolver.ts Pure path math for the bundler.
│   │   ├── moduleGraph.ts  Specifier extraction/rewrite + topological sort.
│   │   └── packages.ts     npm specifier → esm.sh URL logic.
│   │
│   ├── webview/            Code that runs in the browser world.
│   │   ├── main.ts         The preview "chrome": toolbar, console panel,
│   │   │                   builds the sandboxed iframe, links modules.
│   │   └── consoleSerialize.ts  Formats console args devtools-style.
│   │
│   └── test/
│       ├── unit/           Fast Node tests (no VS Code needed).
│       └── suite/          Integration tests (run inside a real VS Code).
│
├── examples/               Demo components (multi-file, npm, fetch, …).
├── docs/ARCHITECTURE.md    You are here.
└── .github/workflows/      CI (lint/test/package) and release automation.
```

A useful rule of thumb: **anything under `src/transpiler/` is pure and
testable** — it never imports `vscode`, takes its inputs as plain arguments,
and returns plain data. That's deliberate: it's the most logic-heavy part, so
it's kept unit-testable in plain Node. Everything that *does* need `vscode`
(reading files, the editor, the panel) lives in `extension.ts` and
`previewPanel.ts`.

---

## 5. The core data flow

Here is what happens from the moment you type a character in a `.jsx` file to
the moment the preview updates. Follow the numbers against the files.

```
   You edit App.jsx
        │
        ▼
(1) vscode fires onDidChangeTextDocument
        │                                         [extension host]
        ▼
(2) PreviewPanel's listener checks: is this the target file,
    its sibling CSS, or a file in the import graph?  (previewPanel.ts)
        │  yes
        ▼
(3) scheduleUpdate() — debounces ~300 ms so we don't
    transpile on every keystroke                     (previewPanel.ts)
        │
        ▼
(4) update() runs:                                   (previewPanel.ts)
     • bump a sequence number (to cancel stale runs)
     • does the file have relative imports?
         ├─ yes → transpiler.bundle(): walk the graph, transpile
         │         each file with Babel, collect css + npm packages
         └─ no  → transpiler.transpile(): one fast esbuild pass
        │
        ▼
(5) post a { type:'render', modules, css, packages, … } message
    across the boundary                              (previewPanel.ts → webview)
        │  postMessage (JSON only)
        ▼
(6) webview receives it                               (webview/main.ts)
     • updates the toolbar (file name, engine, version)
     • calls render(): builds a fresh <iframe srcdoc=…>
        │
        ▼
(7) the iframe HTML contains:                         (webview/main.ts, buildSrcdoc)
     • an import map (react + npm → esm.sh URLs)
     • the user's modules as blob URLs, linked in
       topological order
     • a bootstrap script that patches console, sets up
       an error boundary, and imports the entry module
        │
        ▼
(8) the iframe runs the user's component and renders it.
    console.log / errors post messages back UP:
    iframe → webview (shown in console panel / error overlay)
```

The key mental model: **the extension host decides *what* to render and ships
it as data; the webview decides *how* to mount it in the browser; the iframe
actually runs it.** State flows down as messages, and feedback (logs, errors)
flows back up as messages.

---

## 6. Where state lives

There is not much mutable state, and knowing where each piece lives removes
most confusion.

| State | Lives in | Notes |
| --- | --- | --- |
| The active target document | `PreviewPanel.target` (extension host) | Which file the preview is showing. Updated when you switch editors. |
| The import-graph file set | `PreviewPanel.graphFiles` | Normalized paths of every file in the current preview; drives live-reload. |
| The debounce timer & a sequence counter | `PreviewPanel.debounceTimer`, `PreviewPanel.updateSeq` | The counter cancels a slow transpile if a newer edit already started. |
| The chosen React version | `context.workspaceState` under `reactcanvas.reactVersion` | Persisted **per workspace** by VS Code. Read in `extension.ts`. |
| The transpiler instance (lazy) | a module-level promise in `extension.ts` | Built once, on first preview, so the wasm compile isn't paid at startup. |
| Console entries, panel height/open | webview DOM + `vscode.setState` | Lives in the *webview* world; persisted via the webview state API so it survives the panel being hidden. |
| The running component's own state | inside the **iframe** | React state, your `useState`, etc. Thrown away and recreated on every re-render (like a devtools reload). |

Two subtleties worth internalizing:

- **`workspaceState` vs. webview `setState`** are different persistence
  mechanisms. The former is the extension host's key/value store (survives
  across sessions, keyed to the workspace). The latter is the webview's own
  small state bag (survives the webview being backgrounded/restored). The React
  *version* is host state; the *console panel layout* is webview state.
- **The single-instance rule.** There is only ever one preview panel, held in
  the static `PreviewPanel.current`. Opening the preview again reveals the
  existing panel instead of making a second one.

---

## 7. Module-by-module reference

### `src/extension.ts` — the entry point (small on purpose)

`activate()` does four things and then gets out of the way:

1. Creates an output channel (for diagnostic logging).
2. Creates the **status bar item** showing the active React version; clicking
   it runs the version-select command.
3. Registers the three commands (`openPreview`, `selectReactVersion`,
   `newScratchFile`).
4. Defines `getTranspiler()`, which **lazily** builds the transpiler the first
   time a preview is opened (reading `dist/esbuild.wasm`, falling back to Babel
   if that fails).

Notice what `activate` does *not* do: it never opens a panel or transpiles.
It only wires up capabilities and waits.

### `src/previewPanel.ts` — the orchestrator (the file to know best)

This is where the extension "thinks". `PreviewPanel` is a class with a single
live instance. Its responsibilities:

- **Own the webview panel** (create it, set its HTML, dispose it).
- **Watch the editor**: follow the active editor to new `.jsx`/`.tsx` files,
  and listen for text changes to the target *or any file in the import graph*.
- **Debounce** edits and run `update()`.
- **Decide bundle vs. single-file** and call into `src/transpiler`.
- **Assemble the render payload** (modules, css, packages) and `post()` it.
- **Build the HTML shell** and its Content-Security-Policy.

If you only deeply learn one file, learn this one — every feature passes
through `update()`.

### `src/messages.ts` — the contract

Pure type declarations describing the messages that cross the host⇄webview
boundary: `render`, `transpile-error`, `no-target` (host → webview) and
`ready`, `select-version` (webview → host). When you add a feature that needs
new data in the preview, you extend a type here first, then update both sides.
Think of this file as the API spec between the two worlds.

### `src/transpiler/` — the compiler subsystem

Pure, `vscode`-free, and the most heavily unit-tested part:

- **`index.ts`** exposes a `Transpiler` with two operations: `transpile()`
  (one file, fast, via esbuild-wasm) and `bundle()` (a whole import graph, via
  Babel). It also has the engine-selection logic and error normalization.
- **`pathResolver.ts`** is path arithmetic: normalize slashes, resolve `./x`
  against a directory, list candidate files for `./Button`
  (`Button.tsx`, `Button/index.tsx`, …).
- **`moduleGraph.ts`** understands *import statements as text*: find the
  specifiers in a file, rewrite a specifier to a new target, topologically sort
  modules so dependencies come first.
- **`packages.ts`** decides which bare imports are third-party (everything but
  react/react-dom) and builds their esm.sh URLs.

### `src/webview/main.ts` — the browser-side app

The largest file, because it *is* a small single-page app. It builds the
toolbar and console panel, receives `render` messages, constructs the sandboxed
iframe (`buildSrcdoc`), and relays iframe messages (logs, errors) into the UI.
Two of its pure helpers (`rewriteSpecifier`, `topoSortModules`) are **injected
into the iframe by stringifying them**, because the iframe is a separate realm
with no module loader — a trick you'll see explained in the comments there and
in `consoleSerialize.ts`.

### `src/csp.ts` — the security policy

A single pure function that builds the Content-Security-Policy string for the
preview. Isolated and unit-tested so the security posture is explicit and hard
to weaken by accident.

---

## 8. The transpile & bundling pipeline in depth

There are two paths, chosen in `PreviewPanel.update()` by asking "does this
file have any relative import?".

**Single-file path (fast).** No relative imports → one call to
`transpiler.transpile()`, which runs esbuild-wasm's `transform` on the source.
esbuild is fast and runs the WebAssembly in-process. The output is one module.

**Multi-file path (bundle).** Any relative import → `transpiler.bundle()` walks
the import graph breadth-first starting from the entry:

1. Transpile the current file with **Babel** (not esbuild — see the note below).
2. Find its import specifiers (`moduleGraph.extractSpecifiers`).
3. For each relative specifier, resolve it to a real file
   (`pathResolver` candidate list) and enqueue it; collect `.css` contents
   separately; record third-party (npm) specifiers.
4. Repeat until the graph is exhausted.

The result is a list of `{ path, code, imports }` modules plus the collected
CSS and npm package list. The webview links them.

> **Why Babel for bundling and esbuild for single files?** esbuild-wasm's
> `build`-with-plugins API needs asynchronous plugin callbacks that deadlock
> under the in-process (`worker: false`) wasm we run in the extension host —
> repeated transforms starve its Go scheduler. Babel's transform is synchronous
> pure JS, so walking a graph of N files is reliable. Single-file previews keep
> the fast esbuild path because a single transform is safe. This trade-off is
> the reason `bundle()` and `transpile()` use different engines, and it's worth
> remembering before you try to "simplify" them into one.

**Linking without a bundler.** We never concatenate modules ourselves. Instead
each transpiled module becomes a **blob URL** inside the iframe; relative
imports are rewritten to point at the right blob URL, in topological order, and
the browser's native ES module loader does the actual linking. Bare imports
(react, npm) fall through to the **import map**.

---

## 9. The webview runtime in depth

`buildSrcdoc()` in `main.ts` assembles a complete little HTML document that is
dropped into `<iframe srcdoc="…">`. It contains, in order:

1. **An import map** — `react`, `react-dom`, and every npm package mapped to an
   esm.sh URL. This is how bare `import` specifiers resolve in the browser with
   no bundler. Third-party packages use `?external=react,react-dom` so they
   share the one React instance the preview already loaded (critical: otherwise
   hooks break across package boundaries).
2. **A bootstrap module script** that:
   - patches `console.*` to forward serialized arguments up to the webview;
   - installs global `error`/`unhandledrejection` handlers and a React error
     boundary;
   - injects the collected CSS;
   - creates a blob URL per user module, rewrites specifiers, imports the entry,
     finds the default (or single named) export, and renders it.

Messages flow **iframe → webview** as `{ source:'reactcanvas-iframe', type:… }`
objects: `console`, `runtime-error`, `rendered`, `no-component`. The webview's
`handleIframeMessage` routes these to the console panel or the error overlay.

The sandbox is deliberately minimal: `allow-scripts` only. It is **not**
same-origin, which is why the iframe's network requests carry `Origin: null`
(documented as a known limitation) — that opacity is the price of keeping the
iframe unable to reach the webview or extension host.

---

## 10. Build, test, and release toolchain

**Build (`esbuild.mjs`).** Produces two bundles: `dist/extension.js` (CommonJS,
Node target, `vscode` external) and `dist/webview.js` (IIFE, browser target).
It also copies `esbuild.wasm` into `dist/`. During development,
`npm run watch` rebuilds on change; press `F5` in VS Code to launch an
"Extension Development Host" — a second VS Code window with your extension
loaded.

**Tests.**

- `npm run test:unit` — Mocha over the pure modules in `src/test/unit/`. Fast,
  no VS Code. This is where the transpiler, path resolver, module graph,
  packages, CSP, and console serializer are verified.
- `npm run test:integration` — launches a real VS Code via
  `@vscode/test-electron` and asserts the extension activates and registers its
  commands, and that opening previews doesn't throw.

**CI/CD (`.github/workflows/`).** `ci.yml` runs lint, typecheck, both test
suites, and packages a `.vsix` artifact on every push/PR. `release.yml` fires on
a `v*` tag: it packages the `.vsix`, creates a GitHub Release, and publishes to
the VS Code Marketplace and Open VSX (each skipped gracefully if its token
secret is absent).

**Packaging (`.vscodeignore`).** Controls what ends up in the shipped `.vsix`.
Only `dist/`, the icon, README, CHANGELOG, LICENSE, and `package.json` ship —
source, tests, and examples are excluded to keep the download small.

---

## 11. How to make common changes

A few worked recipes to build muscle memory. Each names the files you touch.

**Add a new command.**
1. Declare it in `package.json` under `contributes.commands` (and a menu if you
   want a button).
2. Register it in `extension.ts` with `vscode.commands.registerCommand`.
3. If it should affect the preview, call a method on `PreviewPanel.current`.

**Add data to the render payload** (say, a new toolbar field).
1. Extend the `render` message type in `messages.ts`.
2. Populate it in `PreviewPanel.update()`.
3. Consume it in `webview/main.ts`'s `handleHostMessage`.

**Change how user code is compiled.** Work inside `src/transpiler/` — and add
a unit test in `src/test/unit/` first (the pipeline is designed to be tested in
isolation, so you rarely need to launch VS Code to verify compiler changes).

**Change the preview's security/network rules.** Edit `src/csp.ts` and its
test. Be conservative with `script-src` and never add `allow-same-origin` to
the iframe sandbox.

**Cut a release.** Bump `version` in `package.json`, move the `Unreleased`
notes into a dated section in `CHANGELOG.md`, commit, then
`git tag vX.Y.Z && git push origin vX.Y.Z`.

---

## 12. Glossary

- **Extension host** — the Node.js process where your extension code runs; the
  only place with the `vscode` API.
- **Webview** — an embedded browser page an extension can render custom UI
  into; no `vscode` API, communicates by messages.
- **`contributes`** — the `package.json` section that declaratively registers
  commands, menus, settings, etc.
- **Activation event** — a condition that causes VS Code to load (activate)
  your extension.
- **Transpile** — convert JSX/TSX into plain browser JavaScript (strip types,
  turn `<div/>` into function calls).
- **Bundle** — follow a file's imports and gather the whole graph so it can run
  as a unit. Here, the browser does the final linking via blob URLs.
- **Import map** — a browser standard mapping bare specifiers (`react`) to URLs,
  letting `import` work without a bundler.
- **CSP (Content-Security-Policy)** — a browser policy restricting what a page
  may load and connect to; our main sandboxing control for the preview.
- **`.vsix`** — the packaged, installable extension file.

---

## 13. A learning path

If you want to genuinely own this project, do these in order. Each step is
concrete and builds on the last.

1. **Ship a trivial change end to end.** Change the toolbar text in
   `webview/main.ts`, run `npm run watch`, press `F5`, and see it. This proves
   your build/run loop works and demystifies the webview.
2. **Read `previewPanel.ts` with this doc open.** Trace `update()` line by
   line. It's the spine of the extension.
3. **Read the official docs once.** The
   [Extension API overview](https://code.visualstudio.com/api) and especially
   the [Webview guide](https://code.visualstudio.com/api/extension-guides/webview)
   will make every `vscode.*` call here obvious.
4. **Break a test on purpose.** Change a transpiler behavior, watch the unit
   test fail, fix it. This teaches you the pure core and the safety net around
   it.
5. **Add a small feature through the whole stack.** For example, show the
   rendered component's name in the toolbar: add it to the `render` message,
   set it in `update()`, display it in `handleHostMessage`. Touching all three
   layers cements the two-worlds model.
6. **Do a dry-run release** on a scratch tag and read the workflow logs. Owning
   the release process is part of owning the project.

When steps 1–6 feel routine, you own ReactCanvas.
