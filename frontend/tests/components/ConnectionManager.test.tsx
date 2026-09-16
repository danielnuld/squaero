import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionManager } from "../../src/components/ConnectionManager";
import type { Connection } from "../../src/utils/connections";

// The saved connections as their own tab (issue #525): create, edit, group,
// delete, import, export. Opening, closing and reconnecting are NOT here — they
// belong to the sidebar's bar and its search.

const conns: Connection[] = [
  { id: "a", name: "Prod", driver: "mysql", params: { host: "10.0.4.12", database: "ventas" } },
  { id: "b", name: "Local", driver: "sqlite", params: { path: "C:/datos/notas.db" } },
];

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(
  activeConnId: string | null,
  cbs: {
    onEdit?: (c: Connection) => void;
    onDelete?: (id: string) => void;
    onExport?: (p: boolean) => void;
    onImport?: (files: File[]) => Promise<string>;
  } = {},
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onEdit = cbs.onEdit ?? vi.fn();
  const onDelete = cbs.onDelete ?? vi.fn();
  const onExport = cbs.onExport ?? vi.fn();
  const onImport = cbs.onImport ?? vi.fn(async () => "");
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionManager
          connections={conns}
          activeConnId={activeConnId}
          openIds={activeConnId ? [activeConnId] : []}
          onEdit={onEdit}
          onDelete={onDelete}
          onMoveToGroup={() => {}}
          onNew={() => {}}
          onExport={onExport}
          onImport={onImport}
        />
      ),
      host!,
    );
  });
  return { onEdit, onDelete, onExport, onImport };
}

const btn = (title: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.title === title) ?? null;
const textBtn = (label: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  );

describe("ConnectionManager", () => {
  it("offers no way to open or close a connection — that is the bar's job", () => {
    mount("a");
    expect(btn("Reconectar")).toBeNull();
    expect(btn("Desconectar")).toBeNull();
    expect(btn("Conectar")).toBeNull();
  });

  it("edits the connection the row belongs to", () => {
    const { onEdit } = mount(null);
    host!.querySelectorAll<HTMLButtonElement>(".conn-open")[1].click();
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  // The row edits and so does the pencil beside it; naming both "Editar" left a
  // screen reader — and anything asking for the second connection's edit button
  // — with four identical buttons and no way to tell one row from the next.
  it("names the row after its connection, not the same as the pencil", () => {
    mount(null);
    expect(host!.querySelector<HTMLButtonElement>(".conn-open")!.title).toBe("Editar Prod");
    const named = [...host!.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => b.title === "Editar",
    );
    expect(named).toHaveLength(2); // one pencil per row, and nothing else
  });

  it("shows each connection's engine and where it points", () => {
    mount(null);
    const rows = host!.querySelectorAll(".conn-item");
    expect(rows[0].textContent).toContain("ventas @ 10.0.4.12");
    expect(rows[1].textContent).toContain("C:/datos/notas.db");
  });

  it("marks the open connection without claiming to be the way to open one", () => {
    mount("a");
    expect(host!.querySelectorAll(".conn-item")[0].classList.contains("open")).toBe(true);
    expect(host!.querySelector(".conn-live")).not.toBeNull();
  });

  it("deletes from its own row", () => {
    const { onDelete } = mount(null);
    [...host!.querySelectorAll<HTMLButtonElement>("button")]
      .filter((b) => b.title === "Eliminar")[0]
      .click();
    expect(onDelete).toHaveBeenCalledWith("a");
  });

  it("exports without passwords by default and only warns on opt-in (#188)", () => {
    const onExport = vi.fn();
    mount(null, { onExport });
    textBtn("⬆ Exportar")!.click(); // open the export options
    expect(host!.querySelector(".conn-warn")).toBeNull(); // no warning until opt-in
    const check = host!.querySelector<HTMLInputElement>(".conn-export-opt input")!;
    check.checked = true;
    check.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host!.querySelector(".conn-warn")).not.toBeNull(); // plaintext warning shown
    textBtn("Exportar")!.click();
    expect(onExport).toHaveBeenCalledWith(true);
  });

  it("imports a file and shows the returned summary (#188)", async () => {
    const onImport = vi.fn(async () => "Añadidas 2 · actualizadas 0 · omitidas 1");
    mount(null, { onImport });
    const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["{}"], "conns.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    // A list: DBeaver's connections and its passwords are two files picked at
    // once (#391).
    expect(onImport).toHaveBeenCalledWith([file]);
    expect(host!.querySelector(".conn-import-msg")!.textContent).toContain("Añadidas 2");
  });
});
