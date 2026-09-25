/**
 * Shared by the site generators that turn shipped markdown (SKILL.md,
 * skills-guide.md) into MDX pages.
 */
// Escape MDX footguns outside fenced code blocks and outside inline code spans.
// Walk line-by-line: toggle inFence on ``` lines, then on non-fence lines escape
// bare angle brackets and curly braces that MDX would misparse as JSX.
export function escapeMdxOutsideFences(text) {
  const lines = text.split('\n');
  let inFence = false;
  const result = [];

  for (const line of lines) {
    // Toggle fence state on lines that start a fenced code block (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      result.push(line);
      continue;
    }

    if (inFence) {
      result.push(line);
      continue;
    }

    // Preserve blockquote markers ("> " prefixes) so they render as real
    // blockquotes instead of an escaped literal "&gt;" in the output.
    const bqMatch = line.match(/^(\s{0,3}(?:>\s?)+)(.*)$/);
    const bqPrefix = bqMatch ? bqMatch[1] : '';
    const rest = bqMatch ? bqMatch[2] : line;

    // Outside fences: escape characters inside inline code spans, then outside
    // Split on inline code spans (backtick-delimited), escape only the non-code parts
    const parts = rest.split(/(`[^`]+`)/);
    const escaped = parts.map((part, i) => {
      // Odd indices are backtick-wrapped (inline code) — leave them as-is
      if (i % 2 === 1) return part;
      return part
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\{/g, '&#123;')
        .replace(/\}/g, '&#125;');
    }).join('');
    result.push(bqPrefix + escaped);
  }

  return result.join('\n');
}
