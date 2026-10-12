// Release notu: önceki tag'den (yoksa tüm geçmişten) bu yana commit mesajlarından İngilizce başlıklı Markdown üretir.
// Kullanım: node scripts/release-notes.ts <tag>  (Node 24 TypeScript'i doğrudan çalıştırır)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface Commit {
  hash: string;
  subject: string;
}

const SECTIONS = [
  { title: 'Features', types: ['feat'] },
  { title: 'Bug Fixes', types: ['fix'] },
] as const;
const OTHER = 'Other Changes';

// Conventional Commits başlığı: tür(kapsam)!: açıklama
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/;

export function buildReleaseNotes(commits: Commit[]): string {
  const groups = new Map<string, string[]>();
  for (const { hash, subject } of commits) {
    const m = CONVENTIONAL.exec(subject.trim());
    const section = m && SECTIONS.find((s) => (s.types as readonly string[]).includes(m[1].toLowerCase()));
    const title = section ? section.title : OTHER;
    const text = section && m ? m[2] : subject.trim();
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title)!.push(`- ${text} (${hash})`);
  }
  // Boş başlıklar yazılmaz.
  return [...SECTIONS.map((s) => s.title), OTHER]
    .filter((t) => groups.has(t))
    .map((t) => `## ${t}\n\n${groups.get(t)!.join('\n')}\n`)
    .join('\n');
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function commitsForTag(tag: string): Commit[] {
  let range = tag;
  try {
    range = `${git(['describe', '--tags', '--abbrev=0', `${tag}^`])}..${tag}`;
  } catch {
    // Önceki tag yok: ilk sürüm, tüm geçmiş.
  }
  const out = git(['log', '--no-merges', '--format=%h%x1f%s', range]);
  return out
    ? out.split('\n').map((line) => {
        const [hash, subject] = line.split('\x1f');
        return { hash, subject };
      })
    : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2];
  if (!tag) {
    console.error('Kullanım: node scripts/release-notes.ts <tag>');
    process.exit(1);
  }
  process.stdout.write(buildReleaseNotes(commitsForTag(tag)) || 'No changes.\n');
}
