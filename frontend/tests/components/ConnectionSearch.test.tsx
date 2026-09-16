import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionSearch } from "../../src/components/ConnectionSearch";
import type { Connection } from "../../src/utils/connections";

// Finding a saved connection and opening it (issue #525). The filtering itself
// is unit-tested in utils/connectionSearch; what is checked here is the part
// only a mounted component has: the keyboard, the highlight, and which callback
// each gesture fires.

const conns: Connection[] = [
  { id: "a", name: "Ventas", driver: "mysql", group: "Producción", params: { host: "10.0.4.12", database: "ventas" } },
  { id: "b", name: "Almacén", driver: "postgres", group: "Producción", params: { host: "pg.interno", database: "stock" } },
  { id: "c", name: "Notas", driver: "sqlite", params: { path: "C:/datos/notas.db" } },
];

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(over: { connections?: Connection[]; openIds?: string[]; connectingId?: string | null } = {}) {
  const handlers = {
    onPick: vi.fn(),
    onNew: vi.fn(),
    onImport: vi.fn(),
    onManage: vi.fn(),
    onClose: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionSearch
          connections={over.connections ?? conns}
          openIds={over.openIds ?? []}
          connectingId={over.connectingId ?? null}
          {...handlers}
        />
      ),
      host!,
    );
  });
  return handlers;
}

const hits = () => [...host!.querySelectorAll<HTMLButtonElement>(".connsearch-hit")];
const names = () => hits().map((h) => h.querySelector(".connsearch-name")!.textContent);
const input = () => host!.querySelector<HTMLInputElement>(".connsearch-input")!;
const type = (text: string) => {
  input().value = text;
  input().dispatchEvent(new Event("input", { bubbles: true }));
};
const press = (key: string) =>
  input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const textBtn = (label: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;

describe("ConnectionSearch", () => {
  // Ungrouped first, then each group under its heading — the order the manager's
  // list has always used, so the two read the same way.
  it("lists every saved connection under its group, with engine and target", () => {
    mount();
    expect(names()).toEqual(["Notas", "Ventas", "Almacén"]);
    expect([...host!.querySelectorAll(".connsearch-group")].map((g) => g.textContent)).toEqual([
      "Producción",
    ]);
    expect(hits()[0].textContent).toContain("SQ"); // monogram
    expect(hits()[0].textContent).toContain("C:/datos/notas.db");
    expect(hits()[1].textContent).toContain("MY");
    expect(hits()[1].textContent).toContain("ventas @ 10.0.4.12");
  });

  it("filters by name, by engine and by server", () => {
    mount();
    type("alma");
    expect(names()).toEqual(["Almacén"]);
    type("sqlite");
    expect(names()).toEqual(["Notas"]);
    type("10.0.4");
    expect(names()).toEqual(["Ventas"]);
  });

  // Typing "almacen" for "Almacén" is what anyone does at speed; the search
  // folds accents on both sides so it still matches.
  it("ignores accents and case", () => {
    mount();
    type("ALMACEN");
    expect(names()).toEqual(["Almacén"]);
  });

  it("says so when nothing matches", () => {
    mount();
    type("zzz");
    expect(hits()).toHaveLength(0);
    expect(host!.querySelector(".connsearch-empty")!.textContent).toContain(
      "Ninguna conexión coincide",
    );
  });

  it("marks what is already open — picking it only focuses it", () => {
    const { onPick, onClose } = mount({ openIds: ["b"] });
    expect(hits()[2].textContent).toContain("Abierta");
    expect(hits()[0].textContent).not.toContain("Abierta");
    hits()[2].click();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("walks the results with the arrows and opens the highlighted one with Enter", () => {
    const { onPick } = mount();
    expect(hits()[0].classList.contains("is-highlighted")).toBe(true);
    press("ArrowDown");
    press("ArrowDown");
    expect(hits()[2].classList.contains("is-highlighted")).toBe(true);
    press("Enter");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("wraps around at both ends", () => {
    mount();
    press("ArrowUp");
    expect(hits()[2].classList.contains("is-highlighted")).toBe(true);
    press("ArrowDown");
    expect(hits()[0].classList.contains("is-highlighted")).toBe(true);
  });

  // One highlight for both devices: hovering moves it, so Enter always takes
  // what the eye is on rather than a second, invisible selection.
  it("moves the highlight with the mouse too", () => {
    const { onPick } = mount();
    hits()[1].dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    expect(hits()[1].classList.contains("is-highlighted")).toBe(true);
    press("Enter");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("re-highlights the first hit as the query narrows", () => {
    mount();
    press("ArrowDown");
    type("nota");
    expect(hits()).toHaveLength(1);
    expect(hits()[0].classList.contains("is-highlighted")).toBe(true);
  });

  it("closes on Escape without opening anything", () => {
    const { onClose, onPick } = mount();
    press("Escape");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("waits rather than starting a second connection", () => {
    mount({ connectingId: "a" });
    expect(hits().every((h) => h.disabled)).toBe(true);
  });

  it("sends creating, importing and managing to the connections tab", () => {
    const { onNew, onImport, onManage } = mount();
    textBtn("+ Nueva conexión").click();
    textBtn("Importar").click();
    textBtn("Gestionar").click();
    expect(onNew).toHaveBeenCalledOnce();
    expect(onImport).toHaveBeenCalledOnce();
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("points a first-time user at importing instead of an empty box", () => {
    mount({ connections: [] });
    expect(host!.querySelector(".connsearch-empty")!.textContent).toContain("No hay conexiones");
  });
});
