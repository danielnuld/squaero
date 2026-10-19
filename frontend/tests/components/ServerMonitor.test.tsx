import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ServerMonitor } from "../../src/components/ServerMonitor";

// Drives the real ServerMonitor in jsdom against a mocked bridge: it runs the
// per-engine process-list query, renders the sessions, kills one, and shows the
// honest message for an unsupported engine.

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as BridgeHost).quaeroRpc;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function processListResult(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      columns: [
        { name: "Id", type: "int" },
        { name: "User", type: "text" },
        { name: "Command", type: "text" },
        { name: "Info", type: "text" },
      ],
      rows: [
        ["7", "root", "Query", "SELECT * FROM big"],
        ["8", "app", "Sleep", null],
      ],
      truncated: false,
      rowsAffected: 0,
    },
  };
}

function installBridge() {
  const calls: { method: string; params: unknown }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
    calls.push({ method: req.method, params: req.params });
    if (req.method === "query.run") {
      const sql = req.params.sql ?? "";
      if (sql.startsWith("KILL")) {
        return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 1 } };
      }
      return processListResult(req.id);
    }
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
  return calls;
}

function mount(engine: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onClose = vi.fn();
  createRoot((d) => {
    dispose = d;
    render(() => <ServerMonitor connId="c1" engine={engine} onClose={onClose} />, host!);
  });
  return { onClose };
}

