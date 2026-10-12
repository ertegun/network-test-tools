import { describe, expect, it } from 'vitest';
import { buildReleaseNotes } from '../scripts/release-notes';

describe('buildReleaseNotes', () => {
  it('feat/fix/öneksiz mesajları üç başlıkta birer madde olarak gruplar', () => {
    const notes = buildReleaseNotes([
      { hash: 'a1', subject: 'feat: a' },
      { hash: 'b2', subject: 'fix: b' },
      { hash: 'c3', subject: 'update c' },
    ]);
    expect(notes).toBe('## Features\n\n- a (a1)\n\n## Bug Fixes\n\n- b (b2)\n\n## Other Changes\n\n- update c (c3)\n');
  });

  it('kapsam ve kırıcı değişiklik işaretini tanır, büyük/küçük harfe duyarsızdır', () => {
    const notes = buildReleaseNotes([
      { hash: 'a1', subject: 'feat(scan)!: new scanner' },
      { hash: 'b2', subject: 'Fix: crash on start' },
    ]);
    expect(notes).toContain('## Features\n\n- new scanner (a1)');
    expect(notes).toContain('## Bug Fixes\n\n- crash on start (b2)');
  });

  it('tanınmayan türleri olduğu gibi Other Changes altına koyar, boş başlık yazmaz', () => {
    const notes = buildReleaseNotes([
      { hash: 'a1', subject: 'chore: deps' },
      { hash: 'b2', subject: 'NetKit temel: M1, M2' },
    ]);
    expect(notes).toBe('## Other Changes\n\n- chore: deps (a1)\n- NetKit temel: M1, M2 (b2)\n');
    expect(notes).not.toContain('Features');
    expect(notes).not.toContain('Bug Fixes');
  });

  it('commit yoksa boş döner', () => {
    expect(buildReleaseNotes([])).toBe('');
  });
});
