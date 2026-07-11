import { describe, it, expect } from "vitest";
import { renderMarkdown, escapeHtml } from "../../src/utils/markdown";

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("renderMarkdown blocks", () => {
  it("renders headings by level", () => {
    expect(renderMarkdown("# Title")).toBe("<h1>Title</h1>");
    expect(renderMarkdown("### Sub")).toBe("<h3>Sub</h3>");
  });

  it("renders paragraphs, joining wrapped lines", () => {
    expect(renderMarkdown("one\ntwo")).toBe("<p>one two</p>");
  });

  it("renders unordered and ordered lists", () => {
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("renders a fenced code block, escaping its content", () => {
    const html = renderMarkdown("```\n<b> & 'x'\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("&lt;b&gt; &amp; &#39;x&#39;");
  });
});

describe("renderMarkdown inline", () => {
  it("renders bold, italic and inline code", () => {
    const html = renderMarkdown("**b** _i_ `c`");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<code>c</code>");
  });

  it("links only safe schemes; leaves others as text", () => {
    expect(renderMarkdown("[go](https://a.com)")).toContain(
      '<a href="https://a.com" target="_blank" rel="noopener noreferrer">go</a>',
    );
    const js = renderMarkdown("[x](javascript:alert(1))");
    expect(js).not.toContain("<a ");
    expect(js).toContain("[x](javascript:alert(1))");
  });
});

describe("renderMarkdown safety (no HTML injection)", () => {
  it("escapes raw HTML in the source", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("does not let a code span smuggle a tag", () => {
    const html = renderMarkdown("`<script>`");
    expect(html).toContain("<code>&lt;script&gt;</code>");
    expect(html).not.toContain("<script>");
  });
});
