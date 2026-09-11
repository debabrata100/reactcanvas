/**
 * A tiny Source Map v3 reader — just enough to translate a *generated*
 * position (from a runtime stack trace) back to the *original* source line and
 * column the user wrote.
 *
 * We deliberately do not depend on the `source-map` npm package: it's large and
 * wasm-backed, and we only need one operation (position lookup). Everything
 * here is plain, dependency-free, and unit-tested.
 *
 * This module runs in the *webview*, not the sandboxed iframe — so, unlike the
 * console serializer or the specifier rewriter, it is imported normally and
 * never stringified/injected. That keeps it a single, ordinary code path.
 */

export interface RawSourceMap {
  version: number;
  sources: (string | null)[];
  mappings: string;
  names?: string[];
  sourcesContent?: (string | null)[];
}

export interface OriginalPosition {
  source: string | null;
  line: number; // 1-based
  column: number; // 1-based
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHAR_TO_INT: Record<string, number> = {};
for (let i = 0; i < BASE64.length; i++) {
  CHAR_TO_INT[BASE64[i]] = i;
}

/**
 * Decode one Base64-VLQ segment (e.g. "AAAA") into its integer fields. Source
 * maps store deltas this way: each field is a variable-length, sign-folded,
 * base-64 number.
 */
export function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;
  for (let i = 0; i < segment.length; i++) {
    const integer = CHAR_TO_INT[segment[i]];
    if (integer === undefined) {
      throw new Error(`Invalid VLQ character: ${segment[i]}`);
    }
    const hasContinuationBit = integer & 32;
    value += (integer & 31) << shift;
    if (hasContinuationBit) {
      shift += 5;
    } else {
      const shouldNegate = value & 1;
      value >>>= 1;
      values.push(shouldNegate ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

/**
 * Translate a generated (line, column) — both 1-based, as they appear in a V8
 * stack frame — to the original position, or null if nothing maps there.
 */
export function originalPositionFor(
  map: RawSourceMap,
  generatedLine: number,
  generatedColumn: number
): OriginalPosition | null {
  const targetLine = generatedLine - 1; // mappings are 0-based by line index
  const targetColumn = generatedColumn - 1;
  const lines = map.mappings.split(';');
  if (targetLine < 0 || targetLine >= lines.length) {
    return null;
  }

  // Source index / original line / original column accumulate across the whole
  // file, so we must walk every line up to the target to keep them in sync.
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  for (let line = 0; line <= targetLine; line++) {
    let generatedCol = 0;
    let best: OriginalPosition | null = null;
    const group = lines[line];
    if (group !== '') {
      for (const segment of group.split(',')) {
        const fields = decodeVlq(segment);
        generatedCol += fields[0];
        if (fields.length >= 4) {
          sourceIndex += fields[1];
          sourceLine += fields[2];
          sourceColumn += fields[3];
          // On the target line, remember the last segment at or before the
          // column we're looking for (segments are ordered by column).
          if (line === targetLine && generatedCol <= targetColumn) {
            best = {
              source: map.sources[sourceIndex] ?? null,
              line: sourceLine + 1,
              column: sourceColumn + 1,
            };
          }
        }
      }
    }
    if (line === targetLine) {
      return best;
    }
  }
  return null;
}

/**
 * Rewrite a stack trace in which our module blob URLs have been replaced by
 * `rcmodN` tokens (done in the iframe, which owns the blob URLs). Each
 * `rcmodN:line:column` is translated to `basename:line:column` using that
 * module's source map. Frames we can't map are left untouched.
 */
export function remapStack(stack: string, tokenToMap: Record<string, RawSourceMap | undefined>): string {
  return stack.replace(/(rcmod\d+):(\d+):(\d+)/g, (whole, token: string, lineStr: string, colStr: string) => {
    const map = tokenToMap[token];
    if (!map) {
      return whole;
    }
    const position = originalPositionFor(map, parseInt(lineStr, 10), parseInt(colStr, 10));
    if (!position) {
      return whole;
    }
    const name = (position.source ?? 'source').split('/').pop();
    return `${name}:${position.line}:${position.column}`;
  });
}
