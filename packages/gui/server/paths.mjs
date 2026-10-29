import { realpathSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep, basename, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const MAX_BYTES = 1024 * 1024;
export const MAX_RANGE_LINES = 200;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable slug per repo location: "<dir-name>-<8 hex of path hash>". */
export function projectSlug(root) {
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 8);
  return `${slugify(basename(root)) || 'project'}-${hash}`;
}

export function isCargoProject(dir) {
  try {
    return statSync(join(dir, 'Cargo.toml')).isFile();
  } catch {
    return false;
  }
}

/** Lists visible subdirectories of `path` (default: home) for the folder picker. */
export function listDirs(path) {
  let real;
  try {
    real = realpathSync(resolve(path || homedir()));
    if (!statSync(real).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new HttpError(400, 'Not a readable directory');
  }
  let dirents;
  try {
    dirents = readdirSync(real, { withFileTypes: true });
  } catch {
    throw new HttpError(403, 'Cannot read this directory');
  }
  const entries = [];
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue;
    const full = join(real, d.name);
    let isDir = d.isDirectory();
    if (!isDir && d.isSymbolicLink()) {
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) entries.push({ name: d.name, path: full, isCargo: isCargoProject(full) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: real,
    parent: dirname(real) === real ? null : dirname(real),
    isCargo: isCargoProject(real),
    entries,
  };
}

/** Resolves `rel` inside `root`, following symlinks. Returns null if it escapes the root. */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  let realRoot;
  let real;
  try {
    realRoot = realpathSync(root);
    real = realpathSync(resolve(realRoot, rel));
  } catch {
    return null;
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
  return real;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Reads the code the server will show and send to the model. Never trusts model-supplied code,
 * only its file/line pointers. Returns null when the pointer is invalid.
 */
export function readRange(root, file) {
  const real = resolveInside(root, file?.path);
  if (!real) return null;
  let st;
  try {
    st = statSync(real);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_BYTES) return null;
  if (!Number.isInteger(file.startLine) || !Number.isInteger(file.endLine)) return null;
  const lines = readFileSync(real, 'utf-8').split('\n');
  const start = clamp(file.startLine, 1, lines.length);
  const end = clamp(Math.min(file.endLine, start + MAX_RANGE_LINES - 1), start, lines.length);
  return {
    path: relative(realpathSync(root), real),
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    code: lines.slice(start - 1, end).join('\n'),
  };
}

/** Accepts only localhost Host headers, to block DNS-rebinding against the local API. */
export function isAllowedHost(host) {
  if (typeof host !== 'string') return false;
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}
