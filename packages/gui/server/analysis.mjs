import { readRange, resolveInside, slugify } from './paths.mjs';
import { realpathSync } from 'node:fs';
import { relative } from 'node:path';

export const MAX_FUNCTIONALITIES = 12;

function conceptList(concepts) {
  return concepts.map((c) => `- ${c.slug}: ${c.name} (${c.domain})`).join('\n');
}

export function buildAnalysisPrompt(concepts) {
  return `You are a Rust mentor. Study the Rust project in the current directory (read Cargo.toml, README and the source files).

Reply with ONLY one JSON object, no prose, in this shape:
{
  "purpose": "2-4 sentences: what the project is for",
  "functionalities": [
    {
      "title": "short functionality name",
      "description": "1-2 sentences on what it does",
      "requirements": ["concrete requirement or constraint it satisfies", "..."],
      "files": [{ "path": "src/foo.rs", "startLine": 10, "endLine": 60 }],
      "concepts": ["concept-slug", "..."]
    }
  ]
}

Rules:
- At most ${MAX_FUNCTIONALITIES} functionalities, ordered from the core of the project outward.
- "files" must point to real files in this repo (relative paths) and real line ranges of at most 150 lines that implement the functionality.
- "concepts" must use ONLY slugs from this list, and only concepts that really appear in those lines:
${conceptList(concepts)}
- Be precise; do not invent files or lines.`;
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Validates the model's analysis. Drops bad file pointers and unknown concept slugs. */
export function validateAnalysis(raw, { root, knownSlugs }) {
  if (!raw || typeof raw !== 'object') throw new Error('Analysis is not an object');
  const purpose = str(raw.purpose, 2000);
  if (!purpose) throw new Error('Analysis has no purpose');
  if (!Array.isArray(raw.functionalities)) throw new Error('Analysis has no functionalities');

  const realRoot = realpathSync(root);
  const usedIds = new Set();
  const functionalities = [];
  for (const f of raw.functionalities.slice(0, MAX_FUNCTIONALITIES)) {
    const title = str(f?.title, 200);
    if (!title) continue;
    const files = [];
    for (const file of Array.isArray(f.files) ? f.files : []) {
      const real = resolveInside(root, file?.path);
      if (!real) continue;
      const range = readRange(root, {
        path: relative(realRoot, real),
        startLine: file.startLine,
        endLine: file.endLine,
      });
      if (range)
        files.push({ path: range.path, startLine: range.startLine, endLine: range.endLine });
    }
    if (files.length === 0) continue;
    let id = slugify(title) || `f${functionalities.length + 1}`;
    while (usedIds.has(id)) id += '-2';
    usedIds.add(id);
    functionalities.push({
      id,
      title,
      description: str(f.description, 1000),
      requirements: (Array.isArray(f.requirements) ? f.requirements : [])
        .map((r) => str(r, 500))
        .filter(Boolean)
        .slice(0, 8),
      files,
      concepts: [
        ...new Set((Array.isArray(f.concepts) ? f.concepts : []).filter((s) => knownSlugs.has(s))),
      ],
    });
  }
  if (functionalities.length === 0) throw new Error('Analysis had no usable functionalities');
  return { purpose, functionalities };
}

export function buildExplainPrompt(functionality, snippets, concepts) {
  const code = snippets
    .map((s) => {
      const numbered = s.code
        .split('\n')
        .map((line, i) => `${String(s.startLine + i).padStart(4)}  ${line}`)
        .join('\n');
      return `// ${s.path} (lines ${s.startLine}-${s.endLine})\n${numbered}`;
    })
    .join('\n\n');
  return `You are a Rust mentor teaching a learner using real code from their project.

Functionality: ${functionality.title}
${functionality.description}

Code (line numbers on the left):
${code}

Explain which Rust concepts this code uses and how. Reply with ONLY one JSON object, no prose:
{
  "summary": "2-3 sentences on how the code works overall",
  "concepts": [
    {
      "slug": "concept-slug",
      "note": "Markdown, 3-6 sentences: the precise rule, then exactly how it shows up in THIS code (quote the identifiers), then the usual pitfall.",
      "file": "path of the file from above",
      "lines": [startLine, endLine]
    }
  ]
}

Rules:
- Use ONLY these concept slugs, and only concepts that truly appear in the code above:
${conceptList(concepts)}
- "file" and "lines" are optional but, when given, must point inside the code above.
- Be accurate; do not describe behaviour the code does not have.`;
}

/** Validates the explanation; resolves concept names from the knowledge map. */
export function validateExplanation(raw, conceptsBySlug, snippets) {
  if (!raw || typeof raw !== 'object') throw new Error('Explanation is not an object');
  const summary = str(raw.summary, 2000);
  const seen = new Set();
  const concepts = [];
  for (const c of Array.isArray(raw.concepts) ? raw.concepts : []) {
    const known = conceptsBySlug.get(c?.slug);
    if (!known || seen.has(c.slug)) continue;
    const note = str(c.note, 3000);
    if (!note) continue;
    seen.add(c.slug);
    let file;
    let lines;
    const snip = snippets.find((s) => s.path === c.file);
    if (
      snip &&
      Array.isArray(c.lines) &&
      c.lines.length === 2 &&
      c.lines.every(Number.isInteger) &&
      c.lines[0] >= snip.startLine &&
      c.lines[1] <= snip.endLine &&
      c.lines[0] <= c.lines[1]
    ) {
      file = snip.path;
      lines = [c.lines[0], c.lines[1]];
    }
    concepts.push({ slug: c.slug, name: known.name, domain: known.domain, note, file, lines });
  }
  if (concepts.length === 0) throw new Error('Explanation had no usable concepts');
  return { summary, concepts };
}
