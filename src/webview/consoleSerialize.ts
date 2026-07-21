/**
 * Formats a console argument into a display string, devtools-style.
 *
 * IMPORTANT: this function is injected into the sandboxed preview iframe by
 * stringifying it (`serializeConsoleArg.toString()`), because the iframe is a
 * separate realm with no module loader. It must therefore be entirely
 * self-contained: no imports, no references to module-scope bindings, and no
 * reliance on names that a minifier could rename from the outside. Everything
 * it needs is declared inside the function body.
 *
 * Keeping it a real module (rather than a string literal) means the logic is
 * type-checked and unit-tested in plain Node.
 *
 * @param value        the value to format
 * @param quoteStrings whether strings should be quoted. Top-level console
 *                     arguments print bare (`console.log('hi')` → `hi`);
 *                     strings nested inside objects/arrays are quoted.
 */
export function serializeConsoleArg(value: unknown, quoteStrings = false): string {
  const MAX_DEPTH = 3;
  const MAX_ITEMS = 50;
  const MAX_STRING = 500;
  const seen = new WeakSet<object>();

  const truncate = (s: string): string => (s.length > MAX_STRING ? s.slice(0, MAX_STRING) + '…' : s);

  const format = (v: unknown, depth: number, quote: boolean): string => {
    if (v === null) {
      return 'null';
    }
    if (v === undefined) {
      return 'undefined';
    }

    const type = typeof v;
    if (type === 'string') {
      const s = truncate(v as string);
      return quote ? JSON.stringify(s) : s;
    }
    if (type === 'number' || type === 'boolean') {
      return String(v);
    }
    if (type === 'bigint') {
      return String(v) + 'n';
    }
    if (type === 'symbol') {
      return String(v);
    }
    if (type === 'function') {
      const name = (v as { name?: string }).name;
      return name ? 'ƒ ' + name + '()' : 'ƒ ()';
    }

    const obj = v as object;
    if (seen.has(obj)) {
      return '[Circular]';
    }

    // Errors, dates and regexes have canonical text forms.
    if (v instanceof Error) {
      return v.stack || v.name + ': ' + v.message;
    }
    if (v instanceof Date) {
      return v.toISOString();
    }
    if (v instanceof RegExp) {
      return String(v);
    }

    // DOM nodes, detected structurally so this also works outside a browser.
    const maybeNode = v as { nodeType?: unknown; nodeName?: unknown };
    if (typeof maybeNode.nodeType === 'number' && typeof maybeNode.nodeName === 'string') {
      return '<' + maybeNode.nodeName.toLowerCase() + '>';
    }

    if (depth >= MAX_DEPTH) {
      return Array.isArray(v) ? '[…]' : '{…}';
    }

    seen.add(obj);
    try {
      if (Array.isArray(v)) {
        const items = v.slice(0, MAX_ITEMS).map((item) => format(item, depth + 1, true));
        if (v.length > MAX_ITEMS) {
          items.push('… ' + (v.length - MAX_ITEMS) + ' more');
        }
        return '[' + items.join(', ') + ']';
      }

      if (v instanceof Map) {
        const items: string[] = [];
        for (const [k, val] of v) {
          if (items.length >= MAX_ITEMS) {
            items.push('… ' + (v.size - MAX_ITEMS) + ' more');
            break;
          }
          items.push(format(k, depth + 1, true) + ' => ' + format(val, depth + 1, true));
        }
        return 'Map(' + v.size + ') {' + items.join(', ') + '}';
      }

      if (v instanceof Set) {
        const items: string[] = [];
        for (const val of v) {
          if (items.length >= MAX_ITEMS) {
            items.push('… ' + (v.size - MAX_ITEMS) + ' more');
            break;
          }
          items.push(format(val, depth + 1, true));
        }
        return 'Set(' + v.size + ') {' + items.join(', ') + '}';
      }

      const keys = Object.keys(obj);
      const entries = keys
        .slice(0, MAX_ITEMS)
        .map((key) => key + ': ' + format((obj as Record<string, unknown>)[key], depth + 1, true));
      if (keys.length > MAX_ITEMS) {
        entries.push('… ' + (keys.length - MAX_ITEMS) + ' more');
      }
      // Show the constructor name for class instances (but not plain objects).
      const ctorName = (obj.constructor && obj.constructor.name) || '';
      const prefix = ctorName && ctorName !== 'Object' ? ctorName + ' ' : '';
      return prefix + '{' + entries.join(', ') + '}';
    } finally {
      // Removed after the subtree is done so that a value referenced twice as
      // a sibling isn't misreported as circular.
      seen.delete(obj);
    }
  };

  return format(value, 0, quoteStrings);
}
