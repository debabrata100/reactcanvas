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

/** Reads a workspace file by absolute path; resolves to undefined if absent. */
export type FileReader = (absolutePath: string) => Promise<string | undefined>;

export interface BundleOptions {
  /** Absolute path of the entry file (any slash style). */
  entryPath: string;
  /** Current text of the entry (may differ from disk if the buffer is dirty). */
  entrySource: string;
  /** Loader for the entry when its name carries no extension (untitled). */
  loader: 'jsx' | 'tsx';
  /** Reads *other* files in the graph. The entry is supplied via entrySource. */
  readFile: FileReader;
}

export interface BundleResult {
  /** Transpiled modules in the graph; the browser links them via blob URLs. */
  modules: GraphModule[];
  /** Canonical path of the entry module (its key in `modules`). */
  entryPath: string;
  /** Concatenated CSS from every `.css` file imported anywhere in the graph. */
  css: string;
  /** Third-party bare specifiers imported anywhere in the graph (for esm.sh). */
  packages: string[];
  /** Multi-file bundling uses @babel/standalone for reliable per-file transpile. */
  engine: 'babel';
  /** Every module file that was read, for live-reload watching. */
  files: string[];
}

export interface Transpiler {
  readonly name: 'esbuild' | 'babel';
  transpile(source: string, options: TranspileOptions): Promise<TranspileResult>;
  /**
   * Bundle an entry and its relative imports into one module. Present only on
   * the esbuild engine — @babel/standalone cannot follow imports, so callers
   * fall back to single-file `transpile` when this is undefined.
   */
  bundle?(options: BundleOptions): Promise<BundleResult>;
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
import { candidatePaths, dirOf, isBareSpecifier, loaderForPath, normalizeSlashes, resolveFrom } from './pathResolver';
import { extractSpecifiers, GraphModule, removeImport } from './moduleGraph';
import { collectPackages } from './packages';

export type { GraphModule } from './moduleGraph';

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

    bundle: bundleWithBabel,
  };
}

// ---------------------------------------------------------------------------
// Multi-file bundling (graph walk)
// ---------------------------------------------------------------------------
//
// Per-file transpilation uses @babel/standalone rather than esbuild-wasm.
// esbuild-wasm's `worker: false` build (the only mode available in the
// extension host) reliably serves a *single* transform, but repeated
// transforms in one continuation can deadlock — its Go scheduler starves
// without the macrotask boundaries a test runner happens to provide. Babel's
// transform is synchronous pure JS, so walking a graph of N files is safe.

type GraphLoader = 'jsx' | 'tsx' | 'ts' | 'js';

function babelTransformFile(path: string, source: string, loader: GraphLoader): string {
  const babel: typeof import('@babel/standalone') = require('@babel/standalone');
  const isTs = loader === 'ts' || loader === 'tsx' || /\.tsx?$/i.test(path);
  const isTsx = loader === 'tsx' || /\.tsx$/i.test(path) || (loader === 'jsx' && isTs);
  const presets: Array<[string, Record<string, unknown>]> = [['react', { runtime: 'automatic' }]];
  if (isTs) {
    // onlyRemoveTypeImports keeps value imports that Babel might otherwise
    // treat as unused, so the graph walk still sees every real dependency.
    presets.push(['typescript', { isTSX: isTsx, allExtensions: true, onlyRemoveTypeImports: true }]);
  }
  const result = babel.transform(source, {
    filename: path.split('/').pop() || path,
    sourceType: 'module',
    presets,
  });
  if (result?.code == null) {
    throw new TranspileError('Babel produced no output', [{ message: `${path}: no output` }]);
  }
  return result.code;
}

async function bundleWithBabel(options: BundleOptions): Promise<BundleResult> {
  const entryPath = normalizeSlashes(options.entryPath);
  const cssChunks: string[] = [];
  const modules = new Map<string, GraphModule>();
  const readFiles = new Set<string>([entryPath]);
  const packageSpecifiers = new Set<string>();
  const readCache = new Map<string, string | undefined>();

  const read = async (path: string): Promise<string | undefined> => {
    if (path === entryPath) {
      return options.entrySource;
    }
    if (readCache.has(path)) {
      return readCache.get(path);
    }
    const contents = await options.readFile(path);
    readCache.set(path, contents);
    return contents;
  };

  const resolveExisting = async (base: string): Promise<{ path: string; contents: string } | undefined> => {
    for (const candidate of candidatePaths(base)) {
      const contents = await read(candidate);
      if (contents !== undefined) {
        return { path: candidate, contents };
      }
    }
    return undefined;
  };

  const queue: Array<{ path: string; source: string; loader: GraphLoader }> = [
    { path: entryPath, source: options.entrySource, loader: options.loader },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (modules.has(current.path)) {
      continue;
    }
    let code: string;
    try {
      code = babelTransformFile(current.path, current.source, current.loader);
    } catch (err) {
      if (err instanceof TranspileError) {
        throw err;
      }
      const anyErr = err as { message?: string; loc?: { line: number; column: number } };
      const base = current.path.split('/').pop();
      const message = `${base}: ${(anyErr?.message ?? String(err)).replace(/^unknown file: /, '')}`;
      throw new TranspileError(message, [
        { message, line: anyErr?.loc?.line, column: anyErr?.loc != null ? anyErr.loc.column + 1 : undefined },
      ]);
    }

    const imports: Record<string, string> = {};
    for (const specifier of extractSpecifiers(current.source)) {
      if (isBareSpecifier(specifier)) {
        // Bare specifiers are resolved at runtime by the iframe import map:
        // react/react-dom from the version selector, everything else esm.sh.
        packageSpecifiers.add(specifier);
        continue;
      }
      const resolved = await resolveExisting(resolveFrom(dirOf(current.path), specifier));
      if (!resolved) {
        const base = current.path.split('/').pop();
        throw new TranspileError(`Could not resolve import "${specifier}"`, [
          { message: `${base}: cannot find module "${specifier}"` },
        ]);
      }
      readFiles.add(resolved.path);

      if (loaderForPath(resolved.path) === 'css') {
        cssChunks.push(resolved.contents);
        code = removeImport(code, specifier);
        continue;
      }
      imports[specifier] = resolved.path;
      const depLoader = loaderForPath(resolved.path);
      queue.push({
        path: resolved.path,
        source: resolved.contents,
        loader: depLoader === 'json' || depLoader === 'css' ? 'js' : depLoader,
      });
    }

    modules.set(current.path, { path: current.path, code, imports });
  }

  return {
    modules: [...modules.values()],
    entryPath,
    css: cssChunks.join('\n'),
    packages: collectPackages(packageSpecifiers),
    engine: 'babel',
    files: [...readFiles],
  };
}

function toTranspileError(err: unknown): TranspileError {
  const anyErr = err as {
    message?: string;
    errors?: Array<{ text: string; location?: { file?: string; line: number; column: number } | null }>;
  };
  if (Array.isArray(anyErr?.errors) && anyErr.errors.length > 0) {
    const infos: TranspileErrorInfo[] = anyErr.errors.map((e) => {
      // For imported files (bundling), prefix the error with the file's base
      // name so the overlay says *which* module failed, not just the line.
      const file = e.location?.file ? e.location.file.split('/').pop() : undefined;
      const message = file ? `${file}: ${e.text}` : e.text;
      return {
        message,
        line: e.location?.line,
        column: e.location != null ? e.location.column + 1 : undefined,
      };
    });
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
    bundle: bundleWithBabel,
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
