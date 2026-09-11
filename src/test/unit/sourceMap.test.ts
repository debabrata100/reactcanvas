import * as assert from 'assert';
import { decodeVlq, originalPositionFor, RawSourceMap, remapStack } from '../../sourceMap';

// A real map produced by esbuild for:
//   line 1: export default function Counter() {
//   line 2:   const x = 1;
//   line 3:   throw new Error("boom");
//   line 4: }
const ESBUILD_MAP: RawSourceMap = {
  version: 3,
  sources: ['Counter.jsx'],
  mappings: 'AAAA,wBAAwB,UAAU;AAChC,QAAM,IAAI;AACV,QAAM,IAAI,MAAM,MAAM;AACxB;',
};

describe('sourceMap', () => {
  describe('decodeVlq', () => {
    it('decodes the zero segment', () => {
      assert.deepStrictEqual(decodeVlq('AAAA'), [0, 0, 0, 0]);
    });

    it('decodes signed and multi-field segments', () => {
      // "D" = 3 → sign-folded → -1
      assert.deepStrictEqual(decodeVlq('D'), [-1]);
      // A single positive value: "C" = 2 → 1
      assert.deepStrictEqual(decodeVlq('C'), [1]);
    });
  });

  describe('originalPositionFor', () => {
    it('maps a generated line/column back to the original source', () => {
      // Generated line 3 is the throw; expect original Counter.jsx line 3.
      const pos = originalPositionFor(ESBUILD_MAP, 3, 3);
      assert.deepStrictEqual(pos, { source: 'Counter.jsx', line: 3, column: 3 });
    });

    it('maps an earlier line correctly', () => {
      const pos = originalPositionFor(ESBUILD_MAP, 2, 3);
      assert.strictEqual(pos?.line, 2);
    });

    it('returns null for a line beyond the map', () => {
      assert.strictEqual(originalPositionFor(ESBUILD_MAP, 99, 1), null);
    });
  });

  describe('remapStack', () => {
    it('rewrites known tokens and leaves unknown frames alone', () => {
      const stack = ['Error: boom', '    at Counter (rcmod0:3:3)', '    at run (rcmod1:1:1)'].join('\n');
      const out = remapStack(stack, { rcmod0: ESBUILD_MAP });
      assert.ok(out.includes('at Counter (Counter.jsx:3:3)'), out);
      assert.ok(out.includes('at run (rcmod1:1:1)'), 'unknown token untouched');
    });

    it('uses the source basename, not the full path', () => {
      const map: RawSourceMap = { ...ESBUILD_MAP, sources: ['/abs/proj/Counter.jsx'] };
      const out = remapStack('at x (rcmod0:3:3)', { rcmod0: map });
      assert.ok(out.includes('Counter.jsx:3:3'), out);
      assert.ok(!out.includes('/abs/proj'), out);
    });

    it('leaves the stack unchanged when no token has a map', () => {
      const stack = 'at Counter (rcmod0:3:3)';
      assert.strictEqual(remapStack(stack, { rcmod0: undefined }), stack);
    });
  });
});
