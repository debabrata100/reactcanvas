# ReactCanvas

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/debabrata100.reactcanvas?label=VS%20Code%20Marketplace&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=debabrata100.reactcanvas)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/debabrata100.reactcanvas)](https://marketplace.visualstudio.com/items?itemName=debabrata100.reactcanvas)
[![Open VSX](https://img.shields.io/open-vsx/v/debabrata100/reactcanvas?label=Open%20VSX&color=a60ee5)](https://open-vsx.org/extension/debabrata100/reactcanvas)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A live React playground and preview for `.jsx` / `.tsx` files, right inside VS Code. No dev server, no project build setup — open a component file and see it render.

## Install

**[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=debabrata100.reactcanvas)** — or search for “ReactCanvas” in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`), or from the command line:

```bash
code --install-extension debabrata100.reactcanvas
```

Also available on [Open VSX](https://open-vsx.org/extension/debabrata100/reactcanvas) for VSCodium, Gitpod, and other VS Code-compatible editors.

![Usage demo](images/preview.gif)

I built this because I got tired of spinning up a whole Vite project just to check what one component looks like. Open the file, hit preview, done.

## Features

| Feature | Details |
| --- | --- |
| Live preview | `ReactCanvas: Open Preview` opens a panel beside your editor |
| Scratch files | `ReactCanvas: New React Scratch File` — a ready-to-edit component with live preview, no file on disk needed; unsaved/untitled files preview too |
| In-memory transpile | esbuild-wasm (with automatic `@babel/standalone` fallback) — no Node child processes, no bundler config |
| Multi-file components | Relative imports are followed and bundled — `import Card from './Card'`, folder `index` files, and imported `.css` all work. Live reload watches the whole graph |
| npm packages | `import clsx from 'clsx'` just works — third-party packages are loaded from [esm.sh](https://esm.sh) on demand, sharing the preview's React instance. No install step |
| Live reload | Re-renders ~300 ms after you stop typing |
| React version selector | Switch between React 17, 18, and 19 (`ReactCanvas: Select React Version`), loaded from esm.sh via import maps; persisted per workspace and shown in the status bar |
| Console panel | `console.log` & friends appear in a collapsible panel inside the preview — objects, arrays, Maps, errors and circular structures formatted devtools-style. Drag to resize, double-click to maximize; size persists |
| Error overlay | Transpile errors (with line numbers) and runtime errors shown in the preview, not just the console |
| Hooks & multiple components | `useState`, `useEffect`, etc. work out of the box; the default export is rendered as the root |
| CSS support | Inline styles, plus a same-name `.css` file next to your component is injected automatically (`Button.jsx` → `Button.css`) |
| Theme aware | Preview chrome follows your VS Code light/dark theme |
| Secure by design | Strict CSP with nonces; user code runs only inside a sandboxed iframe |

## Usage

1. Open a `.jsx` or `.tsx` file with a default export:

   ```jsx
   export default function App() {
     const [count, setCount] = React.useState(0);
     return <button onClick={() => setCount(count + 1)}>Clicked {count}×</button>;
   }
   ```

2. Run **ReactCanvas: Open Preview** from the Command Palette (or the editor title button).
3. Edit — the preview reloads as you type.
4. Click the React version badge (in the preview toolbar or status bar) to switch React versions.

No file handy? Run **ReactCanvas: New React Scratch File** — it opens an untitled JSX or TSX file pre-filled with a starter component and the preview already attached. Nothing touches your disk until you decide to save.

> The preview loads React and any npm packages from [esm.sh](https://esm.sh), so it needs network access.

## Requirements

None. No local React install, no build configuration.

## Known limitations

- npm packages are resolved to their latest version on esm.sh; specific version pinning isn't supported yet.
- Components can call `fetch` and open WebSockets, but the sandboxed preview sends `Origin: null`, so an API must allow requests from any origin.
- Circular imports between local modules aren't supported and surface as an error.
- Runtime error stack traces reference compiled code, not original source lines.

## Roadmap

- Source-mapped runtime stack traces.
- Version pinning for npm packages (e.g. `clsx@2`).
- Prop playground / knobs for the root component.

## Development

```bash
npm install
npm run watch        # rebuild on change; F5 in VS Code to launch the extension host
npm test             # lint-free unit + integration tests
npm run package      # build a .vsix
```

## License

[MIT](LICENSE)
