/**
 * Integration tests: run inside a real VS Code instance via
 * @vscode/test-electron (`npm run test:integration`).
 */
import * as assert from 'assert';
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

  it('registers both commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('reactcanvas.openPreview'), 'openPreview registered');
    assert.ok(commands.includes('reactcanvas.selectReactVersion'), 'selectReactVersion registered');
  });

  it('opens the preview panel for a JSX document without throwing', async () => {
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
});
