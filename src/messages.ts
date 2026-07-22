/** Messages exchanged between the extension host and the webview. */

export type ReactVersion = '17' | '18' | '19';

export const REACT_VERSIONS: ReactVersion[] = ['17', '18', '19'];
export const DEFAULT_REACT_VERSION: ReactVersion = '18';

/** One transpiled module the webview links via a blob URL. */
export interface RenderModule {
  /** Canonical path (or 'entry' for the single-file case) — the blob-map key. */
  path: string;
  /** Transpiled JS with relative specifiers still pointing at canonical paths. */
  code: string;
  /** Relative specifier -> canonical path of the module it resolves to. */
  imports: Record<string, string>;
}

/** Extension host -> webview */
export type HostMessage =
  | {
      type: 'render';
      fileName: string;
      /** Modules to link. Single-file previews send exactly one. */
      modules: RenderModule[];
      /** Canonical path of the entry module (its key in `modules`). */
      entryPath: string;
      /** Concatenated CSS from sibling/imported .css files. */
      css: string;
      reactVersion: ReactVersion;
      engine: 'esbuild' | 'babel';
      /** Number of files in the graph, shown in the toolbar when > 1. */
      fileCount: number;
    }
  | {
      type: 'transpile-error';
      fileName: string;
      errors: { message: string; line?: number; column?: number }[];
    }
  | {
      type: 'no-target';
      reason: string;
    };

/** Webview -> extension host */
export type WebviewMessage = { type: 'ready' } | { type: 'select-version' };
