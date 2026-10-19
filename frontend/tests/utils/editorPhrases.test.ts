import { describe, it, expect, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search, openSearchPanel, setSearchQuery, SearchQuery } from "@codemirror/search";
import {
  CM_PHRASES,
  MATCH_COUNT_CAP,
  editorPhrases,
  matchCount,
  matchCountText,
} from "../../src/utils/editorPhrases";
import { es } from "../../src/utils/messages/es";
import { en } from "../../src/utils/messages/en";
import { setLocale } from "../../src/utils/i18n";

afterEach(() => setLocale("es"));

describe("editorPhrases", () => {
  it("has every CodeMirror phrase in both catalogs", () => {
    for (const key of Object.values(CM_PHRASES)) {
      expect(es[key as keyof typeof es], key).toBeDefined();
      expect(en[key as keyof typeof en], key).toBeDefined();
    }
  });
  it("translates the find panel and the fold gutter into Spanish", () => {
    const p = editorPhrases();
    expect(p.Find).toBe("Buscar");
    expect(p["replace all"]).toBe("Reemplazar todas");
    expect(p["Fold line"]).toBe("Plegar");
    // CodeMirror fills the $ itself.
    expect(p["replaced $ matches"]).toContain("$");
  });
});

const viewWith = (doc: string, query: string, sel?: [number, number]) => {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [search()] }),
    parent: document.body,
  });
  openSearchPanel(view);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
  if (sel) view.dispatch({ selection: EditorSelection.single(sel[0], sel[1]) });
  return view;
};

describe("matchCount", () => {
  it("says which match the selection is on, of how many", () => {
    const view = viewWith("select a; select b;", "select", [10, 16]);
    expect(matchCount(view.state)).toEqual({ index: 2, total: 2 });
    expect(matchCountText(matchCount(view.state)!)).toBe("2 de 2");
    view.destroy();
  });
  it("reports 0 for a selection on no match, and none found", () => {
    const view = viewWith("select a;", "select", [0, 0]);
    expect(matchCount(view.state)).toEqual({ index: 0, total: 1 });
    expect(matchCountText({ index: 0, total: 1 })).toBe("– de 1");
    expect(matchCountText({ index: 0, total: 0 })).toBe("Sin resultados");
    view.destroy();
  });
  it("is null with the panel closed or an empty query", () => {
    expect(matchCount(EditorState.create({ doc: "x", extensions: [search()] }))).toBeNull();
    const view = viewWith("x", "");
    expect(matchCount(view.state)).toBeNull();
    view.destroy();
  });
  it("stops counting at the cap", () => {
    const view = viewWith("a".repeat(MATCH_COUNT_CAP + 50), "a");
    expect(matchCount(view.state)!.total).toBe(MATCH_COUNT_CAP);
    setLocale("en");
    expect(matchCountText({ index: 3, total: MATCH_COUNT_CAP })).toBe(`3 of ${MATCH_COUNT_CAP}+`);
    view.destroy();
  });
});
