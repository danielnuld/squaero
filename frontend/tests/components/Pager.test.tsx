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

function mount(total: number | null, offset = 0, withCount = true, jumps = true) {
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
          onFirst={jumps ? h.onFirst : undefined}
          onPrev={h.onPrev}
          onNext={h.onNext}
          onLast={jumps ? h.onLast : undefined}
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

  // Issue #693: a paged query uses the same footer, without the jumps.
  it("pages a query back and forth without first/last jumps", () => {
    const h = mount(null, 1000, false, false);
    expect(button("Primera página")).toBeUndefined();
    expect(button("Última página")).toBeUndefined();
    button("Página anterior")!.click();
    button("Página siguiente")!.click();
    expect(h.onPrev).toHaveBeenCalledOnce();
    expect(h.onNext).toHaveBeenCalledOnce();
  });
});

describe("Pager page size (A-20, R-38)", () => {
  const mountSized = (paused = false) => {
    const onPageSize = vi.fn();
    const view = pagerView({ offset: 0, rows: 500, size: 500, total: null, more: true, paused });
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(
      () => (
        <Pager
          view={view}
          total={null}
          counting={false}
          paused={paused}
          onPrev={() => {}}
          onNext={() => {}}
          pageSize={500}
          onPageSize={onPageSize}
        />
      ),
      host,
    );
    return onPageSize;
  };
  const combo = () => host!.querySelector<HTMLButtonElement>('[role="combobox"]');

  it("shows the current size and offers 100/500/1000/5000", () => {
    const onPageSize = mountSized();
    expect(combo()!.getAttribute("aria-label")).toBe("Filas por página");
    expect(combo()!.textContent).toContain("500 por página");
    combo()!.click();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual([
      "100 por página",
      "500 por página",
      "1000 por página",
      "5000 por página",
    ]);
    options[3].click();
    expect(onPageSize).toHaveBeenCalledWith(5000);
  });

  it("is held still while edits are pending", () => {
    mountSized(true);
    expect(combo()!.disabled).toBe(true);
  });

  it("is absent without a handler (a query's pager)", () => {
    mount(null);
    expect(host!.querySelector('[role="combobox"]')).toBeNull();
  });
});

describe("Pager page field (R-38)", () => {
  it("goes to the typed page on Enter and snaps back from one that does not exist", () => {
    const goTo = vi.fn();
    const view = pagerView({ offset: 0, rows: 1000, size: 1000, total: 3500, more: true, paused: false });
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <Pager
            view={view}
            total={3500}
            counting={false}
            paused={false}
            onPrev={() => {}}
            onNext={() => {}}
            pageSize={1000}
            onPageSize={() => {}}
            onGoTo={goTo}
          />
        ),
        host!,
      );
    });
    const field = host.querySelector<HTMLInputElement>(".pager-page-input")!;
    expect(field.value).toBe("1");
    expect(host.querySelector(".pager-page")!.textContent).toContain("de 4");
    field.value = "3";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(goTo).toHaveBeenCalledWith(2000);
    field.value = "9";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(field.value).toBe("1");
  });
});
