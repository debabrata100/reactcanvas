import * as vscode from 'vscode';
import { Transpiler, TranspileError } from './transpiler';
import { extractSpecifiers } from './transpiler/moduleGraph';
import { isBareSpecifier, normalizeSlashes } from './transpiler/pathResolver';
import { collectPackages } from './transpiler/packages';
import { HostMessage, RenderModule, ReactVersion, WebviewMessage } from './messages';

const DEBOUNCE_MS = 300;

function isPreviewable(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
  if (!doc || doc.uri.scheme === 'git') {
    return false;
  }
  // languageId covers untitled (never-saved) documents, which have no file
  // extension, as well as files whose language was set manually.
  return (
    /\.(jsx|tsx)$/i.test(doc.fileName) ||
    doc.languageId === 'javascriptreact' ||
    doc.languageId === 'typescriptreact'
  );
}

function loaderOf(doc: vscode.TextDocument): 'jsx' | 'tsx' {
  return doc.languageId === 'typescriptreact' || /\.tsx$/i.test(doc.fileName) ? 'tsx' : 'jsx';
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export class PreviewPanel {
  public static current: PreviewPanel | undefined;

  public static createOrShow(
    context: vscode.ExtensionContext,
    getTranspiler: () => Promise<Transpiler>,
    getReactVersion: () => ReactVersion
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

    const panel = vscode.window.createWebviewPanel(
      'reactcanvas.preview',
      'ReactCanvas',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
        retainContextWhenHidden: true,
      }
    );
    PreviewPanel.current = new PreviewPanel(panel, context, getTranspiler, getReactVersion, target);
  }

  private readonly disposables: vscode.Disposable[] = [];
  private target: vscode.TextDocument | undefined;
  private cssWatcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private updateSeq = 0;
  /** Normalized paths of every file in the current import graph (reload set). */
  private graphFiles = new Set<string>();

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly getTranspiler: () => Promise<Transpiler>,
    private readonly getReactVersion: () => ReactVersion,
    target: vscode.TextDocument | undefined
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        switch (message.type) {
          case 'ready':
            void this.update();
            break;
          case 'select-version':
            void vscode.commands.executeCommand('reactcanvas.selectReactVersion');
            break;
        }
      },
      null,
      this.disposables
    );

    // Follow the active editor to other .jsx/.tsx files.
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        const doc = editor?.document;
        if (isPreviewable(doc) && doc !== this.target) {
          this.setTarget(doc);
        }
      },
      null,
      this.disposables
    );

    // Live reload, debounced. Re-render when the entry, its sibling CSS, or
    // any file in the resolved import graph changes.
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        const changed = normalizeSlashes(event.document.uri.fsPath);
        if (
          event.document === this.target ||
          (this.target && event.document.uri.toString() === this.cssUri()?.toString()) ||
          this.graphFiles.has(changed)
        ) {
          this.scheduleUpdate();
        }
      },
      null,
      this.disposables
    );

    this.setTarget(target);
  }

  public setTarget(target: vscode.TextDocument | undefined): void {
    this.target = target;
    this.panel.title = target ? `ReactCanvas — ${target.fileName.split(/[\\/]/).pop()}` : 'ReactCanvas';
    this.watchCss();
    this.scheduleUpdate(0);
  }

  /** Re-render with current settings (e.g. after a React version change). */
  public refresh(): void {
    this.scheduleUpdate(0);
  }

  private scheduleUpdate(delay: number = DEBOUNCE_MS): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => void this.update(), delay);
  }

  private cssUri(): vscode.Uri | undefined {
    if (!this.target || this.target.isUntitled) {
      return undefined;
    }
    return this.target.uri.with({ path: this.target.uri.path.replace(/\.(jsx|tsx)$/i, '.css') });
  }

  private watchCss(): void {
    this.cssWatcher?.dispose();
    this.cssWatcher = undefined;
    const cssUri = this.cssUri();
    if (cssUri && cssUri.scheme === 'file') {
      this.cssWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.joinPath(cssUri, '..'), cssUri.path.split('/').pop() ?? '*.css')
      );
      const onCss = () => this.scheduleUpdate();
      this.cssWatcher.onDidChange(onCss);
      this.cssWatcher.onDidCreate(onCss);
      this.cssWatcher.onDidDelete(onCss);
    }
  }

  /** Reads a graph file by normalized path: dirty buffer first, then disk. */
  private async readWorkspaceFile(path: string): Promise<string | undefined> {
    const open = vscode.workspace.textDocuments.find((d) => normalizeSlashes(d.uri.fsPath) === path);
    if (open) {
      return open.getText();
    }
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(path)));
    } catch {
      return undefined;
    }
  }

  private async readCss(): Promise<string> {
    const cssUri = this.cssUri();
    if (!cssUri) {
      return '';
    }
    // Prefer the open (possibly dirty) document over what's on disk.
    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === cssUri.toString());
    if (openDoc) {
      return openDoc.getText();
    }
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(cssUri));
    } catch {
      return '';
    }
  }

  private async update(): Promise<void> {
    const seq = ++this.updateSeq;
    if (!this.target) {
      this.post({
        type: 'no-target',
        reason:
          'Open a .jsx or .tsx file, then run "ReactCanvas: Open Preview" — or start from scratch with "ReactCanvas: New React Scratch File".',
      });
      return;
    }

    const target = this.target;
    const fileName = target.fileName.split(/[\\/]/).pop() ?? target.fileName;
    const text = target.getText();
    const loader = loaderOf(target);
    try {
      const transpiler = await this.getTranspiler();

      // Bundle when the file has any relative import; otherwise take the fast
      // single-file path. Untitled files can't resolve relative paths.
      const hasRelativeImports =
        !target.isUntitled && extractSpecifiers(text).some((s) => !isBareSpecifier(s));

      let payload: {
        modules: RenderModule[];
        entryPath: string;
        css: string;
        packages: string[];
        engine: 'esbuild' | 'babel';
        fileCount: number;
      };

      if (hasRelativeImports && transpiler.bundle) {
        const entryPath = normalizeSlashes(target.uri.fsPath);
        const result = await transpiler.bundle({
          entryPath,
          entrySource: text,
          loader,
          readFile: (p) => this.readWorkspaceFile(p),
        });
        this.graphFiles = new Set(result.files.map(normalizeSlashes));

        // Preserve same-name sibling CSS auto-injection (no import needed),
        // unless that file was already pulled in via an explicit import.
        let css = result.css;
        const siblingPath = this.cssUri() ? normalizeSlashes(this.cssUri()!.fsPath) : undefined;
        if (!siblingPath || !this.graphFiles.has(siblingPath)) {
          const sibling = await this.readCss();
          if (sibling) {
            css = css ? `${css}\n${sibling}` : sibling;
          }
        }
        payload = {
          modules: result.modules,
          entryPath: result.entryPath,
          css,
          packages: result.packages,
          engine: result.engine,
          fileCount: result.files.length,
        };
      } else {
        const [result, css] = await Promise.all([
          transpiler.transpile(text, { filename: fileName, loader }),
          this.readCss(),
        ]);
        this.graphFiles = new Set([normalizeSlashes(target.uri.fsPath)]);
        payload = {
          modules: [{ path: 'entry', code: result.code, imports: {} }],
          entryPath: 'entry',
          css,
          packages: collectPackages(extractSpecifiers(text)),
          engine: result.engine,
          fileCount: 1,
        };
      }

      if (seq !== this.updateSeq) {
        return; // A newer update superseded this one.
      }
      this.post({
        type: 'render',
        fileName,
        modules: payload.modules,
        entryPath: payload.entryPath,
        css: payload.css,
        packages: payload.packages,
        reactVersion: this.getReactVersion(),
        engine: payload.engine,
        fileCount: payload.fileCount,
      });
    } catch (err) {
      if (seq !== this.updateSeq) {
        return;
      }
      const errors =
        err instanceof TranspileError ? err.errors : [{ message: err instanceof Error ? err.message : String(err) }];
      this.post({ type: 'transpile-error', fileName, errors });
    }
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));

    // CSP notes:
    // - User code never runs in this document; it runs inside a sandboxed
    //   srcdoc iframe (sandbox="allow-scripts", no allow-same-origin).
    // - srcdoc iframes inherit this CSP, so it must admit what the iframe
    //   needs: nonce'd inline scripts, esm.sh (React and npm packages), and
    //   blob: (each user module is imported from a Blob URL).
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} https://esm.sh 'unsafe-inline'`,
      `font-src ${webview.cspSource} https://esm.sh data:`,
      `script-src 'nonce-${nonce}' https://esm.sh blob:`,
      `connect-src https://esm.sh`,
      `frame-src blob: data:`,
      `child-src blob: data:`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReactCanvas</title>
</head>
<body>
  <div id="app" data-nonce="${nonce}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    PreviewPanel.current = undefined;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.cssWatcher?.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}
