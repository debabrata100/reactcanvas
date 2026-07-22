/**
 * Content-Security-Policy for the preview webview.
 *
 * User code runs inside a sandboxed srcdoc iframe (`sandbox="allow-scripts"`,
 * no `allow-same-origin`), which inherits this policy. The policy therefore
 * has to admit everything that legitimate preview code needs while keeping the
 * iframe unable to reach the extension host:
 *
 * - `script-src`: the nonce'd bootstrap, esm.sh (React + npm packages), and
 *   `blob:` (each user module is imported from a Blob URL).
 * - `connect-src`: user components routinely call `fetch`, open WebSockets, or
 *   use EventSource against arbitrary APIs, so any HTTPS origin is allowed,
 *   plus localhost for local dev servers. The iframe has an opaque origin, so
 *   its requests carry `Origin: null` — public APIs that allow it work; APIs
 *   that reject a null origin will not, which is an inherent sandbox trade-off.
 *
 * Kept dependency-free (no `vscode`) so it can be unit-tested.
 */
export function buildContentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `img-src ${cspSource} https: data: blob:`,
    `style-src ${cspSource} https://esm.sh 'unsafe-inline'`,
    `font-src ${cspSource} https://esm.sh data:`,
    `script-src 'nonce-${nonce}' https://esm.sh blob:`,
    `connect-src https: http://localhost:* http://127.0.0.1:* ws: wss: data: blob:`,
    `frame-src blob: data:`,
    `child-src blob: data:`,
  ].join('; ');
}
