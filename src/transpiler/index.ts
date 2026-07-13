/**
 * Transpile pipeline: JSX/TSX source -> browser-ready ES module.
 *
 * Primary engine: esbuild-wasm (browser build, initialized with a
 * pre-compiled WebAssembly.Module — no worker, no child process).
 * Fallback engine: @babel/standalone.
 *
 * This module intentionally has NO dependency on the 'vscode' API so the
 * pipeline can be unit-tested in plain Node.
 */

export interface TranspileErrorInfo {
  message: string;
  line?: number;
  column?: number;
}

export class TranspileError extends Error {
  constructor(
    message: string,
    public readonly errors: TranspileErrorInfo[]
  ) {
    super(message);
    this.name = 'TranspileError';
  }
}

export interface TranspileOptions {
  /** File name, used for loader detection and error messages. */
  filename: string;
  /**
   * Explicit loader override. Needed for untitled (never-saved) documents,
   * whose names ("Untitled-1") carry no extension to sniff.
   */
  loader?: 'jsx' | 'tsx';
}

export interface TranspileResult {
  /** Browser-ready ESM code (bare `react` imports left intact). */
  code: string;
  /** Which engine produced the output. */
  engine: 'esbuild' | 'babel';
}

export interface Transpiler {
  readonly name: 'esbuild' | 'babel';
  transpile(source: string, options: TranspileOptions): Promise<TranspileResult>;
}

function loaderFor(options: TranspileOptions): 'jsx' | 'tsx' {
  return options.loader ?? (/\.tsx$/i.test(options.filename) ? 'tsx' : 'jsx');
}

/**
 * Replace CSS imports (e.g. `import './App.css'`) with a no-op statement of
 * equal line count, so the browser doesn't try to resolve them and error
 * line numbers stay accurate. Sibling CSS is injected separately.
 */
export function stripCssImports(source: string): string {
  return source.replace(
    /^[ \t]*import\s+(?:[\w$]+\s+from\s+)?['"][^'"]+\.css['"];?[ \t]*$/gm,
    ';'
  );
}

/** Quick static check used to give a friendlier message before rendering. */
export function hasDefaultExport(source: string): boolean {
  return /(^|\s)export\s+default(\s|\{)/.test(source) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(source);
}

// ---------------------------------------------------------------------------
// esbuild-wasm engine
// ---------------------------------------------------------------------------

// The *browser* build of esbuild-wasm runs the wasm in-process when
// initialized with `worker: false` + a pre-compiled module. This works in
// Node >= 18 too (WebAssembly, TextEncoder, performance are all global),
// which is exactly what lets us avoid shelling out to a child process.
import * as esbuild from 'esbuild-wasm/lib/browser.js';

let esbuildInit: Promise<void> | undefined;

function initEsbuild(wasmModule: WebAssembly.Module): Promise<void> {
  if (!esbuildInit) {
    // The browser build's inline (worker: false) path bootstraps its fake
    // worker global by enumerating `self`, which exists in browsers but not
    // in Node / the VS Code extension host. Everything it actually needs
    // (crypto, performance, TextEncoder/Decoder) lives on globalThis in
    // Node >= 18, so aliasing is sufficient.
    const g = globalThis as Record<string, unknown>;
    if (typeof g.self === 'undefined') {
      g.self = globalThis;
    }
    esbuildInit = esbuild.initialize({ wasmModule, worker: false });
  }
  return esbuildInit;
}

export function createEsbuildTranspiler(wasmModule: WebAssembly.Module): Transpiler {
  return {
    name: 'esbuild',
    async transpile(source, options) {
      await initEsbuild(wasmModule);
      try {
        const result = await esbuild.transform(stripCssImports(source), {
          loader: loaderFor(options),
          format: 'esm',
          target: 'es2020',
          jsx: 'automatic',
          jsxImportSource: 'react',
          sourcefile: options.filename,
        });
        return { code: result.code, engine: 'esbuild' };
      } catch (err) {
        throw toTranspileError(err);
      }
    },
  };
}

function toTranspileError(err: unknown): TranspileError {
  const anyErr = err as {
    message?: string;
    errors?: Array<{ text: string; location?: { line: number; column: number } | null }>;
  };
  if (Array.isArray(anyErr?.errors) && anyErr.errors.length > 0) {
    const infos: TranspileErrorInfo[] = anyErr.errors.map((e) => ({
      message: e.text,
      line: e.location?.line,
      column: e.location != null ? e.location.column + 1 : undefined,
    }));
    return new TranspileError(infos[0].message, infos);
  }
  const message = anyErr?.message ?? String(err);
  return new TranspileError(message, [{ message }]);
}

// ---------------------------------------------------------------------------
// @babel/standalone fallback engine
// ---------------------------------------------------------------------------

export function createBabelTranspiler(): Transpiler {
  return {
    name: 'babel',
    async transpile(source, options) {
      // Lazy require keeps the (large) babel bundle out of the startup path.
      const babel: typeof import('@babel/standalone') = require('@babel/standalone');
      const presets: Array<[string, Record<string, unknown>]> = [['react', { runtime: 'automatic' }]];
      if (loaderFor(options) === 'tsx') {
        presets.push(['typescript', { isTSX: true, allExtensions: true }]);
      }
      try {
        const result = babel.transform(stripCssImports(source), {
          filename: options.filename,
          sourceType: 'module',
          presets,
        });
        if (result?.code == null) {
          throw new Error('Babel produced no output');
        }
        return { code: result.code, engine: 'babel' };
      } catch (err) {
        const anyErr = err as { message?: string; loc?: { line: number; column: number } };
        const message = (anyErr?.message ?? String(err)).replace(/^unknown file: /, '');
        throw new TranspileError(message, [
          {
            message,
            line: anyErr?.loc?.line,
            column: anyErr?.loc != null ? anyErr.loc.column + 1 : undefined,
          },
        ]);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Facade with fallback
// ---------------------------------------------------------------------------

export interface CreateTranspilerOptions {
  /** Raw contents of esbuild.wasm. If omitted or init fails, babel is used. */
  wasmBinary?: Uint8Array;
  /** Optional logger for reporting the fallback. */
  log?: (message: string) => void;
}

export async function createTranspiler(options: CreateTranspilerOptions = {}): Promise<Transpiler> {
  if (options.wasmBinary) {
    try {
      const wasmModule = await WebAssembly.compile(options.wasmBinary as BufferSource);
      const transpiler = createEsbuildTranspiler(wasmModule);
      // Smoke-test the engine once so a broken wasm falls back immediately.
      await transpiler.transpile('export default () => null;', { filename: 'probe.jsx' });
      return transpiler;
    } catch (err) {
      options.log?.(`esbuild-wasm init failed, falling back to @babel/standalone: ${String(err)}`);
    }
  }
  return createBabelTranspiler();
}
