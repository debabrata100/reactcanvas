# Changelog

All notable changes to ReactCanvas are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-07-13

### Added
- **Console panel**: `console.log`/`info`/`warn`/`error`/`debug` from your component now appear in a collapsible panel inside the preview, with level colouring and a Clear button. Toggle it from the Console button in the preview toolbar.
- Values are formatted devtools-style — objects, arrays, `Map`/`Set`, class instances, DOM nodes, errors with stacks — with circular references, deep nesting and huge collections handled safely.
- Consecutive duplicate messages collapse into a single row with a repeat count, and output is capped per render so a render loop can't flood the panel.
- The panel opens automatically when a `warn` or `error` is logged, and clears on each re-render (matching devtools behaviour on reload).

## [Unreleased]

### Planned
- Multi-file import resolution (follow relative imports and bundle them into the preview)
- Import maps for arbitrary npm packages via esm.sh
- Source-mapped runtime stack traces

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

[Unreleased]: https://github.com/debabrata100/reactcanvas/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/debabrata100/reactcanvas/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/debabrata100/reactcanvas/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/debabrata100/reactcanvas/releases/tag/v0.1.0
