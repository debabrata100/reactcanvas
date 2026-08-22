# Code Walkthrough: What happens when you click "Open Preview"

This document follows a single action — you click **ReactCanvas: Open Preview**
on a `.jsx` file — and traces **every piece of code that runs**, in order, until
the component appears in the panel. Each step shows the real code, explains what
it does, and says *why* it exists.

Read it with the files open beside you. The journey crosses the three worlds
from the architecture doc — **extension host → webview → iframe** — and each
"world change" is called out so you always know where the code is running.

> Convention used below: **[HOST]**, **[WEBVIEW]**, **[IFRAME]** tags mark which
> of the three JavaScript environments the code runs in.

---

## The journey at a glance

```
You click "Open Preview"
      │
 [HOST]  1. command handler fires            extension.ts
 [HOST]  2. PreviewPanel.createOrShow()      previewPanel.ts
 [HOST]  3. createWebviewPanel()             (VS Code creates the panel)
 [HOST]  4. new PreviewPanel() constructor   previewPanel.ts
 [HOST]  5. getHtml() → HTML shell + CSP      previewPanel.ts, csp.ts
      │        … VS Code loads that HTML into the panel …
 [WEBVIEW] 6. main.ts boots, posts "ready"    webview/main.ts
 [HOST]  7. "ready" received → update()       previewPanel.ts
 [HOST]  8. transpile / bundle the file       transpiler/**
 [HOST]  9. post a "render" message           previewPanel.ts
 [WEBVIEW] 10. receive render → build iframe   webview/main.ts
 [IFRAME] 11. component runs and mounts        (inside the sandbox)
 [IFRAME→WEBVIEW] 12. "rendered" reported back  webview/main.ts
      │
   You see the component.
```

Now the same journey, slowly.

---

## Step 0 — The click

The button in the editor title bar (or the Command Palette entry) is bound to
the command id `reactcanvas.openPreview`. When you click it, VS Code looks up
whatever function was registered under that id and calls it. (This is the
"two halves" idea: the manifest declares the id, the code registers the
behavior.)

---

## Step 1 — The command handler **[HOST]**

**File:** `src/extension.ts`

```ts
vscode.commands.registerCommand("reactcanvas.openPreview", async () => {
  PreviewPanel.createOrShow(
    context,
    () => getTranspiler(context, output),
    () => getReactVersion(context),
  );
});
```

**What runs:** just one call — `PreviewPanel.createOrShow(...)`.

**Why it's shaped this way:** the handler does almost nothing itself. It hands
`PreviewPanel` three things it will need later:

- `context` — the extension context (used for file paths and persisted state).
- `() => getTranspiler(...)` — a **function** that, when called, returns the
  transpiler. It's passed as a function, not a value, so the (expensive) wasm
  transpiler is only built the first time it's actually needed, not on every
  click. This is *lazy initialization*.
- `() => getReactVersion(...)` — a function returning the currently selected
  React version, read fresh each time (so it always reflects the latest choice).

The lesson: command handlers stay thin; the real work lives in a dedicated
class. Here, that class is `PreviewPanel`.

---

## Step 2 — `createOrShow` decides: reuse or create? **[HOST]**

**File:** `src/previewPanel.ts`

```ts
public static createOrShow(
  context: vscode.ExtensionContext,
  getTranspiler: () => Promise<Transpiler>,
  getReactVersion: () => ReactVersion,
): void {
  const target = isPreviewable(vscode.window.activeTextEditor?.document)
    ? vscode.window.activeTextEditor?.document
    : undefined;

  if (PreviewPanel.current) {
    PreviewPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
    if (target) {
      PreviewPanel.current.setTarget(target);
    }
    return;
  }

  const panel = vscode.window.createWebviewPanel(/* … */);
  PreviewPanel.current = new PreviewPanel(panel, context, getTranspiler, getReactVersion, target);
}
```

Three things happen here:

**a) Find the target document.**
`vscode.window.activeTextEditor?.document` is the file you're currently editing.
`isPreviewable(...)` checks whether it's a `.jsx`/`.tsx` file (by extension or
language id). If yes, that document becomes the `target` — the thing we'll
render. If not, `target` is `undefined` (the preview will show a "open a jsx
file" message).

**b) Reuse if a panel already exists.**
`PreviewPanel.current` is a **static** field — meaning it belongs to the class,
not to any one instance, so there is only ever *one* value of it across the whole
extension. If it's already set, a preview panel is open, so we just
`reveal()` it (bring it to front) and point it at the new target with
`setTarget`, then `return`. This is the **single-instance rule**: clicking Open
Preview twice never makes two panels.

