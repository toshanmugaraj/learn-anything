/* global process, setTimeout, clearTimeout */
import { spawn } from 'node:child_process';

/** Pulls a JSON object out of a model reply (plain, fenced, or surrounded by prose). */
export function extractJson(text) {
  const s = String(text ?? '').trim();
  const candidates = [s];
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try next */
    }
  }
  throw new Error('The model did not return valid JSON');
}

/**
 * Runs the Claude Code CLI headlessly with read-only tools and returns the reply text.
 * The prompt goes over stdin so it can be large.
 */
export function runClaude({
  prompt,
  cwd,
  bin = process.env.CLAUDE_BIN || 'claude',
  timeoutMs = 10 * 60 * 1000,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ['-p', '--output-format', 'json', '--allowedTools', 'Read,Glob,Grep'],
      {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      done(reject, new Error('Claude Code timed out'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      if (e.code === 'ENOENT') {
        done(
          reject,
          new Error(
            `Claude Code CLI ("${bin}") was not found. Install it and run "claude" once to log in.`,
          ),
        );
      } else {
        done(reject, e);
      }
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const tail = (err || out).trim().slice(-500);
        return done(
          reject,
          new Error(`Claude Code exited with code ${code}${tail ? `: ${tail}` : ''}`),
        );
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error)
          return done(reject, new Error(String(parsed.result || 'Claude Code reported an error')));
        done(resolve, String(parsed.result ?? ''));
      } catch {
        done(resolve, out);
      }
    });
    child.stdin.on('error', () => {
      /* child may exit before reading stdin; handled by close/error */
    });
    child.stdin.end(prompt);
  });
}
