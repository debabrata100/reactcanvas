/**
 * Webview script: the preview "chrome". Receives transpiled code from the
 * extension host and runs it inside a sandboxed srcdoc iframe. User code
 * NEVER executes in this document.
 */
import type { HostMessage, ReactVersion, RenderModule } from '../messages';
import { serializeConsoleArg } from './consoleSerialize';
import { rewriteSpecifier, topoSortModules } from '../transpiler/moduleGraph';
import { esmShUrl } from '../transpiler/packages';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const appEl = document.getElementById('app') as HTMLElement;
const nonce = appEl.dataset.nonce ?? '';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** Message posted by the loader script inside the iframe. */
interface IframeMessage {
  source: 'reactcanvas-iframe';
  type: 'rendered' | 'runtime-error' | 'no-component' | 'console';
  message?: string;
  stack?: string;
  componentStack?: string;
  line?: number;
  column?: number;
  exports?: string[];
  component?: string;
  level?: ConsoleLevel;
  text?: string;
}

// ---------------------------------------------------------------------------
// DOM scaffold (theme via --vscode-* variables)
// ---------------------------------------------------------------------------

const style = document.createElement('style');
style.textContent = `
  html, body { height: 100%; margin: 0; padding: 0; }
  #app { display: flex; flex-direction: column; height: 100vh; font-family: var(--vscode-font-family); }
  .rc-toolbar {
    display: flex; align-items: center; gap: 8px; padding: 4px 10px;
    font-size: 12px; color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    flex: 0 0 auto; user-select: none;
  }
  .rc-toolbar .rc-file { color: var(--vscode-foreground); font-weight: 600; }
  .rc-toolbar .rc-version {
    cursor: pointer; padding: 1px 7px; border-radius: 9px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .rc-toolbar .rc-engine { opacity: 0.7; }
  .rc-stage { position: relative; flex: 1 1 auto; min-height: 0; }
  .rc-stage iframe { width: 100%; height: 100%; border: 0; display: block; }
  .rc-overlay {
    position: absolute; inset: 0; overflow: auto; padding: 16px 20px;
    background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
    color: var(--vscode-foreground); display: none; box-sizing: border-box;
  }
  .rc-overlay.visible { display: block; }
  .rc-overlay h2 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
  .rc-overlay.error h2 { color: var(--vscode-errorForeground, #f48771); }
  .rc-overlay.info h2 { color: var(--vscode-descriptionForeground); }
  .rc-overlay pre {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
    white-space: pre-wrap; word-break: break-word;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
    padding: 10px 12px; border-radius: 4px; margin: 6px 0;
  }
  .rc-overlay .rc-loc { color: var(--vscode-errorForeground, #f48771); font-weight: 600; }
  .rc-overlay p { font-size: 13px; line-height: 1.5; }
  .rc-empty {
    display: flex; align-items: center; justify-content: center; height: 100%;
    color: var(--vscode-descriptionForeground); font-size: 13px; text-align: center; padding: 0 24px;
  }
  .rc-toolbar button {
    font: inherit; font-size: 11px; color: var(--vscode-foreground);
    background: transparent; border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.4));
    border-radius: 4px; padding: 1px 8px; cursor: pointer;
  }
  .rc-toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.2)); }
  .rc-console {
    flex: 0 0 auto; display: none; flex-direction: column;
    height: 180px; min-height: 0; position: relative;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.35));
    background: var(--vscode-panel-background, var(--vscode-editor-background));
  }
  .rc-console.visible { display: flex; }
  /* Grab strip straddling the top border. */
  .rc-resize {
    position: absolute; top: -3px; left: 0; right: 0; height: 7px;
    cursor: ns-resize; z-index: 2; flex: 0 0 auto;
  }
  .rc-resize:hover, .rc-console.resizing .rc-resize {
    background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder, #007acc));
    opacity: 0.7;
  }
  /* While dragging, keep the pointer glued to the sash. */
  .rc-console.resizing, .rc-console.resizing * { user-select: none; }
  .rc-console-header {
    display: flex; align-items: center; gap: 8px; padding: 3px 10px; flex: 0 0 auto;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground); user-select: none; cursor: ns-resize;
  }
  .rc-console-header button { cursor: pointer; }
  .rc-console-log {
    flex: 1 1 auto; overflow-y: auto; padding: 2px 0;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.5;
  }
  .rc-console-empty { padding: 6px 10px; color: var(--vscode-descriptionForeground); font-style: italic; }
  .rc-entry {
    display: flex; gap: 8px; padding: 2px 10px; white-space: pre-wrap; word-break: break-word;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.12));
  }
  .rc-entry .rc-level { flex: 0 0 auto; opacity: 0.6; text-transform: uppercase; font-size: 10px; padding-top: 2px; min-width: 34px; }
  .rc-entry.warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  .rc-entry.error { color: var(--vscode-errorForeground, #f48771); }
  .rc-entry.debug { opacity: 0.75; }
  .rc-entry .rc-count {
    flex: 0 0 auto; align-self: flex-start; margin-left: auto;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    border-radius: 8px; padding: 0 6px; font-size: 10px;
  }
`;
document.head.appendChild(style);

