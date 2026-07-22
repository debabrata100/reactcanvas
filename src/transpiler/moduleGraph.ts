/**
 * Pure helpers for manual module bundling. No esbuild, no vscode — so every
 * function here is unit-tested in plain Node.
 *
 * Why manual bundling: esbuild-wasm's `build` API needs plugin callbacks that
 * deadlock under the in-process (`worker: false`) wasm we run in the extension
 * host. Instead we transpile each file individually with the (reliable)
 * `transform` API, then hand the browser's native ES module loader a set of
 * blob-URL modules to link. These helpers do the specifier bookkeeping that
 * makes that linking possible.
 */

/** A single transpiled module in the graph. */
export interface GraphModule {
  /** Canonical absolute path (identity within the graph). */
  path: string;
  /** Transpiled JS. Relative import specifiers are left intact for rewriting. */
  code: string;
  /** Map of the original relative specifier -> canonical path it resolves to. */
  imports: Record<string, string>;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extract every module specifier from source: `import`/`export … from`,
 * side-effect `import '…'`, and dynamic `import('…')`.
 */
export function extractSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:^|[^\w$.])(?:import|export)\b[^'"]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /(?:^|[^\w$.])import\s*(['"])([^'"]+)\1/g,
    /(?:^|[^\w$.])import\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[2]);
    }
  }
  return [...specifiers];
}

/**
 * Replace a specifier with a new one, but only where it appears as an actual
 * import/export target — never inside unrelated string literals.
 *
 * Self-contained (inlines its own escaping) because it is injected into the
 * preview iframe by stringifying it — see moduleGraph module header.
 */
export function rewriteSpecifier(code: string, specifier: string, replacement: string): string {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(from\\s*|import\\s*\\(\\s*|import\\s*)(['"])${escaped}\\2`, 'g');
  return code.replace(pattern, (_m, prefix: string, quote: string) => `${prefix}${quote}${replacement}${quote}`);
}

/** Remove a side-effect import statement (used for `.css` imports). */
export function removeImport(code: string, specifier: string): string {
  const pattern = new RegExp(`(?:^|\\n)[ \\t]*import\\s*(['"])${esc(specifier)}\\1\\s*;?[ \\t]*`, 'g');
  return code.replace(pattern, '\n');
}

/**
 * Order modules so dependencies precede dependents (needed to create blob
 * URLs in the right order). Throws on a circular import, naming the cycle.
 */
export function topoSortModules(modules: GraphModule[]): GraphModule[] {
  const byPath = new Map(modules.map((m) => [m.path, m]));
  const ordered: GraphModule[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (mod: GraphModule, trail: string[]): void => {
    const status = state.get(mod.path);
    if (status === 'done') {
      return;
    }
    if (status === 'visiting') {
      const cycle = [...trail.slice(trail.indexOf(mod.path)), mod.path].map((p) => p.split('/').pop());
      throw new Error(`Circular import: ${cycle.join(' → ')}`);
    }
    state.set(mod.path, 'visiting');
    for (const dep of Object.values(mod.imports)) {
      const depMod = byPath.get(dep);
      if (depMod) {
        visit(depMod, [...trail, mod.path]);
      }
    }
    state.set(mod.path, 'done');
    ordered.push(mod);
  };

  for (const mod of modules) {
    visit(mod, []);
  }
  return ordered;
}
