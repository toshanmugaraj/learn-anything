import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tmp(prefix = 'gui-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function concept(slug: string, extra: Record<string, unknown> = {}) {
  return {
    name: slug,
    slug,
    status: 'unexplored',
    confidence: 0,
    practice_count: 0,
    explain_count: 0,
    last_explained: null,
    last_practiced: null,
    details: [],
    ...extra,
  };
}

export function makeState() {
  return {
    version: 1,
    topic: 'Rust',
    slug: 'rust',
    created: '2026-10-29',
    domains: [
      {
        name: 'Ownership & Memory',
        slug: 'ownership-memory',
        concepts: [concept('ownership'), concept('borrowing-references')],
      },
      { name: 'Custom Types', slug: 'custom-types', concepts: [concept('structs-methods')] },
    ],
  };
}

export const MAIN_RS = [
  'fn main() {',
  '    let s = String::from("hi");',
  '    let r = &s;',
  '    println!("{r}");',
  '}',
].join('\n');

/** A tiny Rust project on disk, plus a secret file outside it. */
export function makeRustProject() {
  const base = tmp('gui-proj-');
  const root = join(base, 'demo-app');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "demo-app"\nversion = "0.1.0"\n');
  writeFileSync(join(root, 'src', 'main.rs'), MAIN_RS);
  writeFileSync(join(base, 'secret.txt'), 'top secret');
  symlinkSync(join(base, 'secret.txt'), join(root, 'src', 'link.rs'));
  return { base, root };
}

/** A stand-in for the `claude` CLI: answers analysis and explain prompts with canned JSON. */
export function makeFakeClaude(dir: string) {
  const analysis = {
    purpose: 'A demo app that prints a greeting.',
    functionalities: [
      {
        title: 'Print greeting',
        description: 'Builds a String and prints a borrow of it.',
        requirements: ['Must not move the String'],
        files: [
          { path: 'src/main.rs', startLine: 1, endLine: 5 },
          { path: '../secret.txt', startLine: 1, endLine: 1 },
          { path: 'src/link.rs', startLine: 1, endLine: 1 },
        ],
        concepts: ['ownership', 'borrowing-references', 'not-a-real-concept'],
      },
      {
        title: 'Ghost',
        description: '',
        requirements: [],
        files: [{ path: 'src/missing.rs', startLine: 1, endLine: 2 }],
        concepts: [],
      },
    ],
  };
  const explanation = {
    summary: 'Creates a String and borrows it.',
    concepts: [
      {
        slug: 'borrowing-references',
        note: '`&s` borrows `s`.',
        file: 'src/main.rs',
        lines: [3, 3],
      },
      { slug: 'made-up', note: 'ignored' },
    ],
  };
  const script = `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const reply = input.includes('Functionality:') ? ${JSON.stringify(explanation)} : ${JSON.stringify(analysis)};
  process.stdout.write(JSON.stringify({ is_error: false, result: '\`\`\`json\\n' + JSON.stringify(reply) + '\\n\`\`\`' }));
});
`;
  const path = join(dir, 'fake-claude.mjs');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}
