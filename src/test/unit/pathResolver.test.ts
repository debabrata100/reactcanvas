import * as assert from 'assert';
import {
  candidatePaths,
  dirOf,
  isBareSpecifier,
  loaderForPath,
  normalizeSlashes,
  resolveFrom,
} from '../../transpiler/pathResolver';

describe('pathResolver', () => {
  it('normalizes back-slashes', () => {
    assert.strictEqual(normalizeSlashes('a\\b\\c'), 'a/b/c');
  });

  it('computes dirname', () => {
    assert.strictEqual(dirOf('/a/b/c.jsx'), '/a/b');
    assert.strictEqual(dirOf('/a'), '/');
    assert.strictEqual(dirOf('foo.jsx'), '.');
  });

  it('resolves relative specifiers with . and ..', () => {
    assert.strictEqual(resolveFrom('/proj/src', './Button'), '/proj/src/Button');
    assert.strictEqual(resolveFrom('/proj/src', '../shared/x'), '/proj/shared/x');
    assert.strictEqual(resolveFrom('/proj/src', './a/./b/../c'), '/proj/src/a/c');
  });

  it('distinguishes bare from relative specifiers', () => {
    assert.ok(isBareSpecifier('react'));
    assert.ok(isBareSpecifier('lodash/fp'));
    assert.ok(!isBareSpecifier('./Button'));
    assert.ok(!isBareSpecifier('../x'));
    assert.ok(!isBareSpecifier('/abs'));
  });

  it('produces candidate paths in priority order', () => {
    const c = candidatePaths('/proj/Button');
    assert.strictEqual(c[0], '/proj/Button.tsx');
    assert.ok(c.includes('/proj/Button.jsx'));
    assert.ok(c.includes('/proj/Button/index.tsx'));
  });

  it('tries an explicit extension verbatim first', () => {
    const c = candidatePaths('/proj/styles.css');
    assert.strictEqual(c[0], '/proj/styles.css');
  });

  it('maps paths to loaders', () => {
    assert.strictEqual(loaderForPath('/a.tsx'), 'tsx');
    assert.strictEqual(loaderForPath('/a.ts'), 'ts');
    assert.strictEqual(loaderForPath('/a.jsx'), 'jsx');
    assert.strictEqual(loaderForPath('/a.css'), 'css');
    assert.strictEqual(loaderForPath('/a.json'), 'json');
    assert.strictEqual(loaderForPath('/a.mjs'), 'js');
  });
});
