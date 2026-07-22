/**
 * Resolution of bare (npm) import specifiers to esm.sh URLs.
 *
 * `react` and `react-dom` are provided by the version-selector import map, so
 * they are excluded here. Every other bare specifier is served from esm.sh,
 * with React marked external so third-party libraries share the single React
 * instance the preview already loaded.
 */
import { isBareSpecifier } from './pathResolver';

/** True for `react`, `react-dom`, and their subpaths (e.g. `react/jsx-runtime`). */
export function isReactSpecifier(specifier: string): boolean {
  return (
    specifier === 'react' ||
    specifier === 'react-dom' ||
    specifier.startsWith('react/') ||
    specifier.startsWith('react-dom/')
  );
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

/** esm.sh URL for a package specifier, sharing the preview's React instance. */
export function esmShUrl(specifier: string): string {
  return `https://esm.sh/${specifier}?external=react,react-dom`;
}
