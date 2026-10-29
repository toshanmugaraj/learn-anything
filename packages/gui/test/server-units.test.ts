import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isAllowedHost,
  listDirs,
  readRange,
  resolveInside,
  projectSlug,
} from '../server/paths.mjs';
import { extractJson } from '../server/claude.mjs';
import { validateAnalysis, validateExplanation } from '../server/analysis.mjs';
import { applyProgress, tickConcept, untickConcept, findConcept } from '../server/progress.mjs';
import { makeRustProject, makeState, tmp } from './helpers';

describe('paths', () => {
  it('rejects paths that escape the repo, including via symlinks', () => {
    const { root } = makeRustProject();
    expect(resolveInside(root, 'src/main.rs')).toBeTruthy();
    expect(resolveInside(root, '../secret.txt')).toBeNull();
    expect(resolveInside(root, 'src/link.rs')).toBeNull();
    expect(resolveInside(root, '/etc/passwd')).toBeNull();
    expect(resolveInside(root, 'a\0b')).toBeNull();
  });

  it('reads a clamped line range and refuses bad pointers', () => {
    const { root } = makeRustProject();
    const r = readRange(root, { path: 'src/main.rs', startLine: 2, endLine: 999 });
    expect(r).toMatchObject({ path: 'src/main.rs', startLine: 2, endLine: 5, totalLines: 5 });
    expect(r!.code.split('\n')[0]).toContain('String::from');
    expect(readRange(root, { path: 'src/main.rs', startLine: 'x', endLine: 2 })).toBeNull();
    expect(readRange(root, { path: '../secret.txt', startLine: 1, endLine: 1 })).toBeNull();
  });

  it('lists only visible directories and flags Cargo projects', () => {
    const { base, root } = makeRustProject();
    mkdirSync(join(base, '.hidden'));
    const listing = listDirs(base);
    expect(listing.entries.map((e: { name: string }) => e.name)).toEqual(['demo-app']);
    expect(listing.entries[0].isCargo).toBe(true);
    expect(listDirs(root).isCargo).toBe(true);
    expect(() => listDirs(join(base, 'nope'))).toThrow(/readable/);
  });

  it('only allows localhost hosts', () => {
    expect(isAllowedHost('127.0.0.1:24287')).toBe(true);
    expect(isAllowedHost('localhost:5173')).toBe(true);
    expect(isAllowedHost('evil.example.com')).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
  });

  it('gives stable slugs per path', () => {
    expect(projectSlug('/a/My App')).toBe(projectSlug('/a/My App'));
    expect(projectSlug('/a/My App')).toMatch(/^my-app-[0-9a-f]{8}$/);
    expect(projectSlug('/a/My App')).not.toBe(projectSlug('/b/My App'));
  });
});

describe('extractJson', () => {
  it('handles plain, fenced and prose-wrapped JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! Here you go: {"a":3} Hope it helps.')).toEqual({ a: 3 });
    expect(() => extractJson('no json here')).toThrow(/valid JSON/);
  });
});

describe('validateAnalysis', () => {
  const known = new Set(['ownership', 'borrowing-references']);

  it('drops escaping files, unusable functionalities and unknown concepts', () => {
    const { root } = makeRustProject();
    const out = validateAnalysis(
      {
        purpose: 'p',
        functionalities: [
          {
            title: 'Greeting',
            files: [
              { path: 'src/main.rs', startLine: 1, endLine: 3 },
              { path: '../secret.txt', startLine: 1, endLine: 1 },
            ],
            concepts: ['ownership', 'nope'],
          },
          { title: 'No files', files: [{ path: '../secret.txt', startLine: 1, endLine: 1 }] },
        ],
      },
      { root, knownSlugs: known },
    );
    expect(out.functionalities).toHaveLength(1);
    expect(out.functionalities[0]).toMatchObject({ id: 'greeting', concepts: ['ownership'] });
    expect(out.functionalities[0].files).toEqual([
      { path: 'src/main.rs', startLine: 1, endLine: 3 },
    ]);
  });

  it('rejects an analysis with no purpose or nothing usable', () => {
    const { root } = makeRustProject();
    expect(() => validateAnalysis({ functionalities: [] }, { root, knownSlugs: known })).toThrow(
      /purpose/,
    );
    expect(() =>
      validateAnalysis({ purpose: 'p', functionalities: [] }, { root, knownSlugs: known }),
    ).toThrow(/usable/);
  });
});

