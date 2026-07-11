/** Messages exchanged between the extension host and the webview. */

export type ReactVersion = '17' | '18' | '19';

export const REACT_VERSIONS: ReactVersion[] = ['17', '18', '19'];
export const DEFAULT_REACT_VERSION: ReactVersion = '18';

/** Extension host -> webview */
export type HostMessage =
  | {
      type: 'render';
      fileName: string;
      /** Transpiled ESM code for the user's component. */
      code: string;
      /** Contents of the sibling .css file, if any. */
      css: string;
      reactVersion: ReactVersion;
      engine: 'esbuild' | 'babel';
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
