#!/usr/bin/env node
/* global process, URL, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, console */
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, statSync, watch } from 'node:fs';
import { join, extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import {
  HttpError,
  isAllowedHost,
  isCargoProject,
  listDirs,
  projectSlug,
  readRange,
} from './paths.mjs';
import { extractJson, runClaude } from './claude.mjs';
import {
  buildAnalysisPrompt,
  buildExplainPrompt,
  validateAnalysis,
  validateExplanation,
} from './analysis.mjs';
import { applyProgress, flattenConcepts, readJson, writeJsonAtomic } from './progress.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export function createApp(options = {}) {
  const learnDir = options.learnDir || process.env.LEARN_DIR || join(REPO_ROOT, '.learn');
  const topic = options.topic || process.env.TOPIC || 'rust';
  const topicDir = join(learnDir, 'topics', topic);
  const distDir = options.distDir || join(__dirname, '..', 'dist');
  const claudeBin = options.claudeBin || process.env.CLAUDE_BIN || 'claude';
  const renderScript =
    options.renderScript !== undefined
      ? options.renderScript
      : process.env.RENDER_SCRIPT ||
        [
          join(REPO_ROOT, '.claude', 'skills', 'learn-anything-topic', 'scripts', 'render.mjs'),
        ].find(existsSync) ||
        null;

  const analysisJobs = new Map(); // slug -> { running, error }
  const explainJobs = new Map(); // `${slug}/${fid}` -> { running, error }

  const projectDir = (slug) => join(learnDir, 'projects', slug);
  const statePath = () => join(topicDir, 'state.json');

  function readState() {
    const state = readJson(statePath());
    if (!state)
      throw new HttpError(409, `Topic "${topic}" not found. Run /learn:topic ${topic} first.`);
    return state;
  }

  function loadProject(slug) {
    if (!SLUG_RE.test(slug)) throw new HttpError(400, 'Invalid project id');
    const project = readJson(join(projectDir(slug), 'project.json'));
    if (!project) throw new HttpError(404, 'Project not found');
    return project;
  }

  function projectPayload(project) {
    const dir = projectDir(project.slug);
    const analysis = readJson(join(dir, 'analysis.json'));
    const job = analysisJobs.get(project.slug);
    return {
      slug: project.slug,
      name: project.name,
      path: project.path,
      status: job?.running ? 'running' : analysis ? 'done' : job?.error ? 'error' : 'idle',
      error: job?.error ?? null,
      analysis,
      ticks: Object.keys(readJson(join(dir, 'ticks.json'), {})),
    };
  }

  function startAnalysis(project) {
    const state = readState();
    const concepts = flattenConcepts(state);
    const knownSlugs = new Set(concepts.map((c) => c.slug));
    analysisJobs.set(project.slug, { running: true, error: null });
    runClaude({ prompt: buildAnalysisPrompt(concepts), cwd: project.path, bin: claudeBin })
      .then((text) => validateAnalysis(extractJson(text), { root: project.path, knownSlugs }))
      .then((analysis) => {
        const dir = projectDir(project.slug);
        rmSync(join(dir, 'explanations'), { recursive: true, force: true });
        writeJsonAtomic(join(dir, 'analysis.json'), {
          ...analysis,
          analyzedAt: new Date().toISOString(),
        });
        analysisJobs.set(project.slug, { running: false, error: null });
      })
      .catch((err) => {
        analysisJobs.set(project.slug, { running: false, error: err.message });
      });
  }

  function loadFunctionality(project, fid) {
    if (!SLUG_RE.test(fid)) throw new HttpError(400, 'Invalid functionality id');
    const analysis = readJson(join(projectDir(project.slug), 'analysis.json'));
    const functionality = analysis?.functionalities.find((f) => f.id === fid);
    if (!functionality) throw new HttpError(404, 'Functionality not found');
    return functionality;
  }

  function snippetsFor(project, functionality) {
    return functionality.files
      .map((f) => readRange(project.path, f))
      .filter(Boolean)
      .map((s) => ({ ...s, language: s.path.endsWith('.rs') ? 'rust' : 'toml' }));
  }

  function functionalityPayload(project, fid) {
    const functionality = loadFunctionality(project, fid);
    const key = `${project.slug}/${fid}`;
    const job = explainJobs.get(key);
    const explanation = readJson(join(projectDir(project.slug), 'explanations', `${fid}.json`));
    return {
      functionality,
      files: snippetsFor(project, functionality),
      explanation,
      explainStatus: job?.running
        ? 'running'
        : explanation
          ? 'done'
          : job?.error
            ? 'error'
            : 'idle',
      explainError: job?.error ?? null,
    };
  }

  function startExplain(project, fid) {
    const functionality = loadFunctionality(project, fid);
    const snippets = snippetsFor(project, functionality);
    if (snippets.length === 0)
      throw new HttpError(
        410,
        'The source files for this functionality changed or are gone. Re-analyze the project.',
      );
    const key = `${project.slug}/${fid}`;
    if (explainJobs.get(key)?.running) return;
    const concepts = flattenConcepts(readState());
    const bySlug = new Map(concepts.map((c) => [c.slug, c]));
    explainJobs.set(key, { running: true, error: null });
    runClaude({
      prompt: buildExplainPrompt(functionality, snippets, concepts),
      cwd: project.path,
      bin: claudeBin,
    })
      .then((text) => validateExplanation(extractJson(text), bySlug, snippets))
      .then((explanation) => {
        writeJsonAtomic(join(projectDir(project.slug), 'explanations', `${fid}.json`), explanation);
        explainJobs.set(key, { running: false, error: null });
      })
      .catch((err) => explainJobs.set(key, { running: false, error: err.message }));
  }

  function graphPayload() {
    const state = readState();
    return {
      topic: state.topic,
      slug: state.slug,
      domains: state.domains.map((d) => ({
        name: d.name,
        slug: d.slug,
        concepts: d.concepts.map((c) => ({
          name: c.name,
          slug: c.slug,
          status: c.status,
          confidence: c.confidence,
          explain_count: c.explain_count,
        })),
      })),
    };
  }

  /* ---------------- SSE ---------------- */
  const sseClients = new Set();
  let watcher = null;
  let debounce = null;
  let heartbeat = null;

  function startWatcher() {
    if (watcher || !existsSync(topicDir)) return;
    try {
      watcher = watch(topicDir, (_event, filename) => {
        if (filename && filename !== 'state.json') return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          for (const c of sseClients) c.write('event: graph\ndata: changed\n\n');
        }, 150);
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
    heartbeat ??= setInterval(() => {
      for (const c of sseClients) c.write(': ping\n\n');
    }, 25000);
  }

  function stopWatcher() {
    watcher?.close();
    watcher = null;
    clearTimeout(debounce);
    clearInterval(heartbeat);
    heartbeat = null;
    for (const c of sseClients) c.end();
    sseClients.clear();
  }

  /* ---------------- static ---------------- */
  function serveStatic(res, pathname) {
    if (!existsSync(distDir)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(
        'UI not built. Run "pnpm -F learn-anything-gui build" or use "pnpm -F learn-anything-gui dev".',
      );
    }
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      rel = '/';
    }
    let file = resolve(distDir, '.' + (rel === '/' ? '/index.html' : rel));
    if (file !== distDir && !file.startsWith(distDir + sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(rel)) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      file = join(distDir, 'index.html'); // SPA fallback
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    });
    res.end(readFileSync(file));
  }

  /* ---------------- routing ---------------- */
  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (pathname === '/api/fs' && method === 'GET') {
      return json(res, listDirs(url.searchParams.get('path') || ''));
    }

    if (pathname === '/api/projects' && method === 'POST') {
      const body = await readBody(req);
      if (typeof body.path !== 'string' || !body.path) throw new HttpError(400, 'path is required');
      let root;
      try {
        root = realpathSync(resolve(body.path));
      } catch {
        throw new HttpError(400, 'Folder not found');
      }
      if (!isCargoProject(root))
        throw new HttpError(400, 'No Cargo.toml in this folder. Pick the root of a Rust project.');
      const slug = projectSlug(root);
      const project = { slug, name: root.split(sep).pop(), path: root };
      writeJsonAtomic(join(projectDir(slug), 'project.json'), project);
      const hasAnalysis = existsSync(join(projectDir(slug), 'analysis.json'));
      if (!analysisJobs.get(slug)?.running && (body.refresh === true || !hasAnalysis))
        startAnalysis(project);
      return json(res, projectPayload(project));
    }

    let m = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (m && method === 'GET') return json(res, projectPayload(loadProject(m[1])));

    m = pathname.match(/^\/api\/projects\/([^/]+)\/functionalities\/([^/]+)$/);
    if (m && method === 'GET') return json(res, functionalityPayload(loadProject(m[1]), m[2]));

    m = pathname.match(/^\/api\/projects\/([^/]+)\/functionalities\/([^/]+)\/explain$/);
    if (m && method === 'POST') {
      const project = loadProject(m[1]);
      const hasExplanation = existsSync(
        join(projectDir(project.slug), 'explanations', `${m[2]}.json`),
      );
      const body = await readBody(req);
      if (!hasExplanation || body.refresh === true) startExplain(project, m[2]);
      return json(res, functionalityPayload(project, m[2]));
    }

    if (pathname === '/api/progress' && method === 'PUT') {
      const body = await readBody(req);
      if (
        typeof body.project !== 'string' ||
        typeof body.conceptSlug !== 'string' ||
        typeof body.checked !== 'boolean'
      ) {
        throw new HttpError(400, 'project, conceptSlug and checked are required');
      }
      const project = loadProject(body.project);
      await applyProgress({
        topicDir,
        ticksFile: join(projectDir(project.slug), 'ticks.json'),
        conceptSlug: body.conceptSlug,
        checked: body.checked,
        renderScript,
      });
      return json(res, { ticks: projectPayload(project).ticks, graph: graphPayload() });
    }

    if (pathname === '/api/graph' && method === 'GET') return json(res, graphPayload());

    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: connected\n\n');
      sseClients.add(res);
      startWatcher();
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    return serveStatic(res, pathname);
  }

  const server = createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host)) throw new HttpError(403, 'Forbidden host');
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
        !String(req.headers['content-type'] || '').includes('application/json')
      ) {
        throw new HttpError(415, 'Content-Type must be application/json');
      }
      await route(req, res, new URL(req.url, `http://${req.headers.host}`));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      json(res, { error: status === 500 ? 'Internal server error' : err.message }, status);
    }
  });
  server.on('close', stopWatcher);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = parseInt(process.env.PORT || '24287', 10);
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`Learn Anything GUI API on http://127.0.0.1:${port}`);
  });
}
