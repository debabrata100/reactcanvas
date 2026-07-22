# Changelog

All notable changes to ReactCanvas are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Source-mapped runtime stack traces
- Version pinning for npm packages

## [0.5.0] — 2026-07-13

### Added
- **npm package imports**: any bare import beyond `react`/`react-dom` (for example `import clsx from 'clsx'`) now resolves from [esm.sh](https://esm.sh) automatically, with no install step. Packages are marked `external` for React so they share the single React instance the preview already loaded — hooks and context work across package boundaries.
- Package specifiers are collected across the whole import graph and added to the preview's import map; the content-security policy admits esm.sh for scripts, styles and fonts.

### Known limitations
- Packages resolve to their latest esm.sh version; explicit version pinning is not supported yet.

## [0.4.0] — 2026-07-13

### Added
- **Multi-file preview**: relative imports are now followed and bundled into the preview. `import Card from './Card'`, folder `index` files, extensionless specifiers (`./Button` → `Button.tsx`), and imported `.css` files across the whole graph all work.
- Live reload watches every file in the resolved import graph, so editing an imported component or stylesheet re-renders the preview.
- The toolbar shows the file count (e.g. `via babel · 4 files`) when a preview spans multiple modules.

### Changed
- Multi-file previews transpile each file with `@babel/standalone` and let the browser's native ES module loader link them via blob URLs. Single-file previews keep using the faster esbuild path. (esbuild-wasm's in-process build can't service the plugin callbacks that graph bundling needs.)

### Known limitations
- Circular imports between modules aren't supported yet and surface as an error.
- Only relative imports resolve; bare npm packages other than `react`/`react-dom` are still external (see Roadmap: esm.sh import maps).

## [0.3.0] — 2026-07-13

### Added
- **Console panel**: `console.log`/`info`/`warn`/`error`/`debug` from your component now appear in a collapsible panel inside the preview, with level colouring and a Clear button. Toggle it from the Console button in the preview toolbar.
- Values are formatted devtools-style — objects, arrays, `Map`/`Set`, class instances, DOM nodes, errors with stacks — with circular references, deep nesting and huge collections handled safely.
- Consecutive duplicate messages collapse into a single row with a repeat count, and output is capped per render so a render loop can't flood the panel.
- The panel opens automatically when a `warn` or `error` is logged, and clears on each re-render (matching devtools behaviour on reload).
- **Resizable console**: drag the sash at the top of the panel (or its header) to change its height, double-click to maximize, and use the ⌃/⌄ button to maximize/restore. The panel size and open/closed state persist across sessions.

## [0.2.0] — 2026-07-13

### Added
- **Scratch files (Quokka-style)**: preview now works for unsaved (untitled) documents — target detection uses the document language, not just the file extension.
- New command `ReactCanvas: New React Scratch File` — opens an untitled JSX or TSX document pre-filled with a starter component and the live preview already attached. No file on disk needed. The TSX template starts with `@ts-nocheck`, since React type declarations can't resolve outside a project (the preview itself never needs them).
- The editor-title preview button now appears for any document with a React language mode, including untitled ones.

## [0.1.0] — 2026-07-13

Initial release.

### Added
- **Live preview**: `ReactCanvas: Open Preview` renders the active `.jsx`/`.tsx` file in a webview panel beside the editor, with ~300 ms debounced live reload.
- **In-memory transpilation** via esbuild-wasm (browser build, no child processes), with automatic `@babel/standalone` fallback.
- **React version selector**: switch between React 17, 18, and 19 (`ReactCanvas: Select React Version`), loaded from esm.sh via import maps; persisted per workspace and shown in the status bar.
- **Error overlay**: transpile errors with line numbers, plus runtime errors caught via error boundary and global handlers.
- **CSS support**: inline styles, and automatic injection of a same-name sibling `.css` file.
- **Security**: strict CSP with nonces; user code runs only inside a sandboxed iframe.
- Theme-aware preview chrome (light/dark).
- Published to the VS Code Marketplace and Open VSX.

[Unreleased]: https://github.com/debabrata100/reactcanvas/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/debabrata100/reactcanvas/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/debabrata100/reactcanvas/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/debabrata100/reactcanvas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/debabrata100/reactcanvas/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/debabrata100/reactcanvas/releases/tag/v0.1.0