describe('validateExplanation', () => {
  const bySlug = new Map([
    ['ownership', { slug: 'ownership', name: 'Ownership', domain: 'Ownership & Memory' }],
  ]);
  const snippets = [{ path: 'src/main.rs', startLine: 1, endLine: 5 }];

  it('keeps known concepts and valid line pointers only', () => {
    const out = validateExplanation(
      {
        summary: 's',
        concepts: [
          { slug: 'ownership', note: 'n', file: 'src/main.rs', lines: [2, 3] },
          { slug: 'ownership', note: 'dup' },
          { slug: 'other', note: 'x' },
        ],
      },
      bySlug,
      snippets,
    );
    expect(out.concepts).toEqual([
      {
        slug: 'ownership',
        name: 'Ownership',
        domain: 'Ownership & Memory',
        note: 'n',
        file: 'src/main.rs',
        lines: [2, 3],
      },
    ]);
    const outside = validateExplanation(
      { concepts: [{ slug: 'ownership', note: 'n', file: 'src/main.rs', lines: [2, 99] }] },
      bySlug,
      snippets,
    );
    expect(outside.concepts[0].lines).toBeUndefined();
  });
});

describe('tick / untick', () => {
  it('ticking adds an explanation; unticking reverts only that', () => {
    const state = makeState();
    const ticks: Record<string, unknown> = {};
    tickConcept(state, ticks, 'ownership', '2026-10-30');
    expect(findConcept(state, 'ownership')).toMatchObject({
      status: 'in_progress',
      explain_count: 1,
      last_explained: '2026-10-30',
      confidence: 0.1,
    });
    tickConcept(state, ticks, 'ownership', '2026-10-31'); // idempotent
    expect(findConcept(state, 'ownership').explain_count).toBe(1);

    untickConcept(state, ticks, 'ownership');
    expect(findConcept(state, 'ownership')).toMatchObject({
      status: 'unexplored',
      explain_count: 0,
      last_explained: null,
      confidence: 0,
    });
  });

  it('keeps progress made elsewhere when unticking', () => {
    const state = makeState();
    const c = findConcept(state, 'ownership');
    Object.assign(c, {
      status: 'needs_practice',
      confidence: 0.35,
      explain_count: 2,
      practice_count: 1,
      last_explained: '2026-10-01',
    });
    const ticks: Record<string, unknown> = {};
    tickConcept(state, ticks, 'ownership', '2026-10-30');
    expect(c).toMatchObject({ status: 'needs_practice', explain_count: 3, confidence: 0.45 });
    untickConcept(state, ticks, 'ownership');
    expect(c).toMatchObject({ status: 'needs_practice', explain_count: 2, confidence: 0.35 });
  });

  it('caps confidence at 1 and rejects unknown concepts', () => {
    const state = makeState();
    findConcept(state, 'ownership').confidence = 0.95;
    const ticks: Record<string, { confidenceAdded: number }> = {};
    tickConcept(state, ticks, 'ownership', '2026-10-30');
    expect(findConcept(state, 'ownership').confidence).toBe(1);
    expect(ticks.ownership.confidenceAdded).toBe(0.05);
    expect(() => tickConcept(state, ticks, 'nope', '2026-10-30')).toThrow(/Unknown concept/);
  });
});

describe('applyProgress', () => {
  it('writes state.json and the ticks sidecar, and restores state when validation fails', async () => {
    const dir = tmp();
    const topicDir = join(dir, 'topics', 'rust');
    mkdirSync(topicDir, { recursive: true });
    const statePath = join(topicDir, 'state.json');
    writeFileSync(statePath, JSON.stringify(makeState()));
    const ticksFile = join(dir, 'projects', 'p', 'ticks.json');

    await applyProgress({
      topicDir,
      ticksFile,
      conceptSlug: 'ownership',
      checked: true,
      renderScript: null,
      date: '2026-10-30',
    });
    expect(JSON.parse(readFileSync(statePath, 'utf-8')).domains[0].concepts[0].explain_count).toBe(
      1,
    );
    expect(Object.keys(JSON.parse(readFileSync(ticksFile, 'utf-8')))).toEqual(['ownership']);

    const failing = join(dir, 'fail.mjs');
    writeFileSync(failing, 'console.error("bad schema"); process.exit(1);');
    const before = readFileSync(statePath, 'utf-8');
    await expect(
      applyProgress({
        topicDir,
        ticksFile,
        conceptSlug: 'structs-methods',
        checked: true,
        renderScript: failing,
      }),
    ).rejects.toThrow(/failed validation: bad schema/);
    expect(readFileSync(statePath, 'utf-8')).toBe(before);
    expect(Object.keys(JSON.parse(readFileSync(ticksFile, 'utf-8')))).toEqual(['ownership']);
  });
});
