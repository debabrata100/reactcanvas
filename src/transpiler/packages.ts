/**
 * Resolution of bare (npm) import specifiers to esm.sh URLs.
 *
 * `react` and `react-dom` are provided by the version-selector import map, so
 * they are excluded here. Every other bare specifier is served from esm.sh,
 * with React marked external so third-party libraries share the single React
 * instance the preview already loaded.
 */
import { isBareSpecifier } from './pathResolver';

export interface ParsedSpecifier {
  /** Package name, including any scope (e.g. `lodash`, `@mui/material`). */
  name: string;
  /** Pinned version if the specifier carried one (e.g. `2`, `4.17.21`), else ''. */
  version: string;
  /** Subpath after the package, including the leading slash (e.g. `/fp`), else ''. */
  subpath: string;
}

/**
 * Split a bare specifier into name / version / subpath. Handles scopes,
 * versions and subpaths in any combination, e.g.:
 *   `clsx`               -> { name: 'clsx', version: '', subpath: '' }
 *   `clsx@2`             -> { name: 'clsx', version: '2', subpath: '' }
 *   `lodash@4/fp`        -> { name: 'lodash', version: '4', subpath: '/fp' }
 *   `@mui/material@5/Button` -> { name: '@mui/material', version: '5', subpath: '/Button' }
 */
export function parsePackageSpecifier(specifier: string): ParsedSpecifier {
  let scope = '';
  let rest = specifier;
  if (rest.startsWith('@')) {
    const slash = rest.indexOf('/');
    if (slash !== -1) {
      scope = rest.slice(0, slash + 1); // "@scope/"
      rest = rest.slice(slash + 1);
    }
  }
  // `rest` is now `name[@version][/subpath]`.
  let name = rest;
  let version = '';
  let subpath = '';
  const at = rest.indexOf('@');
  if (at > 0) {
    name = rest.slice(0, at);
    const afterAt = rest.slice(at + 1); // `version[/subpath]`
    const slash = afterAt.indexOf('/');
    if (slash !== -1) {
      version = afterAt.slice(0, slash);
      subpath = afterAt.slice(slash);
    } else {
      version = afterAt;
    }
  } else {
    const slash = rest.indexOf('/');
    if (slash !== -1) {
      name = rest.slice(0, slash);
      subpath = rest.slice(slash);
    }
  }
  return { name: scope + name, version, subpath };
}

/**
 * True for `react`/`react-dom` and their subpaths — including pinned forms like
 * `react@19` — so they always resolve through the version-selector import map
 * rather than being treated as third-party esm.sh packages.
 */
export function isReactSpecifier(specifier: string): boolean {
  const { name } = parsePackageSpecifier(specifier);
  return name === 'react' || name === 'react-dom';
}

/** Third-party bare specifiers from a set of imports, de-duplicated and sorted. */
export function collectPackages(specifiers: Iterable<string>): string[] {
  const packages = new Set<string>();
  for (const specifier of specifiers) {
    if (isBareSpecifier(specifier) && !isReactSpecifier(specifier)) {
      packages.add(specifier);
    }
  }
  return [...packages].sort();
}

/**
 * esm.sh URL for a package specifier, sharing the preview's React instance.
 * The specifier is used verbatim, so a pinned version (`clsx@2`) or subpath
 * (`lodash@4/fp`) flows straight through to esm.sh.
 */
export function esmShUrl(specifier: string): string {
  return `https://esm.sh/${specifier}?external=react,react-dom`;
}
