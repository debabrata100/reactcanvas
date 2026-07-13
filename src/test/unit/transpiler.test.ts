/**
 * Unit tests for the transpile pipeline. These run in plain Node (no VS Code
 * host needed): `npm run test:unit`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  createBabelTranspiler,
  createEsbuildTranspiler,
  createTranspiler,
  hasDefaultExport,
  stripCssImports,
  TranspileError,
  Transpiler,
} from '../../transpiler';

const WASM_PATH = path.resolve(__dirname, '../../../node_modules/esbuild-wasm/esbuild.wasm');

const JSX_SOURCE = `
import './App.css';
export default function App() {
  const [n, setN] = React.useState(0);
  return <button style={{ color: 'red' }} onClick={() => setN(n + 1)}>{n}</button>;
}
`;

const TSX_SOURCE = `
interface Props { label: string }
const Badge = ({ label }: Props) => <span>{label}</span>;
export default function App(): JSX.Element {
  return <Badge label="hi" />;
}
`;

const BROKEN_SOURCE = `export default function App() {\n  return <div>\n}\n`;

/**
 * esbuild rewrites `export default function App` into
 * `export { App as default }`; babel keeps `export default`. Both expose
 * `.default` at runtime, which is what the preview loader consumes.
 */
function keepsDefaultExport(code: string): boolean {
  return code.includes('export default') || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(code);
}

function commonSuite(name: string, make: () => Promise<Transpiler>): void {
  describe(`${name} engine`, function () {
    this.timeout(30000);
    let transpiler: Transpiler;

    before(async () => {
      transpiler = await make();
    });

    it('transpiles JSX with hooks and inline styles', async () => {
      const result = await transpiler.transpile(JSX_SOURCE, { filename: 'App.jsx' });
      assert.ok(keepsDefaultExport(result.code), 'keeps the default export');
      assert.ok(!result.code.includes('<button'), 'JSX is compiled away');
      assert.ok(/jsx|createElement/i.test(result.code), 'uses a JSX factory');
    });

    it('transpiles TSX (types stripped)', async () => {
      const result = await transpiler.transpile(TSX_SOURCE, { filename: 'App.tsx' });
      assert.ok(!result.code.includes('interface'), 'TS types are stripped');
      assert.ok(keepsDefaultExport(result.code));
    });

    it('strips CSS imports from output', async () => {
      const result = await transpiler.transpile(JSX_SOURCE, { filename: 'App.jsx' });
      assert.ok(!result.code.includes('.css'), 'CSS import removed');
    });

    it('reports syntax errors with a line number', async () => {
      await assert.rejects(
        () => transpiler.transpile(BROKEN_SOURCE, { filename: 'App.jsx' }),
        (err: unknown) => {
          assert.ok(err instanceof TranspileError, 'throws TranspileError');
          assert.ok(err.errors.length > 0);
          assert.ok(typeof err.errors[0].line === 'number', 'has a line number');
          return true;
        }
      );
    });

    it('honors an explicit loader for extensionless (untitled) files', async () => {
      // "Untitled-1" has no extension; without the override this TSX
      // source would be parsed as JSX and fail on the interface keyword.
      const result = await transpiler.transpile(TSX_SOURCE, { filename: 'Untitled-1', loader: 'tsx' });
      assert.ok(!result.code.includes('interface'), 'TS types are stripped');
      assert.ok(keepsDefaultExport(result.code));
    });

    it('supports multiple components in one file', async () => {
      const source = `
        const Item = ({ x }) => <li>{x}</li>;
        export function List() { return <ul><Item x="a" /></ul>; }
        export default List;
      `;
      const result = await transpiler.transpile(source, { filename: 'List.jsx' });
      assert.ok(keepsDefaultExport(result.code));
    });
  });
}

describe('transpiler', () => {
  commonSuite('esbuild-wasm', async () => {
    const wasm = await WebAssembly.compile(fs.readFileSync(WASM_PATH));
    return createEsbuildTranspiler(wasm);
  });

  commonSuite('babel fallback', async () => createBabelTranspiler());

  describe('createTranspiler facade', function () {
    this.timeout(30000);

    it('prefers esbuild when wasm is provided', async () => {
      const transpiler = await createTranspiler({ wasmBinary: fs.readFileSync(WASM_PATH) });
      assert.strictEqual(transpiler.name, 'esbuild');
    });

    it('falls back to babel when wasm is invalid', async () => {
      const logs: string[] = [];
      const transpiler = await createTranspiler({
        wasmBinary: new Uint8Array([0, 1, 2, 3]),
        log: (m) => logs.push(m),
      });
      assert.strictEqual(transpiler.name, 'babel');
      assert.ok(logs.some((l) => l.includes('falling back')));
    });

    it('falls back to babel when wasm is absent', async () => {
      const transpiler = await createTranspiler({});
      assert.strictEqual(transpiler.name, 'babel');
    });
  });

  describe('helpers', () => {
    it('stripCssImports preserves line numbers', () => {
      const source = `import './a.css';\nimport styles from "./b.css"\nconst x = 1;`;
      const stripped = stripCssImports(source);
      assert.strictEqual(stripped.split('\n').length, source.split('\n').length);
      assert.ok(!stripped.includes('.css'));
      assert.ok(stripped.includes('const x = 1;'));
    });

    it('stripCssImports leaves non-CSS imports alone', () => {
      const source = `import React from 'react';`;
      assert.strictEqual(stripCssImports(source), source);
    });

    it('hasDefaultExport detects common forms', () => {
      assert.ok(hasDefaultExport('export default function App() {}'));
      assert.ok(hasDefaultExport('const A = 1;\nexport default A;'));
      assert.ok(hasDefaultExport('export { App as default };'));
      assert.ok(!hasDefaultExport('export const App = () => null;'));
    });
  });
});
