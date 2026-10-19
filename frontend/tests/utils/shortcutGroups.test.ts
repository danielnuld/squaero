import { describe, it, expect } from "vitest";
import { groupShortcuts, shortcutGroup, SHORTCUT_GROUPS } from "../../src/utils/shortcutGroups";
import { SHORTCUTS } from "../../src/utils/shortcuts";
import { translate } from "../../src/utils/i18n";

const resolve = (k: string) => translate("es", k);

describe("shortcutGroups (M14 ShortcutsHelp)", () => {
  it("files every action in one of the groups", () => {
    for (const sc of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(shortcutGroup(sc.id));
  });

  it("lists the groups in order, each with its actions", () => {
    const groups = groupShortcuts(SHORTCUTS, { resolve, isMac: false });
    expect(groups.map((g) => g.group)).toEqual(["general", "tabs", "editor", "tx", "grid"]);
    expect(groups.find((g) => g.group === "tx")!.items.map((s) => s.id)).toEqual(["tx-commit", "tx-rollback"]);
  });

  it("finds an action by its name, accents aside, or by its keys", () => {
    const byName = groupShortcuts(SHORTCUTS, { query: "pestana", resolve, isMac: false });
    expect(byName.map((g) => g.group)).toEqual(["tabs"]);
    const byKeys = groupShortcuts(SHORTCUTS, { query: "ctrl+w", resolve, isMac: false });
    expect(byKeys.flatMap((g) => g.items.map((s) => s.id))).toContain("close-tab");
  });

  it("keeps to one group when asked, and drops the empty ones", () => {
    expect(groupShortcuts(SHORTCUTS, { group: "grid", resolve, isMac: false }).map((g) => g.group)).toEqual(["grid"]);
    expect(groupShortcuts(SHORTCUTS, { query: "zzzz", resolve, isMac: false })).toEqual([]);
  });

  it("matches an action with no keys by its name only", () => {
    const table = [{ ...SHORTCUTS[0], keys: "" }];
    expect(groupShortcuts(table, { query: resolve(SHORTCUTS[0].description), resolve, isMac: false })).toHaveLength(1);
  });
});