describe("ServerMonitor", () => {
  it("lists processes for MySQL and shows the session count", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    // The list query ran with SHOW PROCESSLIST.
    const listCall = calls.find((c) => c.method === "query.run");
    expect((listCall!.params as { sql: string }).sql).toContain("PROCESSLIST");
    // The idle (Sleep) session is hidden by default; the bar counts both.
    expect(host!.querySelectorAll(".grid-rows [role='row']").length).toBe(1);
    expect(host!.querySelector(".panel-status")!.textContent).toContain("2 sesiones · 1 visible");
    // The cards count from the list itself.
    const kpis = host!.querySelector(".monitor-kpis")!.textContent!;
    expect(kpis).toContain("Sesiones abiertas2");
    expect(kpis).toContain("Activas1");
    expect(kpis).toContain("Inactivas1");
    // «Ocultar inactivas» off shows the idle one too.
    barButton("Ocultar inactivas").click();
    await flush();
    expect(host!.querySelectorAll(".grid-rows [role='row']").length).toBe(2);
  });

  it("filters the sessions by any cell and offers to show all when none match", async () => {
    installBridge();
    mount("mysql");
    await flush();
    const input = host!.querySelector<HTMLInputElement>(".monitor-filter")!;
    input.value = "nothing-like-this";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(host!.textContent).toContain("Ninguna sesión coincide");
    [...host!.querySelectorAll<HTMLButtonElement>(".empty-note button")].find((b) => b.textContent === "Mostrar todas")!.click();
    await flush();
    expect(host!.querySelectorAll(".grid-rows [role='row']").length).toBe(2);
  });

  it("cancels the selected session's query with KILL QUERY, without asking", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    host!.querySelector<HTMLElement>(".grid-rows [role='gridcell']")!.click();
    await flush();
    const detail = host!.querySelector(".monitor-detail")!;
    expect(detail.textContent).toContain("Sesión 7");
    expect(detail.querySelector(".monitor-detail-sql")!.textContent).toBe("SELECT * FROM big");
    detailButton("Cancelar consulta").click();
    await flush();
    expect(calls.some((c) => (c.params as { sql?: string }).sql === "KILL QUERY 7")).toBe(true);
  });

  it("re-reads the list every 5 s until paused", async () => {
    vi.useFakeTimers();
    try {
      const calls = installBridge();
      mount("mysql");
      await vi.advanceTimersByTimeAsync(0);
      const lists = () => calls.filter((c) => (c.params as { sql?: string }).sql?.includes("PROCESSLIST")).length;
      expect(lists()).toBe(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(lists()).toBe(2);
      host!.querySelector<HTMLButtonElement>("[role='radio'][aria-checked='false']")!.click();
      await vi.advanceTimersByTimeAsync(15000);
      expect(lists()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills the SELECTED session with KILL <id> then refreshes", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    // Nothing selected yet: no session strip, nothing to act on.
    expect(host!.querySelector(".monitor-detail")).toBeNull();

    // Selecting a cell of the first row opens its strip with the action.
    host!.querySelector<HTMLElement>(".grid-rows [role='gridcell']")!.click();
    await flush();
    killButton().click();
    await flush();
    // It asks first, naming the session (audit A-10); nothing ran yet.
    expect(calls.some((c) => (c.params as { sql?: string })?.sql?.startsWith("KILL"))).toBe(false);
    expect(document.querySelector("[role='alertdialog'] h2")!.textContent).toContain("sesión 7");
    // The session's facts, and the PID to type before the button wakes up.
    const dlg = document.querySelector("[role='alertdialog']")!;
    expect(dlg.querySelector(".kill-facts")!.textContent).toContain("Userroot");
    expect(dlg.querySelector(".kill-facts")!.textContent).toContain("SELECT * FROM big");
    expect(dlg.querySelector<HTMLButtonElement>(".dlg-actions .btn-danger")!.disabled).toBe(true);
    confirmKill();
    await flush();
    const killCall = calls.find(
      (c) => c.method === "query.run" && (c.params as { sql: string }).sql.startsWith("KILL"),
    );
    expect((killCall!.params as { sql: string }).sql).toBe("KILL 7");
    // A reload (another list query) followed the kill.
    const listCalls = calls.filter(
      (c) => c.method === "query.run" && (c.params as { sql: string }).sql.includes("PROCESSLIST"),
    );
    expect(listCalls.length).toBe(2);
  });

  it("shows an honest message and no query for an unsupported engine", async () => {
    const calls = installBridge();
    mount("sqlite");
    await flush();
    expect(host!.querySelector(".empty-note")!.textContent).toContain("embebida");
    expect(calls.filter((c) => c.method === "query.run").length).toBe(0);
    expect(host!.querySelector("[role='gridcell']")).toBeNull();
  });
});

/** A button of the panel bar, by its text. */
function barButton(text: string): HTMLButtonElement {
  return [...host!.querySelectorAll<HTMLButtonElement>(".panel-bar button")].find((b) => b.textContent === text)!;
}

/** A button of the selected session's strip, by its text. */
function detailButton(text: string): HTMLButtonElement {
  return [...host!.querySelectorAll<HTMLButtonElement>(".monitor-detail button")].find((b) =>
    b.textContent?.includes(text),
  )!;
}

/** The selected session's kill action. */
function killButton(): HTMLButtonElement {
  return detailButton("Terminar");
}

/** The red button of the kill confirmation. */
/** The PID has to be typed (audit P1): read it from the field's own label. */
function confirmKill(): void {
  const field = document.querySelector<HTMLLabelElement>("[role='alertdialog'] .dlg-field")!;
  const pid = /«(.+)»/.exec(field.textContent ?? "")![1];
  const input = field.querySelector("input")!;
  input.value = pid;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>(".dlg-actions .btn-danger")!.click();
}

// Issue #719: MongoDB lists db.currentOp() and kills with db.killOp(opid); a
// refusal from the server (no privileges) is shown as the server worded it.
describe("ServerMonitor on MongoDB", () => {
  function mongoBridge(failList?: string) {
    const sqls: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
      const sql = req.params.sql ?? "";
      sqls.push(sql);
      if (failList && sql === "db.currentOp()") {
        return { jsonrpc: "2.0", id: req.id, error: { code: -32003, message: failList } };
      }
      if (sql.startsWith("db.killOp")) {
        return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 0 } };
      }
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          columns: [
            { name: "opid", type: "int" },
            { name: "op", type: "text" },
            { name: "ns", type: "text" },
          ],
          rows: [["4711", "query", "shop.orders"]],
          truncated: false,
          rowsAffected: 0,
        },
      };
    };
    return sqls;
  }

  it("lists the operations and kills the selected one with db.killOp", async () => {
    const sqls = mongoBridge();
    mount("mongodb");
    await flush();
    expect(sqls[0]).toBe("db.currentOp()");
    host!.querySelector<HTMLElement>(".grid-rows [role='gridcell']")!.click();
    await flush();
    killButton().click();
    await flush();
    confirmKill();
    await flush();
    expect(sqls).toContain("db.killOp(4711)");
    expect(sqls.filter((s) => s === "db.currentOp()").length).toBe(2); // reloaded after the kill
  });

  it("shows the server's own message when the user lacks the privilege", async () => {
    mongoBridge("currentOp failed: not authorized on admin to execute command");
    mount("mongodb");
    await flush();
    expect(host!.querySelector("[role='alert']")!.textContent).toContain("not authorized");
  });
});
