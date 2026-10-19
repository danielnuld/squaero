import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { BrandMark, BrandWordmark, markStrokes } from "../../src/components/Brand";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(node: () => any) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(node, host!);
  });
}

describe("Brand", () => {
  it("BrandMark is decorative by default", () => {
    mount(() => <BrandMark size={64} />);
    const svg = host!.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.hasAttribute("role")).toBe(false);
    expect(svg.getAttribute("width")).toBe("64");
    expect(svg.getAttribute("height")).toBe("64");
  });

  it("BrandMark with a label is an accessible image", () => {
    mount(() => <BrandMark label="Squaero" />);
    const svg = host!.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Squaero");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);
    expect(svg.getAttribute("width")).toBe("32"); // default size
  });

  it("BrandMark follows the theme: ring in --text, prompt and tail in --accent", () => {
    mount(() => <BrandMark size={64} />);
    expect(host!.querySelector("circle")!.getAttribute("stroke")).toBe("var(--text)");
    const paths = [...host!.querySelectorAll("path")];
    expect(paths).toHaveLength(2);
    for (const p of paths) expect(p.getAttribute("stroke")).toBe("var(--accent)");
    expect(host!.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("markStrokes thickens the strokes at 32px and below", () => {
    expect(markStrokes(16)).toEqual({ ring: 18, prompt: 14 });
    expect(markStrokes(32)).toEqual({ ring: 18, prompt: 14 });
    expect(markStrokes(33)).toEqual({ ring: 14, prompt: 10 });
    expect(markStrokes(512)).toEqual({ ring: 14, prompt: 10 });
  });

  it("BrandMark applies the optical size to its strokes", () => {
    mount(() => <BrandMark size={16} />);
    expect(host!.querySelector("circle")!.getAttribute("stroke-width")).toBe("18");
  });

  it("BrandWordmark renders the Squaero text and scales width to height", () => {
    mount(() => <BrandWordmark height={128} />);
    const svg = host!.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Squaero");
    expect(svg.textContent).toContain("Squaero");
    // 354:128 aspect ratio (Geist wordmark, issue #679).
    expect(svg.getAttribute("height")).toBe("128");
    expect(svg.getAttribute("width")).toBe("354");
    const text = svg.querySelector("text")!;
    expect(text.getAttribute("fill")).toBe("var(--text)");
    expect(text.getAttribute("font-family")).toMatch(/^.Geist/);
  });
});
