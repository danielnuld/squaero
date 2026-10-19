// Integration (M14 TabContextMenu, A-37): the tab menu's Fijar, Duplicar,
// Cambiar el nombre and Reabrir (Ctrl+Mayús+T).
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";
import { contextMenu, closeContextMenu } from "../../src/utils/contextMenu";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number };
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
});

afterEach(() => {
  closeContextMenu();
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as Record<string, unknown>).quaeroRpc;
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};
const titles = () => [...host!.querySelectorAll(".tablist .tab-title")].map((e) => e.textContent);
const tabEl = (title: string) =>
  [...host!.querySelectorAll<HTMLElement>(".tablist .tab")].find((e) => e.querySelector(".tab-title")?.textContent === title)!;
const menuOn = (title: string) => {
  tabEl(title).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }));
  return contextMenu()!.items;
};
const pick = (title: string, label: string) => menuOn(title).find((i) => i.label === label)!;

describe("App — tab menu (M14)", () => {
  it("pins a tab to the start and spares it from «Cerrar todas»", async () => {
    openQueryTab(host!);
    openQueryTab(host!);
    await settle();
    expect(titles()).toEqual(["Consulta 1", "Consulta 2"]);
    pick("Consulta 2", "Fijar").action!();
    await settle();
    expect(titles()).toEqual(["Consulta 2", "Consulta 1"]);
    expect(tabEl("Consulta 2").classList.contains("is-pinned")).toBe(true);
    expect(pick("Consulta 2", "Dejar de fijar")).toBeDefined();
    closeContextMenu();
    pick("Consulta 1", "Cerrar todas").action!();
    await settle();
    expect(titles()).toEqual(["Consulta 2"]);
  });

  it("duplicates and renames a query tab", async () => {
    openQueryTab(host!);
    await settle();
    pick("Consulta 1", "Duplicar").action!();
    await settle();
    expect(titles()).toEqual(["Consulta 1", "Consulta 1 (copia)"]);
    pick("Consulta 1", "Cambiar el nombre…").action!();
    await settle();
    const input = document.querySelector<HTMLInputElement>(".dlg-field input")!;
    input.value = "Ventas";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    [...document.querySelectorAll<HTMLButtonElement>(".dlg-actions button")].find((b) => b.textContent === "Cambiar el nombre")!.click();
    await settle();
    expect(titles()).toEqual(["Ventas", "Consulta 1 (copia)"]);
  });

  it("reopens the last closed tab, disabled with a reason before any", async () => {
    openQueryTab(host!);
    openQueryTab(host!);
    await settle();
    // Only a tab with something written in it is worth reopening.
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ changes: { from: 0, insert: "SELECT 2" } });
    await settle();
    const reopen = pick("Consulta 1", "Reabrir la pestaña cerrada");
    expect(reopen.disabled).toBe(true);
    expect(reopen.title).toContain("No se ha cerrado");
    closeContextMenu();
    pick("Consulta 2", "Cerrar").action!();
    await settle();
    expect(titles()).toEqual(["Consulta 1"]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "T", ctrlKey: true, shiftKey: true, bubbles: true }));
    await settle();
    expect(titles()).toEqual(["Consulta 1", "Consulta 2"]);
    expect(EditorView.findFromDOM(host!)!.state.doc.toString()).toBe("SELECT 2");
  });

  it("says why a tab with no explorer object cannot be shown there", async () => {
    openQueryTab(host!);
    await settle();
    const reveal = pick("Consulta 1", "Mostrar en el explorador");
    expect(reveal.disabled).toBe(true);
    expect(reveal.title).toBe("Esta pestaña no muestra un objeto del explorador.");
  });
});
