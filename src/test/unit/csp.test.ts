import * as assert from 'assert';
import { buildContentSecurityPolicy } from '../../csp';

describe('buildContentSecurityPolicy', () => {
  const csp = buildContentSecurityPolicy('vscode-resource://host', 'NONCE123');
  const directive = (name: string) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(name + ' '));

  it('locks the default source down', () => {
    assert.ok(csp.includes(`default-src 'none'`));
  });

  it('only allows the nonce, esm.sh and blob: for scripts', () => {
    const scriptSrc = directive('script-src')!;
    assert.ok(scriptSrc.includes(`'nonce-NONCE123'`));
    assert.ok(scriptSrc.includes('https://esm.sh'));
    assert.ok(scriptSrc.includes('blob:'));
    assert.ok(!scriptSrc.includes(`'unsafe-inline'`), 'scripts must not allow unsafe-inline');
  });

  it('lets user components reach arbitrary APIs and local dev servers', () => {
    const connectSrc = directive('connect-src')!;
    assert.ok(connectSrc.includes('https:'), 'any HTTPS API');
    assert.ok(connectSrc.includes('http://localhost:*'), 'local dev server');
    assert.ok(connectSrc.includes('ws:') && connectSrc.includes('wss:'), 'websockets');
  });

  it('does not grant same-origin escape to the iframe', () => {
    // The sandbox never gets allow-same-origin; the CSP must not silently
    // widen script access to arbitrary origins either.
    assert.ok(!csp.includes(`script-src 'self'`));
  });
});
