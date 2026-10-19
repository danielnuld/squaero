import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ExportDialog } from "../../src/components/ExportDialog";

// The export dialog (audit R-36): what to export, in which format and with
// which CSV options, before asking where to save.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const FORMATS = [
  { fmt: "csv", label: "CSV" },
  { fmt: "json", label: "JSON" },
];

function mount(over: Partial<{ canReadAll: boolean; marked: number; more: boolean; initialFormat: string }> = {}) {
  const onExport = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ExportDialog
          formats={FORMATS}
          initialFormat={over.initialFormat ?? "csv"}
          loaded={1000}
          marked={over.marked ?? 0}
          canReadAll={over.canReadAll ?? true}
          more={over.more ?? true}
          onExport={onExport}
          onCancel={() => {}}
        />
      ),
      host!,
    );
  });
  return onExport;
}

const scopes = () => [...document.querySelectorAll<HTMLInputElement>("input[name=export-scope]")];
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;

describe("ExportDialog", () => {
  it("starts on the whole table and says the grid holds only part of it", () => {
    const onExport = mount({ marked: 3 });
    expect(scopes().map((s) => s.parentElement!.textContent)).toEqual([
      "Toda la tabla o consulta (más de 1000 filas)",
      "Solo la página cargada (1000 filas)",
      "Solo las 3 filas marcadas",
    ]);
    expect(scopes()[0].checked).toBe(true);
    button("Exportar…").click();
    expect(onExport).toHaveBeenCalledWith({
      format: "csv",
      scope: "all",
      csv: { delimiter: ",", header: true, nullText: "", bom: false },
    });
  });

  it("warns when only the loaded page is chosen and there are more rows", () => {
    mount();
    scopes()[1].click();
    expect(document.body.textContent).toContain("Hay más filas que las cargadas");
  });

  it("passes the CSV options chosen", () => {
    const onExport = mount();
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".export-dialog input[type=checkbox]")];
    boxes[0].click(); // no header
    boxes[1].click(); // BOM
    const nullInput = document.querySelector<HTMLInputElement>(".export-dialog input[type=text]")!;
    nullInput.value = "NULL";
    nullInput.dispatchEvent(new Event("input", { bubbles: true }));
    button("Exportar…").click();
    expect(onExport.mock.calls[0][0].csv).toEqual({ delimiter: ",", header: false, nullText: "NULL", bom: true });
  });

  it("shows no CSV options for another format, and only the page when nothing can re-read the result", () => {
    mount({ initialFormat: "json", canReadAll: false, more: false });
    expect(document.querySelector(".export-dialog input[type=checkbox]")).toBeNull();
    expect(scopes()).toHaveLength(1);
    expect(scopes()[0].checked).toBe(true);
  });
});
