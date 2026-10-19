import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import { ICONS, Icon, IconSearch, ObjectIcon, type IconName } from "../../src/components/icons";

// The app's own icon set (#683): one frame for every icon, so the stroke and the
// grid stay consistent, and an icon is decorative unless it is given a name.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(view: () => JSX.Element): SVGSVGElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(view, host);
  return host.querySelector("svg")!;
}

describe("Icon", () => {
  it("draws every icon of the set in the shared frame", () => {
    for (const name of Object.keys(ICONS) as IconName[]) {
      const svg = mount(() => <Icon name={name} />);
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("stroke-width")).toBe("1.75");
      expect(svg.getAttribute("fill")).toBe("none");
      expect(svg.getAttribute("data-icon")).toBe(name);
      // Has art, and the art is SVG, not HTML elements that happen to share a name.
      expect(svg.children.length).toBeGreaterThan(0);
      for (const c of svg.children) expect(c.namespaceURI).toBe("http://www.w3.org/2000/svg");
      dispose!();
      host!.remove();
    }
  });

  it("is 16px and hidden from assistive tech by default", () => {
    const svg = mount(() => <Icon name="table" />);
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("class")).toBe("icon");
  });

  it("takes a size and extra classes", () => {
    const svg = mount(() => <Icon name="close" size={12} class="eb-ic" />);
    expect(svg.getAttribute("width")).toBe("12");
    expect(svg.getAttribute("height")).toBe("12");
    expect(svg.getAttribute("class")).toBe("icon eb-ic");
  });

  it("becomes an image with a name when given a label", () => {
    const svg = mount(() => <Icon name="lock" label="Solo lectura" />);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Solo lectura");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("bound icons work with and without props", () => {
    expect(mount(() => <IconSearch />).getAttribute("data-icon")).toBe("search");
    dispose!();
    host!.remove();
    expect(mount(() => <IconSearch size={20} />).getAttribute("width")).toBe("20");
  });
});

describe("ObjectIcon", () => {
  it("draws the kind's icon in its colour class", () => {
    const svg = mount(() => <ObjectIcon kind="view" />);
    expect(svg.getAttribute("data-icon")).toBe("view");
    expect(svg.getAttribute("class")).toBe("icon objtree-badge kind-view");
  });

  it("falls back to a neutral mark for an unknown kind", () => {
    const svg = mount(() => <ObjectIcon kind="nonsense" />);
    expect(svg.getAttribute("data-icon")).toBe("help");
    expect(svg.getAttribute("class")).toBe("icon objtree-badge kind-unknown");
  });
});
