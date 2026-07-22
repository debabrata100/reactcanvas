/**
 * Path helpers for the virtual-filesystem bundler. Kept dependency-free
 * (no Node `path`, no `vscode`) so they behave identically in the extension
 * host and in unit tests, and so all paths are treated with `/` separators
 * regardless of the host OS.
 */

/** Normalize Windows back-slashes to forward slashes. */
export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Directory portion of a path (no trailing slash), like POSIX dirname. */
export function dirOf(path: string): string {
  const p = normalizeSlashes(path);
  const idx = p.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return p.slice(0, idx);
}

/**
 * Resolve a relative specifier against an importer's directory, collapsing
 * `.` and `..` segments. Preserves a leading `/` (POSIX) or `C:` (Windows).
 */
export function resolveFrom(importerDir: string, specifier: string): string {
  const dir = normalizeSlashes(importerDir);
  const spec = normalizeSlashes(specifier);
  const segments = dir.split('/').concat(spec.split('/'));
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  const leadingSlash = dir.startsWith('/');
  return (leadingSlash ? '/' : '') + stack.join('/');
}

/** True for bare package specifiers (`react`, `lodash/fp`) vs. `./` or `/`. */
export function isBareSpecifier(specifier: string): boolean {
  const s = normalizeSlashes(specifier);
  return !s.startsWith('.') && !s.startsWith('/');
}

const MODULE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'];
const INDEX_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * Candidate on-disk paths for a resolved import, in priority order — the
 * literal path, then extension completions, then `index.*` inside a folder.
 * Mirrors how a bundler resolves `./Button` to `./Button.tsx` or
 * `./Button/index.tsx`.
 */
export function candidatePaths(resolved: string): string[] {
  const p = normalizeSlashes(resolved);
  const base = p.split('/').pop() ?? '';
  const alreadyHasExtension = /\.[a-z0-9]+$/i.test(base);

  const candidates: string[] = [];
  // A path that already carries an extension (e.g. ".css", ".tsx") is tried
  // verbatim first.
  if (alreadyHasExtension) {
    candidates.push(p);
  }
  for (const ext of MODULE_EXTENSIONS) {
    candidates.push(p + ext);
  }
  for (const ext of INDEX_EXTENSIONS) {
    candidates.push(p + '/index' + ext);
  }
  // De-duplicate while preserving order.
  return [...new Set(candidates)];
}

/** esbuild loader for a resolved file path. */
export function loaderForPath(path: string): 'tsx' | 'ts' | 'jsx' | 'js' | 'json' | 'css' {
  const p = normalizeSlashes(path).toLowerCase();
  if (p.endsWith('.tsx')) {
    return 'tsx';
  }
  if (p.endsWith('.ts')) {
    return 'ts';
  }
  if (p.endsWith('.jsx')) {
    return 'jsx';
  }
  if (p.endsWith('.json')) {
    return 'json';
  }
  if (p.endsWith('.css')) {
    return 'css';
  }
  return 'js';
}