**c) Otherwise, create one.**
`createWebviewPanel(...)` (next step) makes the panel, and
`new PreviewPanel(...)` wraps it. The result is stored in
`PreviewPanel.current` so the reuse-check above will find it next time.

**Why a static `current`:** it's the simplest way to enforce "at most one
preview" without a global variable — the class owns its own singleton.

---

## Step 3 — VS Code creates the webview panel **[HOST]**

**File:** `src/previewPanel.ts`

```ts
const panel = vscode.window.createWebviewPanel(
  "reactcanvas.preview",              // internal view type id
  "ReactCanvas",                      // tab title
  { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
  {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    retainContextWhenHidden: true,
  },
);
```

This asks VS Code to create the empty panel that will host our UI. The
arguments, and why each matters:

- `"reactcanvas.preview"` — an internal id for this *kind* of webview.
- `"ReactCanvas"` — the label shown on the panel's tab.
- `{ viewColumn: ViewColumn.Beside, preserveFocus: true }` — open it **beside**
  the current editor (so code stays left, preview right), and **don't steal
  focus** from your code (`preserveFocus`), so you can keep typing.
- The options object is the important one for capability and security:
  - `enableScripts: true` — allow JavaScript to run in the webview. Without
    this the webview is static HTML; our whole UI needs scripts.
  - `localResourceRoots: [ …/dist ]` — the webview may only load local files
    from the `dist/` folder. This is a security boundary: it can't read
    arbitrary files off your disk, only our bundled assets.
  - `retainContextWhenHidden: true` — keep the webview alive (don't tear down
    its DOM/state) when you switch to another tab. Costs a little memory, but
    means the preview doesn't reset every time it's hidden.

At this point the panel exists but is **empty** — no HTML yet.

---

## Step 4 — The `PreviewPanel` constructor wires up listeners **[HOST]**

**File:** `src/previewPanel.ts`

```ts
private constructor(
  private readonly panel: vscode.WebviewPanel,
  private readonly context: vscode.ExtensionContext,
  private readonly getTranspiler: () => Promise<Transpiler>,
  private readonly getReactVersion: () => ReactVersion,
  target: vscode.TextDocument | undefined,
) {
  this.panel.webview.html = this.getHtml();
  this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

  this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
    switch (message.type) {
      case "ready":
        void this.update();
        break;
      case "select-version":
        void vscode.commands.executeCommand("reactcanvas.selectReactVersion");
        break;
    }
  }, null, this.disposables);

  vscode.window.onDidChangeActiveTextEditor(/* follow active editor */);
  vscode.workspace.onDidChangeTextDocument(/* live reload, debounced */);

  this.setTarget(target);
}
```

The constructor is where the panel comes alive. In order:

**a) `this.panel.webview.html = this.getHtml();`** — set the panel's HTML
content (Step 5 details what that HTML is). Assigning `.html` is what makes VS
Code actually load and render the page. **This is the moment the webview world
starts booting.**

**b) `onDidDispose(… this.dispose …)`** — register cleanup for when the user
closes the panel. `this.dispose()` clears timers, disposes listeners, and — key —
resets `PreviewPanel.current` back to `undefined` so a future click creates a
fresh panel.

**c) `onDidReceiveMessage(...)`** — **this is the host's inbox** for messages
coming *up* from the webview. Two message types:
- `"ready"` → the webview has finished booting and is asking for content, so we
  call `this.update()` (Steps 7–9). This is the crucial handshake — we don't
  send content until the webview says it's listening.
- `"select-version"` → the user clicked the version badge in the preview; we run
  the version-select command.

**d) `onDidChangeActiveTextEditor(...)`** — when you click into a different
`.jsx`/`.tsx` file, follow it (re-target the preview to the new file).

**e) `onDidChangeTextDocument(...)`** — when you *edit* the target file (or any
file in its import graph, or its CSS), schedule a debounced re-render. This is
what makes the preview "live."

**f) `this.setTarget(target)`** — record the initial target and schedule the
first update. (When the webview posts `"ready"` a moment later, `update()` runs
and actually renders.)

Notice the pattern: every listener's disposable is pushed into
`this.disposables`, so `dispose()` can unsubscribe them all at once. Registering
a listener means committing to cleaning it up.

---

## Step 5 — `getHtml()` builds the shell and its security policy **[HOST]**

**File:** `src/previewPanel.ts` (and `src/csp.ts`)

```ts
private getHtml(): string {
  const webview = this.panel.webview;
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
  );
  const csp = buildContentSecurityPolicy(webview.cspSource, nonce);

  return `<!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
    </head>
    <body>
      <div id="app" data-nonce="${nonce}"></div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}
