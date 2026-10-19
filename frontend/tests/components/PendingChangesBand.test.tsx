import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { PendingChangesBand } from "../../src/components/PendingChangesBand";
import { emptyPending, setCell, toggleDelete } from "../../src/utils/editSession";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

describe("PendingChangesBand (R-26)", () => {
  it("counts the changes by kind with their glyphs, and offers old values, SQL and discard", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const calls: string[] = [];
    const pending = toggleDelete(setCell(setCell(emptyPending(), 0, "a", "x"), 2, "a", "z"), 2);
    dispose = render(
      () => (
        <PendingChangesBand
          pending={pending}
          showOld={false}
          busy={false}
          onToggleOld={() => calls.push("old")}
          onReview={() => calls.push("sql")}
          onDiscard={() => calls.push("discard")}
        />
      ),
      host!,
    );
    const text = host.textContent!;
    expect(text).toContain("2 cambios sin guardar");
    expect(text).toContain("~ 1 modificadas");
    expect(text).toContain("− 1 eliminadas");
    expect(text).not.toContain("nuevas");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    buttons.forEach((b) => b.click());
    expect(calls).toEqual(["old", "sql", "discard"]);
  });
});
