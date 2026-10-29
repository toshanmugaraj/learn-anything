import hljs from 'highlight.js/lib/core';
import rust from 'highlight.js/lib/languages/rust';
import ini from 'highlight.js/lib/languages/ini';

hljs.registerLanguage('rust', rust);
hljs.registerLanguage('toml', ini);

/** Highlights one line at a time, so multi-line comments and strings lose their context. */
export function highlightLine(line: string, language: string): string {
  return hljs.highlight(line, { language, ignoreIllegals: true }).value;
}
