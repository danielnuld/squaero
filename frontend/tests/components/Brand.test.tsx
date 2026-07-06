import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { BrandMark, BrandWordmark } from "../../src/components/Brand";

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
  it("BrandMark renders an accessible SVG at the requested size", () => {
    mount(() => <BrandMark size={64} />);
    const svg = host!.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Quaero");
    expect(svg.getAttribute("width")).toBe("64");
    expect(svg.getAttribute("height")).toBe("64");
    // Strokes track the theme via the accent variable, never a hardcoded color.
    expect(host!.innerHTML).toContain("var(--accent)");
    expect(host!.innerHTML).not.toContain("#5b5bd6");
  });

  it("BrandMark defaults to 32px", () => {
    mount(() => <BrandMark />);
    const svg = host!.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
  });

  it("BrandWordmark renders the Quaero text and scales width to height", () => {
    mount(() => <BrandWordmark height={128} />);
    const svg = host!.querySelector("svg")!;
    expect(svg.textContent).toContain("Quaero");
    // 372:128 aspect ratio → at height 128 the width is 372.
    expect(svg.getAttribute("height")).toBe("128");
    expect(svg.getAttribute("width")).toBe("372");
    // Wordmark text uses currentColor so it follows the theme foreground.
    expect(host!.innerHTML).toContain("currentColor");
  });
});