appEl.innerHTML = `
  <div class="rc-toolbar">
    <span class="rc-file"></span>
    <span class="rc-engine"></span>
    <span style="flex:1"></span>
    <button class="rc-console-toggle" type="button" title="Toggle console output">Console</button>
    <span class="rc-version" title="Click to change React version"></span>
  </div>
  <div class="rc-stage">
    <div class="rc-empty">Waiting for a .jsx or .tsx file…</div>
    <div class="rc-overlay"><h2></h2><div class="rc-body"></div></div>
  </div>
  <div class="rc-console">
    <div class="rc-resize" title="Drag to resize — double-click to maximize"></div>
    <div class="rc-console-header" title="Drag to resize — double-click to maximize">
      <span>Console</span>
      <span style="flex:1"></span>
      <button class="rc-console-max" type="button" title="Maximize panel">⌃</button>
      <button class="rc-console-clear" type="button">Clear</button>
    </div>
    <div class="rc-console-log"><div class="rc-console-empty">No console output yet.</div></div>
  </div>
`;

const fileEl = appEl.querySelector('.rc-file') as HTMLElement;
const engineEl = appEl.querySelector('.rc-engine') as HTMLElement;
const versionEl = appEl.querySelector('.rc-version') as HTMLElement;
const stageEl = appEl.querySelector('.rc-stage') as HTMLElement;
const emptyEl = appEl.querySelector('.rc-empty') as HTMLElement;
const overlayEl = appEl.querySelector('.rc-overlay') as HTMLElement;
const overlayTitle = overlayEl.querySelector('h2') as HTMLElement;
const overlayBody = overlayEl.querySelector('.rc-body') as HTMLElement;

versionEl.addEventListener('click', () => vscode.postMessage({ type: 'select-version' }));

let iframe: HTMLIFrameElement | undefined;

// ---------------------------------------------------------------------------
// Console panel
// ---------------------------------------------------------------------------

const consoleEl = appEl.querySelector('.rc-console') as HTMLElement;
const consoleLogEl = appEl.querySelector('.rc-console-log') as HTMLElement;
const consoleToggleEl = appEl.querySelector('.rc-console-toggle') as HTMLButtonElement;
const consoleClearEl = appEl.querySelector('.rc-console-clear') as HTMLButtonElement;
const consoleMaxEl = appEl.querySelector('.rc-console-max') as HTMLButtonElement;
const consoleResizeEl = appEl.querySelector('.rc-resize') as HTMLElement;
const consoleHeaderEl = appEl.querySelector('.rc-console-header') as HTMLElement;

const MIN_CONSOLE_HEIGHT = 60;
/** Leave at least this much of the preview stage visible. */
const MIN_STAGE_HEIGHT = 80;
const DEFAULT_CONSOLE_HEIGHT = 180;

