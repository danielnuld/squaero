import { describe, it, expect } from "vitest";
import { cellEditorKey, gridEditKey } from "../../src/utils/cellEditKeys";

describe("gridEditKey", () => {
  it("opens the editor with F2 and Enter", () => {
    expect(gridEditKey({ key: "F2" })).toEqual({ kind: "edit" });
    expect(gridEditKey({ key: "Enter" })).toEqual({ kind: "edit" });
  });
  it("starts an edit with a printable key, carrying the character", () => {
    expect(gridEditKey({ key: "a" })).toEqual({ kind: "type", text: "a" });
    expect(gridEditKey({ key: "7", shiftKey: true })).toEqual({ kind: "type", text: "7" });
    expect(gridEditKey({ key: "ñ" })).toEqual({ kind: "type", text: "ñ" });
  });
  it("opens the row detail with Space, the FK browser with Alt+Down", () => {
    expect(gridEditKey({ key: " " })).toEqual({ kind: "detail" });
    expect(gridEditKey({ key: "ArrowDown", altKey: true })).toEqual({ kind: "fk" });
  });
  it("writes NULL with Ctrl/Cmd+Shift+N", () => {
    expect(gridEditKey({ key: "N", ctrlKey: true, shiftKey: true })).toEqual({ kind: "null" });
    expect(gridEditKey({ key: "n", metaKey: true, shiftKey: true })).toEqual({ kind: "null" });
  });
  it("leaves named keys and shortcuts alone", () => {
    for (const key of ["Tab", "Delete", "Escape", "ArrowDown", "F5", "Shift"]) {
      expect(gridEditKey({ key })).toBeNull();
    }
    expect(gridEditKey({ key: "c", ctrlKey: true })).toBeNull();
    expect(gridEditKey({ key: "x", altKey: true })).toBeNull();
    expect(gridEditKey({ key: "Enter", shiftKey: true })).toBeNull();
  });
});

describe("cellEditorKey", () => {
  it("commits and moves with Enter and Tab, backwards with Shift", () => {
    expect(cellEditorKey({ key: "Enter" })).toEqual({ kind: "commit", move: "ArrowDown" });
    expect(cellEditorKey({ key: "Enter", shiftKey: true })).toEqual({ kind: "commit", move: "ArrowUp" });
    expect(cellEditorKey({ key: "Tab" })).toEqual({ kind: "commit", move: "ArrowRight" });
    expect(cellEditorKey({ key: "Tab", shiftKey: true })).toEqual({ kind: "commit", move: "ArrowLeft" });
  });
  it("reverts with Escape and writes NULL with Ctrl+Shift+N", () => {
    expect(cellEditorKey({ key: "Escape" })).toEqual({ kind: "revert" });
    expect(cellEditorKey({ key: "N", ctrlKey: true, shiftKey: true })).toEqual({ kind: "null" });
  });
  it("lets the input keep typing and editing keys", () => {
    for (const key of ["a", " ", "ArrowLeft", "Backspace", "Home"]) {
      expect(cellEditorKey({ key })).toBeNull();
    }
    expect(cellEditorKey({ key: "a", ctrlKey: true })).toBeNull();
  });
});
