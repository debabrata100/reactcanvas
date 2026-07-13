# Changelog

All notable changes to ReactCanvas are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Scratch files (Quokka-style)**: preview now works for unsaved (untitled) documents — target detection uses the document language, not just the file extension.
- New command `ReactCanvas: New React Scratch File` — opens an untitled JSX or TSX document pre-filled with a starter component and the live preview already attached. No file on disk needed.
- The editor-title preview button now appears for any document with a React language mode, including untitled ones.

### Planned
- Multi-file import resolution (follow relative imports and bundle them into the preview)
- Import maps for arbitrary npm packages via esm.sh
- Source-mapped runtime stack traces

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

[Unreleased]: https://github.com/debabrata100/reactcanvas/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/debabrata100/reactcanvas/releases/tag/v0.1.0
