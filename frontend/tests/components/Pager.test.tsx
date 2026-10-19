import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { Pager } from "../../src/components/Pager";
import { pagerView } from "../../src/utils/pager";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(total: number | null, offset = 0, withCount = true) {
  const h = { onCount: vi.fn(), onFirst: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), onLast: vi.fn() };
  const view = pagerView({ offset, rows: 1000, size: 1000, total, more: true, paused: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <Pager
          view={view}
          total={total}
          counting={false}
          paused={false}
          onFirst={h.onFirst}
          onPrev={h.onPrev}
          onNext={h.onNext}
          onLast={h.onLast}
          onCount={withCount ? h.onCount : undefined}
        />
      ),
      host!,
    );
  });
  return h;
}

const button = (label: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent) === label,
  );

describe("Pager", () => {
  it("shows the rows on screen and offers to count the total", () => {
    const h = mount(null);
    expect(host!.querySelector(".pager-range")?.textContent).toBe("Filas 1–1000");
    button("Contar total")!.click();
    expect(h.onCount).toHaveBeenCalledOnce();
    // The last page cannot be named before the total is known.
    expect(button("Última página")!.disabled).toBe(true);
  });

  it("says of how many once counted, and reaches the last page", () => {
    const h = mount(3500, 1000);
    expect(host!.querySelector(".pager-range")?.textContent).toBe("Filas 1001–2000 de 3500");
    expect(button("Contar total")).toBeUndefined();
    expect(host!.querySelector('[aria-current="page"]')?.textContent).toBe("2 / 4");
    button("Primera página")!.click();
    button("Página anterior")!.click();
    button("Página siguiente")!.click();
    button("Última página")!.click();
    expect([h.onFirst, h.onPrev, h.onNext, h.onLast].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it("offers no count where the engine has none", () => {
    mount(null, 0, false);
    expect(button("Contar total")).toBeUndefined();
  });
});
