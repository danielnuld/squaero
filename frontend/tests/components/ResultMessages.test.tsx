import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { ResultMessages } from "../../src/components/ResultMessages";
import { ResultTabs } from "../../src/components/ResultTabs";
import type { RunMessage } from "../../src/utils/runMessages";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const mount = (ui: () => any) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(ui, host);
};

describe("ResultMessages (#691)", () => {
  it("says so when nothing ran yet", () => {
    mount(() => <ResultMessages messages={[]} />);
    expect(host!.textContent).toContain("Aún no hay mensajes");
  });

  it("lists each line with its time, outcome, duration and statement", () => {
    const at = new Date(2026, 0, 1, 14, 30, 2).getTime();
    const msgs: RunMessage[] = [
      { at, kind: "rows", sql: "SELECT *\n FROM t", n: 12, ms: 14 },
      { at, kind: "affected", sql: "DELETE FROM t", n: 1 },
      { at, kind: "error", sql: "SELEC", text: "syntax error" },
    ];
    mount(() => <ResultMessages messages={msgs} />);
    const log = host!.querySelector('[role="log"]')!;
    expect(log.getAttribute("aria-label")).toBe("Mensajes de las ejecuciones");
    const items = [...host!.querySelectorAll("li")];
    expect(items).toHaveLength(3);
    expect(items[0].querySelector(".run-msg-at")!.textContent).toBe("14:30:02");
    expect(items[0].textContent).toContain("12 filas devueltas");
    expect(items[0].querySelector(".run-msg-sql")!.textContent).toBe("SELECT * FROM t");
    expect(items[1].textContent).toContain("1 filas afectadas");
    expect(items[2].classList.contains("is-error")).toBe(true);
    expect(items[2].textContent).toContain("syntax error");
  });
});

describe("ResultTabs views (#691)", () => {
  const tabs = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

  it("offers Resultado, Mensajes and Plan without a script", () => {
    const onView = vi.fn();
    mount(() => <ResultTabs sets={[]} active={0} onSelect={() => {}} view="result" onView={onView} />);
    expect(tabs().map((b) => b.textContent)).toEqual(["Resultado", "Mensajes", "Plan"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    tabs()[1].click();
    expect(onView).toHaveBeenCalledWith("messages");
  });

  it("puts the statements in the result's place, unselected while another view shows", () => {
    const onView = vi.fn();
    const onSelect = vi.fn();
    const set = (sql: string) => ({ sql, label: sql, result: null, error: null, elapsedMs: 1 });
    mount(() => (
      <ResultTabs sets={[set("a"), set("b")]} active={0} onSelect={onSelect} view="plan" onView={onView} />
    ));
    expect(tabs()).toHaveLength(4);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs()[3].getAttribute("aria-selected")).toBe("true");
    tabs()[1].click();
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onView).toHaveBeenCalledWith("result");
  });

  it("shows only the statements without a view handler", () => {
    const set = (sql: string) => ({ sql, label: sql, result: null, error: null, elapsedMs: 1 });
    mount(() => <ResultTabs sets={[set("a"), set("b")]} active={0} onSelect={() => {}} />);
    expect(tabs()).toHaveLength(2);
  });
});
