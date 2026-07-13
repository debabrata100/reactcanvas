import * as vscode from 'vscode';
import { createTranspiler, Transpiler } from './transpiler';
import { PreviewPanel } from './previewPanel';
import { DEFAULT_REACT_VERSION, REACT_VERSIONS, ReactVersion } from './messages';

const VERSION_STATE_KEY = 'reactcanvas.reactVersion';

let transpilerPromise: Promise<Transpiler> | undefined;

/** Lazily create the transpiler — the wasm compile only happens on first preview. */
function getTranspiler(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<Transpiler> {
  if (!transpilerPromise) {
    transpilerPromise = (async () => {
      let wasmBinary: Uint8Array | undefined;
      try {
        wasmBinary = await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'esbuild.wasm')
        );
      } catch {
        output.appendLine('dist/esbuild.wasm not found; using @babel/standalone.');
      }
      const transpiler = await createTranspiler({
        wasmBinary,
        log: (m) => output.appendLine(m),
      });
      output.appendLine(`Transpile engine: ${transpiler.name}`);
      return transpiler;
    })();
  }
  return transpilerPromise;
}

export function getReactVersion(context: vscode.ExtensionContext): ReactVersion {
  return context.workspaceState.get<ReactVersion>(VERSION_STATE_KEY, DEFAULT_REACT_VERSION);
}

const JSX_TEMPLATE = `import { useState } from 'react';

export default function Scratch() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ fontFamily: 'system-ui', textAlign: 'center', marginTop: '3rem' }}>
      <h1>Scratch pad</h1>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
      <p>Edit this file — the preview updates as you type. No need to save.</p>
    </div>
  );
}
`;

const TSX_TEMPLATE = `import { useState } from 'react';

interface GreetingProps {
  name: string;
}

function Greeting({ name }: GreetingProps) {
  return <h1>Hello, {name}!</h1>;
}

export default function Scratch() {
  const [count, setCount] = useState<number>(0);

  return (
    <div style={{ fontFamily: 'system-ui', textAlign: 'center', marginTop: '3rem' }}>
      <Greeting name="ReactCanvas" />
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
      <p>Edit this file — the preview updates as you type. No need to save.</p>
    </div>
  );
}
`;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ReactCanvas');
  context.subscriptions.push(output);

  // Status bar: shows the active React version, click to change it.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'reactcanvas.selectReactVersion';
  statusBar.tooltip = 'ReactCanvas: select the React version used by the preview';
  const refreshStatusBar = () => {
    statusBar.text = `$(preview) React ${getReactVersion(context)}`;
  };
  refreshStatusBar();
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('reactcanvas.openPreview', async () => {
      PreviewPanel.createOrShow(context, () => getTranspiler(context, output), () => getReactVersion(context));
    }),

    vscode.commands.registerCommand('reactcanvas.newScratchFile', async () => {
      const picked = await vscode.window.showQuickPick(
        [
          { label: 'JSX', description: 'JavaScript React scratch file', language: 'javascriptreact', content: JSX_TEMPLATE },
          { label: 'TSX', description: 'TypeScript React scratch file', language: 'typescriptreact', content: TSX_TEMPLATE },
        ],
        { placeHolder: 'Language for the scratch file' }
      );
      if (!picked) {
        return;
      }
      const doc = await vscode.workspace.openTextDocument({ language: picked.language, content: picked.content });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      await vscode.commands.executeCommand('reactcanvas.openPreview');
    }),

    vscode.commands.registerCommand('reactcanvas.selectReactVersion', async () => {
      const current = getReactVersion(context);
      const picked = await vscode.window.showQuickPick(
        REACT_VERSIONS.map((v) => ({
          label: `React ${v}`,
          description: v === current ? 'current' : undefined,
          version: v,
        })),
        { placeHolder: 'Select the React version for the ReactCanvas preview' }
      );
      if (picked) {
        await context.workspaceState.update(VERSION_STATE_KEY, picked.version);
        refreshStatusBar();
        PreviewPanel.current?.refresh();
      }
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up: disposables are handled via context.subscriptions.
}
