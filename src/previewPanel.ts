import * as vscode from 'vscode';
import { Transpiler, TranspileError } from './transpiler';
import { HostMessage, ReactVersion, WebviewMessage } from './messages';

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

    // Live reload, debounced.
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (
          event.document === this.target ||
          (this.target && event.document.uri.toString() === this.cssUri()?.toString())
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

    const fileName = this.target.fileName.split(/[\\/]/).pop() ?? this.target.fileName;
    try {
      const transpiler = await this.getTranspiler();
      const [result, css] = await Promise.all([
        transpiler.transpile(this.target.getText(), { filename: fileName, loader: loaderOf(this.target) }),
        this.readCss(),
      ]);
      if (seq !== this.updateSeq) {
        return; // A newer update superseded this one.
      }
      this.post({
        type: 'render',
        fileName,
        code: result.code,
        css,
        reactVersion: this.getReactVersion(),
        engine: result.engine,
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
    //   needs: nonce'd inline scripts, esm.sh (React), and blob: (the user
    //   module is imported from a Blob URL).
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
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