/**
 * Webview state survives the panel being hidden/restored, so both the last
 * render and the user's panel layout are persisted together.
 */
interface PersistedState {
  render?: Extract<HostMessage, { type: 'render' }>;
  ui?: { consoleOpen: boolean; height: number };
}

const persisted = (vscode.getState() as PersistedState | undefined) ?? {};
const uiState = persisted.ui ?? { consoleOpen: false, height: DEFAULT_CONSOLE_HEIGHT };

function savePersistedState(): void {
  vscode.setState({ ...persisted, ui: uiState } satisfies PersistedState);
}

let consoleOpen = false;
let entryCount = 0;
/** Last entry, tracked so repeated identical logs collapse into a count. */
let lastEntry: { level: ConsoleLevel; text: string; el: HTMLElement; count: number } | undefined;

function updateConsoleToggle(): void {
  consoleToggleEl.textContent = entryCount > 0 ? `Console (${entryCount})` : 'Console';
}

function setConsoleOpen(open: boolean): void {
  consoleOpen = open;
  consoleEl.classList.toggle('visible', open);
  uiState.consoleOpen = open;
  savePersistedState();
  if (open) {
    setConsoleHeight(uiState.height);
  }
}

function clearConsole(): void {
  entryCount = 0;
  lastEntry = undefined;
  consoleLogEl.innerHTML = '<div class="rc-console-empty">No console output yet.</div>';
  updateConsoleToggle();
}

function appendConsoleEntry(level: ConsoleLevel, text: string): void {
  // Collapse consecutive duplicates (render loops otherwise flood the panel).
  if (lastEntry && lastEntry.level === level && lastEntry.text === text) {
    lastEntry.count += 1;
    let badge = lastEntry.el.querySelector('.rc-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'rc-count';
      lastEntry.el.appendChild(badge);
    }
    badge.textContent = String(lastEntry.count);
    return;
  }

  if (entryCount === 0) {
    consoleLogEl.innerHTML = '';
  }

  // Stick to the bottom only if the user is already there.
  const pinned = consoleLogEl.scrollTop + consoleLogEl.clientHeight >= consoleLogEl.scrollHeight - 20;

  const entry = document.createElement('div');
  entry.className = `rc-entry ${level}`;
  const levelEl = document.createElement('span');
  levelEl.className = 'rc-level';
  levelEl.textContent = level;
  const textEl = document.createElement('span');
  textEl.textContent = text; // textContent, never innerHTML: user data
  entry.append(levelEl, textEl);
  consoleLogEl.appendChild(entry);

  entryCount += 1;
  lastEntry = { level, text, el: entry, count: 1 };
  updateConsoleToggle();

  if (pinned) {
    consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
  }
  // Surface warnings and errors even when the panel is collapsed.
  if (!consoleOpen && (level === 'error' || level === 'warn')) {
    setConsoleOpen(true);
  }
}

// --- resize / maximize -----------------------------------------------------

function maxConsoleHeight(): number {
  return Math.max(MIN_CONSOLE_HEIGHT, appEl.clientHeight - MIN_STAGE_HEIGHT);
}

/** Height to restore to when un-maximizing; undefined while not maximized. */
let restoreHeight: number | undefined;

function setConsoleHeight(height: number, persist = true): void {
  const clamped = Math.min(Math.max(height, MIN_CONSOLE_HEIGHT), maxConsoleHeight());
  consoleEl.style.height = `${clamped}px`;
  const maximized = clamped >= maxConsoleHeight() - 1;
  consoleMaxEl.textContent = maximized ? '⌄' : '⌃';
  consoleMaxEl.title = maximized ? 'Restore panel size' : 'Maximize panel';
  if (persist) {
    uiState.height = clamped;
    savePersistedState();
  }
}

function toggleMaximize(): void {
  const current = consoleEl.getBoundingClientRect().height;
  if (current >= maxConsoleHeight() - 1) {
    setConsoleHeight(restoreHeight ?? DEFAULT_CONSOLE_HEIGHT);
    restoreHeight = undefined;
  } else {
    restoreHeight = current;
    setConsoleHeight(maxConsoleHeight());
  }
}

