// Minimal, SAFE Markdown -> HTML for notebook Markdown cells (issue #262). There
// is no Markdown dependency in the bundle, and no sanitizer, so this escapes ALL
// HTML in the source first and only ever emits a small, fixed set of tags —
// headings, paragraphs, lists, code, emphasis and http(s)/mailto links. It is a
// pragmatic subset (enough to narrate an analysis), not a full CommonMark parser.
// Pure and unit-tested.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape the five HTML-significant characters. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Inline formatting, applied to already-HTML-escaped text so user markup can
// never inject tags. Order matters: code spans first (their content is opaque),
// then links, then bold before italic.
function inline(escaped: string): string {
  let s = escaped;
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, url: string) => {
    // Only safe schemes become links; anything else is left as literal text.
    if (/^(https?:\/\/|mailto:)/i.test(url)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    return whole;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  return s;
}

const isFence = (l: string) => /^```/.test(l);
const headingOf = (l: string) => /^(#{1,6})\s+(.*)$/.exec(l);
const isListItem = (l: string) => /^\s*([-*]|\d+\.)\s+/.test(l);

/** Render Markdown to a safe HTML string. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let fenceOpen = false;
  let fence: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      if (!fenceOpen) {
        fenceOpen = true;
        fence = [];
      } else {
        out.push(`<pre class="nb-md-code"><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fenceOpen = false;
      }
      i++;
      continue;
    }
    if (fenceOpen) {
      fence.push(line);
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const h = headingOf(line);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(escapeHtml(h[2]))}</h${lvl}>`);
      i++;
      continue;
    }

    if (isListItem(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i])) {
        const m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        items.push(`<li>${inline(escapeHtml(m ? m[1] : ""))}</li>`);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    // Paragraph: gather consecutive lines until a blank/special line.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isFence(lines[i]) &&
      !headingOf(lines[i]) &&
      !isListItem(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
  }

  if (fenceOpen) {
    out.push(`<pre class="nb-md-code"><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  }
  return out.join("\n");
}
