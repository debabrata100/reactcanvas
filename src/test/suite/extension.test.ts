/**
 * Integration tests: run inside a real VS Code instance via
 * @vscode/test-electron (`npm run test:integration`).
 */
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'debabrata100.reactcanvas';

describe('ReactCanvas extension', function () {
  this.timeout(60000);

  it('is present in the host', () => {
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID), 'extension found');
  });

  it('activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  it('registers all commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('reactcanvas.openPreview'), 'openPreview registered');
    assert.ok(commands.includes('reactcanvas.selectReactVersion'), 'selectReactVersion registered');
    assert.ok(commands.includes('reactcanvas.newScratchFile'), 'newScratchFile registered');
  });

  it('opens the preview panel for an untitled JSX document without throwing', async () => {
    // Untitled documents have no file extension — this exercises the
    // languageId-based target detection used by scratch files.
    const doc = await vscode.workspace.openTextDocument({
      language: 'javascriptreact',
      content: 'export default function App() { return <h1>Hi</h1>; }\n',
    });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('reactcanvas.openPreview');
    // The command resolves synchronously after creating the panel; give the
    // webview a moment to initialize before the host shuts down.
    await new Promise((r) => setTimeout(r, 500));
  });

  it('opens the preview panel for an untitled TSX document without throwing', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescriptreact',
      content: 'export default function App(): JSX.Element { return <h1>Hi</h1>; }\n',
    });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('reactcanvas.openPreview');
    await new Promise((r) => setTimeout(r, 500));
  });

  it('previews a saved multi-file component (relative imports) without throwing', async () => {
    // examples/multi/App.jsx imports ./Card, ./data and ./app.css — this
    // exercises the bundling path end to end against real files on disk.
    const entry = path.resolve(__dirname, '../../../examples/multi/App.jsx');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(entry));
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('reactcanvas.openPreview');
    await new Promise((r) => setTimeout(r, 800));
  });
});