```

This produces the **minimal HTML shell** for the panel — importantly, it
contains almost no UI. It just loads our compiled webview script, which builds
the real UI once it runs. Three details matter:

- **`nonce`** — a random one-time token (`getNonce()`). The Content-Security-
  Policy will only allow `<script>` tags carrying this exact nonce to run. This
  blocks any injected script that doesn't have the token — a standard defense.
- **`scriptUri = webview.asWebviewUri(…dist/webview.js)`** — you can't reference
  local files by normal path inside a webview; they must be converted to a
  special `vscode-webview://` URI. `asWebviewUri` does that conversion. This is
  the compiled `webview/main.ts` bundle.
- **`csp = buildContentSecurityPolicy(...)`** — the security policy string
  (from `csp.ts`) that governs what the page and its nested iframe may load and
  connect to (esm.sh for packages, blob: for modules, https: for fetch, etc.).

The `<div id="app" data-nonce="…">` is the mount point the webview script fills
in, and it passes the nonce down via a data attribute so the script can reuse it
when it builds the inner iframe.

**End of the host's opening act.** Assigning this HTML (back in Step 4a) hands
control to VS Code, which loads the page — and now the **webview world** starts.

---

## Step 6 — The webview boots and says "ready" **[WEBVIEW]**

**File:** `src/webview/main.ts` (bottom of the file)

```ts
vscode.postMessage({ type: "ready" });
```

When VS Code loads the shell HTML, it runs `dist/webview.js` — the compiled
`main.ts`. That script builds the toolbar and console panel, sets up its message
listeners, and then, as its **last** line, posts a `ready` message up to the
host.

**Why announce "ready" instead of just rendering?** Because the host can't send
content until the webview is listening — messages sent before the page's
listener exists are lost. So the webview tells the host "I'm up, send me
something." This is a **handshake**, and it's why the host waited (Step 4c) for
`ready` before calling `update()`.

This message travels **webview → host**, landing in the `onDidReceiveMessage`
inbox from Step 4c.

---

## Step 7 — Back in the host: `update()` runs **[HOST]**

**File:** `src/previewPanel.ts`

`update()` is the method that actually produces a render. Its opening:

```ts
private async update(): Promise<void> {
  const seq = ++this.updateSeq;
  if (!this.target) {
    this.post({ type: "no-target", reason: "Open a .jsx or .tsx file, …" });
    return;
  }

  const target = this.target;
  const text = target.getText();
  const loader = loaderOf(target);
  // …
}
```

- **`const seq = ++this.updateSeq;`** — bump a counter and remember this run's
  number. Because transpiling is async and you might type again mid-flight, this
  lets a later step check "am I still the newest update?" and bail if a newer one
  started. It prevents an old, slow render from overwriting a fresh one.
- **`if (!this.target)`** — nothing previewable is active, so post a friendly
  `no-target` message and stop.
- **`target.getText()`** — read the file's *current editor text* (not the saved
  file on disk). This is why unsaved edits preview live.
- **`loaderOf(target)`** — decide whether to treat it as JSX or TSX.

---

## Step 8 — Transpile (or bundle) the code **[HOST]**

**File:** `src/previewPanel.ts` → `src/transpiler/**`

```ts
const hasRelativeImports =
  !target.isUntitled &&
  extractSpecifiers(text).some((s) => !isBareSpecifier(s));

if (hasRelativeImports && transpiler.bundle) {
  const result = await transpiler.bundle({ entryPath, entrySource: text, loader, readFile });
  // → modules, css, packages, files
} else {
  const [result, css] = await Promise.all([
    transpiler.transpile(text, { filename: fileName, loader }),
    this.readCss(),
  ]);
  // → one module
}
```

The host decides **how much to compile**:

- **No relative imports** → the fast single-file path:
  `transpiler.transpile(...)` runs one esbuild pass, turning JSX into browser
  JavaScript. Result: one module. (For our counter, this is the path taken.)
- **Has relative imports** → `transpiler.bundle(...)` walks the whole import
  graph, transpiling each file with Babel, collecting CSS and npm package names
  along the way. Result: many modules.

Either way, the output is *plain data*: a list of modules (each a
`{ path, code, imports }`), plus css and package lists. Nothing has been
rendered yet — the host has only prepared **what** to render.

---

## Step 9 — Post the `render` message **[HOST → WEBVIEW]**

**File:** `src/previewPanel.ts`

```ts
if (seq !== this.updateSeq) {
  return; // a newer edit already started; drop this stale result
}
this.post({
  type: "render",
  fileName,
  modules: payload.modules,
  entryPath: payload.entryPath,
  css: payload.css,
  packages: payload.packages,
  reactVersion: this.getReactVersion(),
  engine: payload.engine,
  fileCount: payload.fileCount,
});
```

