# Learn Anything GUI

Learn Rust from a real project, in the browser.

Pick a Rust project on your machine. The app shows its **Purpose** and **Functionalities & Requirements**. Click a functionality to see its real code in the right panel, with the Rust concepts in it explained. Tick a concept and it is added to your knowledge graph (`.learn/topics/rust/state.json`, the same file the `/learn` skills use).

## Requirements

- Node 20+
- The [Claude Code CLI](https://claude.com/claude-code) installed and logged in (`claude` on your PATH). The app runs `claude -p` with read-only tools (`Read`, `Glob`, `Grep`) inside the project folder to analyze it. No API key is needed.
- A Rust topic created with `/learn:topic Rust` in this repo (the concepts you tick must exist in `.learn/topics/rust/state.json`).

## Development

```bash
pnpm -F learn-anything-gui dev      # Vite on http://127.0.0.1:24288, API on 24287
pnpm -F learn-anything-gui build    # build the UI into dist/
pnpm -F learn-anything-gui start    # serve dist/ + API on http://127.0.0.1:24287
pnpm -F learn-anything-gui test
pnpm -F learn-anything-gui typecheck
```

Environment variables: `PORT`, `LEARN_DIR` (default: `<repo>/.learn`), `TOPIC` (default: `rust`), `CLAUDE_BIN` (default: `claude`), `RENDER_SCRIPT` (default: the `learn-anything-topic` skill's `render.mjs`).

## How it works

- `server/` is a small `node:http` API bound to `127.0.0.1` (it rejects non-localhost `Host` headers and non-JSON writes).
- Analysis results are cached in `.learn/projects/<project>/` (never inside your repo). The server reads the code itself from the line ranges the model points to, and rejects paths that escape the project root.
- Ticking a concept counts as one explanation: `unexplored` becomes `in_progress`, `explain_count` +1, `last_explained` = today, `confidence` +0.1. Unticking reverts only what the GUI added. After each write the skill's `render.mjs` validates `state.json` and regenerates `knowledge-map.md`; on failure the file is restored.
- The knowledge graph tab updates live when `state.json` changes, including from terminal `/learn` sessions.
