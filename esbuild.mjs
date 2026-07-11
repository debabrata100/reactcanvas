import { copyFile, mkdir } from 'node:fs/promises';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Prefer native esbuild (fast); fall back to esbuild-wasm (already a
 * dependency of this project) when the installed native binary doesn't
 * match the current platform. Both expose the same build API.
 */
async function loadEsbuild() {
  try {
    const esbuild = await import('esbuild');
    await esbuild.formatMessages([], { kind: 'error' }); // probes the binary
    return esbuild;
  } catch {
    console.warn('[build] native esbuild unavailable on this platform, using esbuild-wasm');
    return import('esbuild-wasm');
  }
}

const esbuild = await loadEsbuild();

/** Extension host bundle (Node/CJS). 'vscode' is provided by the host. */
const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

/** Webview script (browser/IIFE) — the preview chrome, not user code. */
const webviewCtx = await esbuild.context({
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

await mkdir('dist', { recursive: true });
// The esbuild-wasm binary is loaded at runtime by the transpiler.
await copyFile('node_modules/esbuild-wasm/esbuild.wasm', 'dist/esbuild.wasm');

if (watch) {
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
} else {
  await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
}