- The `seq` check cashes in the counter from Step 7: if a newer update started
  while we were transpiling, this result is stale, so we throw it away.
- `this.post(...)` sends the render payload **down to the webview** via
  `postMessage`. Only JSON-serializable data crosses this boundary — you can't
  pass functions or live objects between the two worlds, only plain data. This
  is the contract defined in `messages.ts`.

The host's job is now done for this render. Control moves to the webview.

---

## Step 10 — The webview receives `render` and builds the iframe **[WEBVIEW]**

**File:** `src/webview/main.ts`

```ts
function handleHostMessage(msg: HostMessage): void {
  switch (msg.type) {
    case "render": {
      fileEl.textContent = msg.fileName;                  // update toolbar
      engineEl.textContent = `via ${msg.engine}…`;
      versionEl.textContent = `React ${msg.reactVersion}`;
      render(msg.modules, msg.entryPath, msg.css, msg.reactVersion, msg.packages);
      break;
    }
    // …
  }
}
```

The webview updates its toolbar text, then calls `render(...)`, which builds a
**fresh sandboxed iframe**:

```ts
function render(modules, entryPath, css, version, packages) {
  iframe?.remove();                          // throw away the previous frame
  iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");   // no same-origin!
  iframe.srcdoc = buildSrcdoc(modules, entryPath, css, version, packages);
  stageEl.insertBefore(iframe, overlayEl);
}
```

- The old iframe is removed and a new one created every render — a clean slate,
  like a devtools reload.
- `sandbox="allow-scripts"` (and *no* `allow-same-origin`) is the security
  boundary: user code can run, but can't reach the webview or extension host.
- `buildSrcdoc(...)` generates the complete little HTML document that goes inside
  the iframe: an **import map** (react + npm → esm.sh), the user's **modules as
  blob URLs**, and a **bootstrap script** that patches `console`, sets up an
  error boundary, imports the entry module, finds its default export, and
  renders it with React.

Assigning `iframe.srcdoc` starts the **third world** — the iframe.

---

## Step 11 — The component runs **[IFRAME]**

**Inside the generated iframe HTML** (built by `buildSrcdoc`)

The bootstrap script does, in order:

1. Patch `console.log/warn/error/…` to forward messages up to the webview.
2. Install error handlers and a React error boundary.
3. Inject the collected CSS.
4. Turn each module into a **blob URL**, rewrite relative imports to point at
   those URLs (in dependency order), then `import()` the entry module.
5. Read the entry's **default export** (our `Counter`), and render it:
   `createRoot(rootEl).render(<Counter/>)`.

Bare imports like `react` resolve through the **import map** to esm.sh. This is
the moment your component actually executes and paints — the counter with its
`useState` and buttons appears.

---

## Step 12 — The iframe reports back **[IFRAME → WEBVIEW]**

**Inside the iframe**, after a successful render:

```js
post({ type: "rendered", component: picked });
```

This travels **iframe → webview**. The webview handles it:

```ts
function handleIframeMessage(msg) {
  switch (msg.type) {
    case "rendered":
      hideOverlay();       // clear any "loading"/error overlay
      break;
    case "runtime-error":  /* show error overlay */
    case "console":        /* append to the console panel */
    // …
  }
}
```

On `rendered`, the webview hides any overlay — the preview is now showing your
live component. If the component had thrown, you'd get `runtime-error` here
instead, and the overlay would show the message. Any `console.log` the component
runs arrives as a `console` message and lands in the console panel.

---

## The whole trip, in one breath

1. **[HOST]** Click → command handler → `createOrShow` → (reuse or) create the
   panel → constructor wires listeners → `getHtml` sets a minimal, CSP-locked
   shell that loads `webview.js`.
2. **[WEBVIEW]** The script boots and posts **`ready`**.
3. **[HOST]** `ready` triggers `update()` → read the file text → transpile or
   bundle into plain data → post a **`render`** message.
4. **[WEBVIEW]** Receive `render` → update the toolbar → build a fresh sandboxed
   iframe whose `srcdoc` contains an import map, the modules as blob URLs, and a
   bootstrap script.
5. **[IFRAME]** The bootstrap links the modules, imports the entry, and renders
   the default export with React — the component appears.
6. **[IFRAME → WEBVIEW]** It posts **`rendered`**; the webview clears the overlay.

Every arrow is either a function call (within one world) or a `postMessage`
(between worlds). Two boundary crossings each way, three environments, and a
component on screen. Once you can narrate this trip from memory, the rest of the
codebase is just variations on it — the version selector changes what Step 11's
import map points at; live reload re-runs Steps 7–12 on every keystroke; the
console panel is fed by the `console` messages from Step 12.
