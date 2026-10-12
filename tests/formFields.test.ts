import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = join(__dirname, '../src/renderer/src');
const UI = join('components', 'ui.tsx');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('form elemanları ortak çerçeveli bileşenlerden gelir', () => {
  it('ui.tsx dışında ham <input>, <select>, <textarea> yok', () => {
    const offenders = sources(RENDERER)
      .filter((f) => relative(RENDERER, f) !== UI)
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .flatMap((line, i) => (/<(input|select|textarea)\b/.test(line) ? [`${relative(RENDERER, f)}:${i + 1}`] : [])),
      );
    expect(offenders).toEqual([]);
  });
});
