import * as assert from 'assert';
import { serializeConsoleArg } from '../../webview/consoleSerialize';

describe('serializeConsoleArg', () => {
  it('prints primitives', () => {
    assert.strictEqual(serializeConsoleArg(42), '42');
    assert.strictEqual(serializeConsoleArg(true), 'true');
    assert.strictEqual(serializeConsoleArg(null), 'null');
    assert.strictEqual(serializeConsoleArg(undefined), 'undefined');
    assert.strictEqual(serializeConsoleArg(10n), '10n');
  });

  it('leaves top-level strings unquoted but quotes nested ones', () => {
    assert.strictEqual(serializeConsoleArg('hi'), 'hi');
    assert.strictEqual(serializeConsoleArg(['hi']), '["hi"]');
    assert.strictEqual(serializeConsoleArg({ a: 'hi' }), '{a: "hi"}');
  });

  it('formats arrays and objects', () => {
    assert.strictEqual(serializeConsoleArg([1, 2, 3]), '[1, 2, 3]');
    assert.strictEqual(serializeConsoleArg({ a: 1, b: [2] }), '{a: 1, b: [2]}');
  });

  it('names class instances but not plain objects', () => {
    class Point {
      constructor(
        public x: number,
        public y: number
      ) {}
    }
    assert.strictEqual(serializeConsoleArg(new Point(1, 2)), 'Point {x: 1, y: 2}');
    assert.strictEqual(serializeConsoleArg({ x: 1 }), '{x: 1}');
  });

  it('formats Map and Set with sizes', () => {
    assert.strictEqual(serializeConsoleArg(new Map([['a', 1]])), 'Map(1) {"a" => 1}');
    assert.strictEqual(serializeConsoleArg(new Set([1, 2])), 'Set(2) {1, 2}');
  });

  it('handles circular references without throwing', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;
    const out = serializeConsoleArg(obj);
    assert.ok(out.includes('[Circular]'), out);
  });

  it('does not mark repeated siblings as circular', () => {
    const shared = { v: 1 };
    assert.strictEqual(serializeConsoleArg({ a: shared, b: shared }), '{a: {v: 1}, b: {v: 1}}');
  });

  it('caps nesting depth', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = serializeConsoleArg(deep);
    assert.ok(out.includes('{…}'), out);
    assert.ok(!out.includes('e: 1'), out);
  });

  it('truncates long strings and large arrays', () => {
    const long = 'x'.repeat(600);
    assert.ok(serializeConsoleArg(long).endsWith('…'));
    assert.ok(serializeConsoleArg(long).length < 600);

    const big = Array.from({ length: 80 }, (_, i) => i);
    const out = serializeConsoleArg(big);
    assert.ok(out.includes('30 more'), out);
  });

  it('formats functions, dates, regexes and errors', () => {
    assert.strictEqual(serializeConsoleArg(function greet() {}), 'ƒ greet()');
    assert.strictEqual(serializeConsoleArg(/ab+c/gi), '/ab+c/gi');
    assert.strictEqual(serializeConsoleArg(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03:04:05.000Z');
    const err = new Error('boom');
    assert.ok(serializeConsoleArg(err).startsWith('Error: boom'));
  });

  it('formats DOM-like nodes structurally', () => {
    assert.strictEqual(serializeConsoleArg({ nodeType: 1, nodeName: 'DIV' }), '<div>');
  });

  it('is self-contained so it can be injected into the iframe', () => {
    // The loader inlines this function via toString(); if it ever closed over
    // a module-scope binding, the injected copy would throw at runtime.
    const source = serializeConsoleArg.toString();
    const rebuilt = new Function(`return (${source});`)() as typeof serializeConsoleArg;
    assert.strictEqual(rebuilt({ a: [1, 'two'] }), '{a: [1, "two"]}');
  });
});
