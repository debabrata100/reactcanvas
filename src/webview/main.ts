/**
 * Webview script: the preview "chrome". Receives transpiled code from the
 * extension host and runs it inside a sandboxed srcdoc iframe. User code
 * NEVER executes in this document.
 */
import type { HostMessage, ReactVersion } from '../messages';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const appEl = document.getElementById('app') as HTMLElement;
const nonce = appEl.dataset.nonce ?? '';

/** Message posted by the loader script inside the iframe. */
interface IframeMessage {
  source: 'reactcanvas-iframe';
  type: 'rendered' | 'runtime-error' | 'no-component';
  message?: string;
  stack?: string;
  componentStack?: string;
  line?: number;
  column?: number;
  exports?: string[];
  component?: string;
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
`;
document.head.appendChild(style);

appEl.innerHTML = `
  <div class="rc-toolbar">
    <span class="rc-file"></span>
    <span class="rc-engine"></span>
    <span style="flex:1"></span>
    <span class="rc-version" title="Click to change React version"></span>
  </div>
  <div class="rc-stage">
    <div class="rc-empty">Waiting for a .jsx or .tsx file…</div>
    <div class="rc-overlay"><h2></h2><div class="rc-body"></div></div>
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

function importMap(version: ReactVersion): Record<string, string> {
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
  return map;
}

function buildSrcdoc(code: string, css: string, version: ReactVersion): string {
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

    (async () => {
      try {
        const url = URL.createObjectURL(new Blob([${embed(code)}], { type: 'text/javascript' }));
        const mod = await import(url);
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
  <script type="importmap" nonce="${nonce}">${JSON.stringify({ imports: importMap(version) })}</script>
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

function render(code: string, css: string, version: ReactVersion): void {
  emptyEl.style.display = 'none';
  iframe?.remove();
  iframe = document.createElement('iframe');
  // allow-scripts only: no same-origin, no forms, no popups, no top navigation.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.srcdoc = buildSrcdoc(code, css, version);
  stageEl.insertBefore(iframe, overlayEl);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleHostMessage(msg: HostMessage): void {
  switch (msg.type) {
    case 'render': {
      vscode.setState(msg);
      fileEl.textContent = msg.fileName;
      engineEl.textContent = `via ${msg.engine}`;
      versionEl.textContent = `React ${msg.reactVersion}`;
      render(msg.code, msg.css, msg.reactVersion);
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
      break;
    }
  }
}

function handleIframeMessage(msg: IframeMessage): void {
  switch (msg.type) {
    case 'rendered':
      hideOverlay();
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
const saved = vscode.getState() as Extract<HostMessage, { type: 'render' }> | undefined;
if (saved && saved.type === 'render') {
  handleHostMessage(saved);
}

vscode.postMessage({ type: 'ready' });