function beginResize(event: PointerEvent): void {
  // Ignore drags that start on the header's buttons.
  if ((event.target as HTMLElement).closest('button')) {
    return;
  }
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = consoleEl.getBoundingClientRect().height;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  consoleEl.classList.add('resizing');

  const onMove = (move: PointerEvent): void => {
    // Dragging up (smaller clientY) grows the panel.
    setConsoleHeight(startHeight + (startY - move.clientY), false);
  };
  const onUp = (): void => {
    handle.releasePointerCapture(event.pointerId);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
    consoleEl.classList.remove('resizing');
    restoreHeight = undefined; // a manual drag defines the new restore point
    setConsoleHeight(consoleEl.getBoundingClientRect().height);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

consoleToggleEl.addEventListener('click', () => setConsoleOpen(!consoleOpen));
consoleClearEl.addEventListener('click', clearConsole);
consoleMaxEl.addEventListener('click', toggleMaximize);
consoleResizeEl.addEventListener('pointerdown', beginResize);
consoleHeaderEl.addEventListener('pointerdown', beginResize);
consoleResizeEl.addEventListener('dblclick', toggleMaximize);
consoleHeaderEl.addEventListener('dblclick', (e) => {
  if (!(e.target as HTMLElement).closest('button')) {
    toggleMaximize();
  }
});
// Keep the panel within bounds when the webview itself is resized.
window.addEventListener('resize', () => {
  if (consoleOpen) {
    setConsoleHeight(consoleEl.getBoundingClientRect().height);
  }
});
updateConsoleToggle();

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showOverlay(kind: 'error' | 'info', title: string, bodyHtml: string): void {
  overlayEl.classList.add('visible');
  overlayEl.classList.toggle('error', kind === 'error');
  overlayEl.classList.toggle('info', kind === 'info');
  overlayTitle.textContent = title;
  overlayBody.innerHTML = bodyHtml;
}

function hideOverlay(): void {
  overlayEl.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Sandboxed iframe with import map + blob-module loader
// ---------------------------------------------------------------------------

/** JSON-encode for safe embedding inside an inline <script>. */
function embed(value: unknown): string {
  // < escaping prevents '</script>' inside embedded user code from closing
  // the inline script tag early.
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function importMap(version: ReactVersion, packages: string[]): Record<string, string> {
  const map: Record<string, string> = {
    react: `https://esm.sh/react@${version}`,
    'react/jsx-runtime': `https://esm.sh/react@${version}/jsx-runtime`,
    'react/jsx-dev-runtime': `https://esm.sh/react@${version}/jsx-dev-runtime`,
    // external=react makes react-dom resolve `react` through this import
    // map too, so both packages share a single React instance.
    'react-dom': `https://esm.sh/react-dom@${version}?external=react`,
  };
  if (version !== '17') {
    map['react-dom/client'] = `https://esm.sh/react-dom@${version}/client?external=react`;
  }
  // Third-party packages resolve to esm.sh, sharing the React above.
  for (const specifier of packages) {
    if (!(specifier in map)) {
      map[specifier] = esmShUrl(specifier);
    }
  }
  return map;
}

function buildSrcdoc(
  modules: RenderModule[],
  entryPath: string,
  css: string,
  version: ReactVersion,
  packages: string[]
): string {
  const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
  const renderSnippet =
    version === '17'
      ? `import ReactDOM from 'react-dom';
         const doRender = (el) => ReactDOM.render(el, document.getElementById('root'));`
      : `import { createRoot } from 'react-dom/client';
         const doRender = (el) => createRoot(document.getElementById('root')).render(el);`;

  const loader = `
    import React from 'react';
    ${renderSnippet}
    const post = (m) => window.parent.postMessage(Object.assign({ source: 'reactcanvas-iframe' }, m), '*');

    // --- console capture -------------------------------------------------
    // The serializer is shared with the chrome and injected by stringifying
    // it; the iframe is a separate realm with no module loader of its own.
    const serializeConsoleArg = ${serializeConsoleArg.toString()};
    let consoleBudget = 500; // guards against render loops flooding the panel
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const original = console[level] ? console[level].bind(console) : () => {};
      console[level] = (...args) => {
        original(...args);
        if (consoleBudget <= 0) {
          return;
        }
        consoleBudget -= 1;
        try {
          const text = consoleBudget === 0
            ? 'ReactCanvas: console output limit reached — further messages are suppressed.'
            : args.map((a) => serializeConsoleArg(a)).join(' ');
          post({ type: 'console', level: consoleBudget === 0 ? 'warn' : level, text });
        } catch {
          post({ type: 'console', level, text: '[unserializable value]' });
        }
      };
    }
    // ---------------------------------------------------------------------
    window.addEventListener('error', (e) => {
      post({ type: 'runtime-error', message: e.message, stack: e.error && e.error.stack, line: e.lineno, column: e.colno });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      post({ type: 'runtime-error', message: String((r && r.message) || r), stack: r && r.stack });
    });

    const css = ${embed(css)};
    if (css) {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    }

    class RCBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null }; }
      static getDerivedStateFromError(err) { return { err }; }
      componentDidCatch(err, info) {
        post({ type: 'runtime-error', message: String((err && err.message) || err), stack: err && err.stack, componentStack: info && info.componentStack });
      }
      render() { return this.state.err ? null : this.props.children; }
    }

    // --- module linking --------------------------------------------------
    // Each module becomes its own blob URL; relative specifiers are rewritten
    // to the blob URL of the module they resolve to, in dependency order, so
    // the browser's native ES loader links the graph. Bare specifiers (react,
    // react-dom) fall through to the import map above.
    const rcModules = ${embed(modules)};
    const rcEntryPath = ${embed(entryPath)};
    const rewriteSpecifier = ${rewriteSpecifier.toString()};
    const topoSortModules = ${topoSortModules.toString()};

    (async () => {
      try {
        let ordered;
        try {
          ordered = topoSortModules(rcModules);
        } catch (err) {
          post({ type: 'runtime-error', message: String((err && err.message) || err) });
          return;
        }
        const blobUrls = {};
        for (const m of ordered) {
          let moduleCode = m.code;
          for (const spec of Object.keys(m.imports)) {
            moduleCode = rewriteSpecifier(moduleCode, spec, blobUrls[m.imports[spec]]);
          }
          blobUrls[m.path] = URL.createObjectURL(new Blob([moduleCode], { type: 'text/javascript' }));
        }
        const mod = await import(blobUrls[rcEntryPath]);
        let Component = mod.default;
        let picked = 'default export';
        if (typeof Component !== 'function' && typeof Component !== 'object') {
          const candidates = Object.entries(mod).filter(([name, value]) =>
            /^[A-Z]/.test(name) && typeof value === 'function');
          if (candidates.length === 1) {
            Component = candidates[0][1];
            picked = candidates[0][0] + ' (named export)';
          }
        }
        if (typeof Component !== 'function' && typeof Component !== 'object') {
          post({ type: 'no-component', exports: Object.keys(mod) });
          return;
        }
        doRender(React.createElement(RCBoundary, null, React.createElement(Component)));
        post({ type: 'rendered', component: picked });
      } catch (err) {
        post({ type: 'runtime-error', message: String((err && err.message) || err), stack: err && err.stack });
      }
    })();
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script type="importmap" nonce="${nonce}">${JSON.stringify({ imports: importMap(version, packages) })}</script>
  <style>
    :root { color-scheme: ${isDark ? 'dark' : 'light'}; }
    body { margin: 8px; font-family: system-ui, sans-serif; background: ${isDark ? '#1f1f1f' : '#ffffff'}; color: ${isDark ? '#e6e6e6' : '#1f1f1f'}; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}">${loader}</script>
</body>
</html>`;
}

function render(
  modules: RenderModule[],
  entryPath: string,
  css: string,
  version: ReactVersion,
  packages: string[]
): void {
  emptyEl.style.display = 'none';
  // Each render creates a fresh realm, so old output no longer reflects the
  // running preview (devtools behaves the same way on reload).
  clearConsole();
  iframe?.remove();
  iframe = document.createElement('iframe');
  // allow-scripts only: no same-origin, no forms, no popups, no top navigation.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.srcdoc = buildSrcdoc(modules, entryPath, css, version, packages);
  stageEl.insertBefore(iframe, overlayEl);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleHostMessage(msg: HostMessage): void {
  switch (msg.type) {
    case 'render': {
      persisted.render = msg;
      savePersistedState();
      fileEl.textContent = msg.fileName;
      engineEl.textContent = msg.fileCount > 1 ? `via ${msg.engine} · ${msg.fileCount} files` : `via ${msg.engine}`;
      versionEl.textContent = `React ${msg.reactVersion}`;
      render(msg.modules, msg.entryPath, msg.css, msg.reactVersion, msg.packages);
      // Keep the previous frame visible under the overlay until the new
      // one reports success; transpile is already validated, so just wait.
      break;
    }
    case 'transpile-error': {
      fileEl.textContent = msg.fileName;
      const items = msg.errors
        .map((e) => {
          const loc = e.line != null ? `<span class="rc-loc">${msg.fileName}:${e.line}${e.column != null ? ':' + e.column : ''}</span>\n` : '';
          return `<pre>${loc}${escapeHtml(e.message)}</pre>`;
        })
        .join('');
      showOverlay('error', 'Transpile error', items);
      break;
    }
    case 'no-target': {
      emptyEl.style.display = '';
      emptyEl.textContent = msg.reason;
      iframe?.remove();
      iframe = undefined;
      hideOverlay();
      clearConsole();
      break;
    }
  }
}

function handleIframeMessage(msg: IframeMessage): void {
  switch (msg.type) {
    case 'rendered':
      hideOverlay();
      break;
    case 'console':
      appendConsoleEntry(msg.level ?? 'log', msg.text ?? '');
      break;
    case 'runtime-error': {
      const loc = msg.line != null ? `<span class="rc-loc">line ${msg.line}${msg.column != null ? ':' + msg.column : ''} (compiled)</span>\n` : '';
      const stack = msg.stack ? escapeHtml(msg.stack) : escapeHtml(msg.message ?? 'Unknown error');
      const componentStack = msg.componentStack
        ? `<pre>Component stack:${escapeHtml(msg.componentStack)}</pre>`
        : '';
      showOverlay('error', 'Runtime error', `<pre>${loc}${stack}</pre>${componentStack}`);
      break;
    }
    case 'no-component': {
      const exportList = msg.exports && msg.exports.length > 0
        ? `<p>Exports found: <code>${msg.exports.map(escapeHtml).join(', ')}</code></p>`
        : '<p>No exports were found in this file.</p>';
      showOverlay(
        'info',
        'No component to render',
        `<p>ReactCanvas renders the <strong>default export</strong> of the active file
          (or a single capitalized named export as a fallback).</p>
         ${exportList}
         <p>Add something like:</p>
         <pre>export default function App() {\n  return &lt;h1&gt;Hello&lt;/h1&gt;;\n}</pre>`
      );
      break;
    }
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as IframeMessage | HostMessage;
  if (data && (data as IframeMessage).source === 'reactcanvas-iframe') {
    handleIframeMessage(data as IframeMessage);
  } else if (data && typeof (data as HostMessage).type === 'string') {
    handleHostMessage(data as HostMessage);
  }
});

// Restore after the webview is recreated (e.g. tab re-opened).
setConsoleHeight(uiState.height, false);
if (uiState.consoleOpen) {
  setConsoleOpen(true);
}
if (persisted.render?.type === 'render') {
  handleHostMessage(persisted.render);
}

vscode.postMessage({ type: 'ready' });
