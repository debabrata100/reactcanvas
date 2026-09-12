import * as assert from 'assert';
import { collectPackages, esmShUrl, isReactSpecifier, parsePackageSpecifier } from '../../transpiler/packages';

describe('packages', () => {
  describe('parsePackageSpecifier', () => {
    it('parses plain, versioned, scoped and subpath forms', () => {
      assert.deepStrictEqual(parsePackageSpecifier('clsx'), { name: 'clsx', version: '', subpath: '' });
      assert.deepStrictEqual(parsePackageSpecifier('clsx@2'), { name: 'clsx', version: '2', subpath: '' });
      assert.deepStrictEqual(parsePackageSpecifier('lodash@4.17.21/fp'), {
        name: 'lodash',
        version: '4.17.21',
        subpath: '/fp',
      });
      assert.deepStrictEqual(parsePackageSpecifier('@mui/material'), {
        name: '@mui/material',
        version: '',
        subpath: '',
      });
      assert.deepStrictEqual(parsePackageSpecifier('@mui/material@5/Button'), {
        name: '@mui/material',
        version: '5',
        subpath: '/Button',
      });
    });
  });

  describe('isReactSpecifier', () => {
    it('matches react, react-dom and their subpaths', () => {
      assert.ok(isReactSpecifier('react'));
      assert.ok(isReactSpecifier('react-dom'));
      assert.ok(isReactSpecifier('react/jsx-runtime'));
      assert.ok(isReactSpecifier('react-dom/client'));
    });

    it('matches pinned react so it stays on the version selector', () => {
      assert.ok(isReactSpecifier('react@19'));
      assert.ok(isReactSpecifier('react-dom@19/client'));
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

    it('passes a pinned version straight through to esm.sh', () => {
      assert.strictEqual(esmShUrl('clsx@2'), 'https://esm.sh/clsx@2?external=react,react-dom');
      assert.strictEqual(esmShUrl('lodash@4.17.21/fp'), 'https://esm.sh/lodash@4.17.21/fp?external=react,react-dom');
    });
  });

  describe('collectPackages with versions', () => {
    it('keeps pinned specifiers verbatim and still excludes react', () => {
      const specs = ['react@19', 'react-dom@19/client', 'clsx@2', './local', 'date-fns@3'];
      assert.deepStrictEqual(collectPackages(specs), ['clsx@2', 'date-fns@3']);
    });
  });
});
