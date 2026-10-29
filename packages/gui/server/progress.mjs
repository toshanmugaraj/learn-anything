/* global process */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { HttpError } from './paths.mjs';

const round2 = (n) => Math.round(n * 100) / 100;

export function today(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export function findConcept(state, slug) {
  for (const domain of state.domains) {
    const concept = domain.concepts.find((c) => c.slug === slug);
    if (concept) return concept;
  }
  return null;
}

export function flattenConcepts(state) {
  return state.domains.flatMap((d) =>
    d.concepts.map((c) => ({ slug: c.slug, name: c.name, domain: d.name })),
  );
}

/**
 * Ticking counts as one explanation: unexplored -> in_progress, explain_count + 1,
 * last_explained = today, confidence + 0.1 (cap 1). `ticks` remembers what was added so an
 * untick reverts only that, never progress made through the /learn skills.
 */
export function tickConcept(state, ticks, slug, date) {
  const c = findConcept(state, slug);
  if (!c) throw new HttpError(404, `Unknown concept: ${slug}`);
  if (ticks[slug]) return;
  const confidenceAdded = round2(Math.min(1, c.confidence + 0.1) - c.confidence);
  ticks[slug] = {
    statusFrom: c.status,
    confidenceAdded,
    lastExplainedFrom: c.last_explained,
  };
  if (c.status === 'unexplored') c.status = 'in_progress';
  c.explain_count += 1;
  c.last_explained = date;
  c.confidence = round2(c.confidence + confidenceAdded);
}

export function untickConcept(state, ticks, slug) {
  const c = findConcept(state, slug);
  if (!c) throw new HttpError(404, `Unknown concept: ${slug}`);
  const t = ticks[slug];
  if (!t) return;
  c.explain_count = Math.max(0, c.explain_count - 1);
  c.confidence = Math.max(0, round2(c.confidence - t.confidenceAdded));
  if (c.explain_count === 0) {
    c.last_explained = t.lastExplainedFrom;
    if (t.statusFrom === 'unexplored' && c.status === 'in_progress' && c.practice_count === 0) {
      c.status = 'unexplored';
    }
  }
  delete ticks[slug];
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

/** temp file + rename, so the agent never reads a half-written file. */
export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

let queue = Promise.resolve();

/**
 * Applies a tick/untick to the topic's state.json, then runs render.mjs (validates the file and
 * regenerates knowledge-map.md). If validation fails the original file is restored.
 * Calls are serialized within this process.
 */
export function applyProgress({
  topicDir,
  ticksFile,
  conceptSlug,
  checked,
  renderScript,
  date = today(),
}) {
  const run = queue.then(() => {
    const statePath = join(topicDir, 'state.json');
    if (!existsSync(statePath))
      throw new HttpError(409, 'Topic not found. Run /learn:topic Rust first.');
    const original = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(original);
    const ticks = readJson(ticksFile, {});

    if (checked) tickConcept(state, ticks, conceptSlug, date);
    else untickConcept(state, ticks, conceptSlug);

    writeJsonAtomic(statePath, state);
    if (renderScript) {
      const r = spawnSync(process.execPath, [renderScript, topicDir], { encoding: 'utf-8' });
      if (r.status !== 0) {
        writeFileSync(statePath, original);
        throw new HttpError(500, `state.json failed validation: ${(r.stderr || r.stdout).trim()}`);
      }
    }
    writeJsonAtomic(ticksFile, ticks);
    return { state, ticks };
  });
  queue = run.catch(() => {});
  return run;
}
