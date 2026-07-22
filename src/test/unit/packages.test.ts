import * as assert from 'assert';
import { collectPackages, esmShUrl, isReactSpecifier } from '../../transpiler/packages';

describe('packages', () => {
  describe('isReactSpecifier', () => {
    it('matches react, react-dom and their subpaths', () => {
      assert.ok(isReactSpecifier('react'));
      assert.ok(isReactSpecifier('react-dom'));
      assert.ok(isReactSpecifier('react/jsx-runtime'));
      assert.ok(isReactSpecifier('react-dom/client'));
    });

    it('does not match unrelated packages', () => {
      assert.ok(!isReactSpecifier('react-router')); // note: not react/ or react-dom/
      assert.ok(!isReactSpecifier('lodash'));
      assert.ok(!isReactSpecifier('./local'));
    });
  });

  describe('collectPackages', () => {
    it('keeps third-party bare specifiers, dropping react and relative paths', () => {
      const specifiers = ['react', 'react-dom/client', './Button', '../x', 'lodash', 'clsx', 'lodash'];
      assert.deepStrictEqual(collectPackages(specifiers), ['clsx', 'lodash']);
    });

    it('keeps scoped packages and subpaths', () => {
      const specifiers = ['@mui/material', '@mui/material/Button', 'date-fns/format'];
      assert.deepStrictEqual(collectPackages(specifiers), [
        '@mui/material',
        '@mui/material/Button',
        'date-fns/format',
      ]);
    });
  });

  describe('esmShUrl', () => {
    it('builds an esm.sh URL that shares the preview React', () => {
      assert.strictEqual(esmShUrl('clsx'), 'https://esm.sh/clsx?external=react,react-dom');
      assert.strictEqual(
        esmShUrl('@mui/material/Button'),
        'https://esm.sh/@mui/material/Button?external=react,react-dom'
      );
    });
  });
});
