import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/index.mjs';
import { makeFakeClaude, makeRustProject, makeState, tmp } from './helpers';

let server: ReturnType<typeof createApp>;
let base = '';
let learnDir = '';
let projectRoot = '';

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: method === 'GET' ? headers : { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

beforeAll(async () => {
  const dir = tmp();
  learnDir = join(dir, '.learn');
  mkdirSync(join(learnDir, 'topics', 'rust'), { recursive: true });
  writeFileSync(join(learnDir, 'topics', 'rust', 'state.json'), JSON.stringify(makeState()));
  projectRoot = makeRustProject().root;
  server = createApp({
    learnDir,
    claudeBin: makeFakeClaude(dir),
    renderScript: null,
    distDir: join(dir, 'no-dist'),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  server.closeAllConnections();
});

describe('API', () => {
  it('rejects non-JSON writes', async () => {
    const res = await fetch(base + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('rejects folders without Cargo.toml', async () => {
    const r = await call('POST', '/api/projects', { path: tmp() });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Cargo\.toml/);
  });

  it('analyzes a project, serves real code, explains it, and records ticks', async () => {
    const opened = await call('POST', '/api/projects', { path: projectRoot });
    expect(opened.status).toBe(200);
    const slug = opened.body.slug as string;

    const done = await until(
      () => call('GET', `/api/projects/${slug}`),
      (r) => r.body.status !== 'running',
    );
    expect(done.body.status).toBe('done');
    const { analysis } = done.body;
    expect(analysis.functionalities).toHaveLength(1); // "Ghost" has no real file
    const f = analysis.functionalities[0];
    expect(f.files).toEqual([{ path: 'src/main.rs', startLine: 1, endLine: 5 }]); // escaping + symlink dropped
    expect(f.concepts).toEqual(['ownership', 'borrowing-references']);

    const first = await call('GET', `/api/projects/${slug}/functionalities/${f.id}`);
    expect(first.body.files[0].code).toContain('String::from("hi")'); // read from disk, not the model
    expect(first.body.explainStatus).toBe('idle');

    await call('POST', `/api/projects/${slug}/functionalities/${f.id}/explain`, {});
    const explained = await until(
      () => call('GET', `/api/projects/${slug}/functionalities/${f.id}`),
      (r) => r.body.explainStatus !== 'running',
    );
    expect(explained.body.explainStatus).toBe('done');
    expect(explained.body.explanation.concepts).toEqual([
      expect.objectContaining({
        slug: 'borrowing-references',
        name: 'borrowing-references',
        lines: [3, 3],
      }),
    ]);

    const ticked = await call('PUT', '/api/progress', {
      project: slug,
      conceptSlug: 'borrowing-references',
      checked: true,
    });
    expect(ticked.status).toBe(200);
    expect(ticked.body.ticks).toEqual(['borrowing-references']);
    const state = JSON.parse(readFileSync(join(learnDir, 'topics', 'rust', 'state.json'), 'utf-8'));
    expect(state.domains[0].concepts[1]).toMatchObject({ status: 'in_progress', explain_count: 1 });

    const graph = await call('GET', '/api/graph');
    expect(graph.body.domains[0].concepts[1].status).toBe('in_progress');

    const unticked = await call('PUT', '/api/progress', {
      project: slug,
      conceptSlug: 'borrowing-references',
      checked: false,
    });
    expect(unticked.body.ticks).toEqual([]);
    expect(unticked.body.graph.domains[0].concepts[1].status).toBe('unexplored');
  });

  it('validates progress input and project ids', async () => {
    expect((await call('PUT', '/api/progress', { project: 'x' })).status).toBe(400);
    expect((await call('GET', '/api/projects/..%2F..')).status).toBe(400);
    expect((await call('GET', '/api/projects/missing-1234')).status).toBe(404);
  });

  it('refuses foreign Host headers', async () => {
    const { status } = await new Promise<{ status: number }>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const req = request(
          base + '/api/graph',
          { headers: { Host: 'evil.example.com' } },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode ?? 0 });
          },
        );
        req.on('error', reject);
        req.end();
      });
    });
    expect(status).toBe(403);
  });
});
