import * as assert from 'assert';
import { extractSpecifiers, removeImport, rewriteSpecifier, topoSortModules } from '../../transpiler/moduleGraph';

describe('moduleGraph', () => {
  describe('extractSpecifiers', () => {
    it('finds static, side-effect and dynamic specifiers', () => {
      const src = `
        import a from './a';
        import { b } from "../b";
        import './styles.css';
        export { c } from './c';
        const d = await import('./d');
        import react from 'react';
      `;
      const specs = extractSpecifiers(src).sort();
      assert.deepStrictEqual(specs, ['../b', './a', './c', './d', './styles.css', 'react']);
    });

    it('does not match the word import inside identifiers or strings', () => {
      const src = `const importantValue = 1; const s = "important";`;
      assert.deepStrictEqual(extractSpecifiers(src), []);
    });
  });

  describe('rewriteSpecifier', () => {
    it('rewrites only in import/export positions', () => {
      const code = `import B from './B';\nexport { x } from './B';\nconst s = './B';`;
      const out = rewriteSpecifier(code, './B', 'blob:xyz');
      assert.ok(out.includes(`import B from 'blob:xyz'`));
      assert.ok(out.includes(`export { x } from 'blob:xyz'`));
      // A plain string literal is left alone.
      assert.ok(out.includes(`const s = './B'`));
    });

    it('rewrites dynamic imports and both quote styles', () => {
      assert.strictEqual(rewriteSpecifier(`import("./x")`, './x', 'U'), `import("U")`);
      assert.strictEqual(rewriteSpecifier(`from "./x"`, './x', 'U'), `from "U"`);
    });

    it('is self-contained for iframe injection', () => {
      const rebuilt = new Function(`return (${rewriteSpecifier.toString()});`)() as typeof rewriteSpecifier;
      assert.strictEqual(rebuilt(`import x from './a'`, './a', 'B'), `import x from 'B'`);
    });
  });

  describe('removeImport', () => {
    it('removes a side-effect import line', () => {
      const code = `import './a.css';\nconst x = 1;`;
      const out = removeImport(code, './a.css');
      assert.ok(!out.includes('.css'));
      assert.ok(out.includes('const x = 1;'));
    });
  });

  describe('topoSortModules', () => {
    const mod = (path: string, deps: string[] = []) => ({
      path,
      code: '',
      imports: Object.fromEntries(deps.map((d) => [d, d])),
    });

    it('orders dependencies before dependents', () => {
      const modules = [mod('/app', ['/b', '/c']), mod('/b', ['/c']), mod('/c')];
      const order = topoSortModules(modules).map((m) => m.path);
      assert.ok(order.indexOf('/c') < order.indexOf('/b'));
      assert.ok(order.indexOf('/b') < order.indexOf('/app'));
    });

    it('detects circular imports', () => {
      const modules = [mod('/a', ['/b']), mod('/b', ['/a'])];
      assert.throws(() => topoSortModules(modules), /Circular import/);
    });

    it('is self-contained for iframe injection', () => {
      const rebuilt = new Function(`return (${topoSortModules.toString()});`)() as typeof topoSortModules;
      const order = rebuilt([mod('/a', ['/b']), mod('/b')]).map((m) => m.path);
      assert.deepStrictEqual(order, ['/b', '/a']);
    });
  });
});
