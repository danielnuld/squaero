import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { TriggersExplorer } from "../../src/components/TriggersExplorer";

// Drives the real TriggersExplorer in jsdom against a mocked bridge: lists
// triggers, fetches a definition, toggles to events, reads SQLite's inline DDL
// without a second query, reloads on a connection prop change, and shows the
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

function result(id: number, columns: string[], rows: (string | null)[][]) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      columns: columns.map((name) => ({ name, type: "text" })),
      rows,
      truncated: false,
      rowsAffected: 0,
    },
  };
}

function installMysqlBridge() {
  const calls: { sql: string; connId: string }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as {
      id: number;
      method: string;
      params: { sql?: string; connId?: string };
    };
    if (req.method !== "query.run") return { jsonrpc: "2.0", id: req.id, result: {} };
    const sql = req.params.sql ?? "";
    calls.push({ sql, connId: req.params.connId ?? "" });
    if (sql.includes("information_schema.TRIGGERS"))
      return result(req.id, ["TRIGGER_NAME", "ACTION_TIMING", "EVENT_MANIPULATION", "EVENT_OBJECT_TABLE"], [
        ["trg_audit", "AFTER", "INSERT", "orders"],
      ]);
    if (sql.includes("information_schema.EVENTS"))
      return result(req.id, ["EVENT_NAME", "EVENT_TYPE", "STATUS", "INTERVAL_VALUE", "INTERVAL_FIELD"], [
        ["nightly_cleanup", "RECURRING", "ENABLED", "1", "DAY"],
      ]);
    if (sql.startsWith("SHOW CREATE TRIGGER"))
      return result(req.id, ["Trigger", "sql_mode", "SQL Original Statement"], [
        ["trg_audit", "", "CREATE TRIGGER `trg_audit` AFTER INSERT ON `orders` FOR EACH ROW BEGIN END"],
      ]);
    if (sql.startsWith("SHOW CREATE EVENT"))
      return result(req.id, ["Event", "sql_mode", "time_zone", "Create Event"], [
        ["nightly_cleanup", "", "SYSTEM", "CREATE EVENT `nightly_cleanup` ON SCHEDULE EVERY 1 DAY DO DELETE FROM logs"],
      ]);
    return result(req.id, [], []);
  };
  return calls;
}

function mount(engine: string, onOpenSql = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onClose = vi.fn();
  const [connId, setConnId] = createSignal("c1");
  const [eng, setEngine] = createSignal(engine);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <TriggersExplorer
          connId={connId()}
          engine={eng()}
          db="testdb"
          onOpenSql={onOpenSql}
          onClose={onClose}
        />
      ),
      host!,
    );
  });
  return { onClose, onOpenSql, setConnId, setEngine };
}

describe("TriggersExplorer", () => {
  it("lists MySQL triggers and fetches a trigger's definition", async () => {
    const calls = installMysqlBridge();
    mount("mysql");
    await flush();
    expect(calls[0].sql).toContain("information_schema.TRIGGERS");
    expect(host!.querySelectorAll(".routine-item").length).toBe(1);
    expect(host!.textContent).toContain("orders"); // table sublabel

    host!.querySelector<HTMLButtonElement>(".routine-item")!.click();
    await flush();
    const ddlCall = calls.find((c) => c.sql.startsWith("SHOW CREATE TRIGGER"));
    expect(ddlCall!.sql).toBe("SHOW CREATE TRIGGER `trg_audit`");
    expect(host!.querySelector(".routine-ddl")!.textContent).toContain("CREATE TRIGGER");
  });

  it("toggles to events and fetches an event's definition", async () => {
    const calls = installMysqlBridge();
    mount("mysql");
    await flush();
    const toggle = [...host!.querySelectorAll<HTMLButtonElement>(".obj-kind-toggle .edit-btn")].find(
      (b) => b.textContent === "Eventos",
    )!;
    toggle.click();
    await flush();
    expect(calls.some((c) => c.sql.includes("information_schema.EVENTS"))).toBe(true);
    expect(host!.textContent).toContain("nightly_cleanup");
    host!.querySelector<HTMLButtonElement>(".routine-item")!.click();
    await flush();
    expect(calls.find((c) => c.sql.startsWith("SHOW CREATE EVENT"))!.sql).toBe(
      "SHOW CREATE EVENT `nightly_cleanup`",
    );
    expect(host!.querySelector(".routine-ddl")!.textContent).toContain("ON SCHEDULE");
  });

  it("reads SQLite trigger DDL inline without a second query", async () => {
    const calls: { sql: string }[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
      if (req.method !== "query.run") return { jsonrpc: "2.0", id: req.id, result: {} };
      calls.push({ sql: req.params.sql ?? "" });
      return result(req.id, ["name", "table", "sql"], [
        ["trg_x", "t", "CREATE TRIGGER trg_x AFTER INSERT ON t BEGIN SELECT 1; END"],
      ]);
    };
    mount("sqlite");
    await flush();
    host!.querySelector<HTMLButtonElement>(".routine-item")!.click();
    await flush();
    // Only the list query ran — the DDL came from the row itself.
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain("sqlite_master");
    expect(host!.querySelector(".routine-ddl")!.textContent).toContain("CREATE TRIGGER trg_x");
  });

  it("hides the events toggle and shows honest message for unsupported engine", async () => {
    const calls: unknown[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string };
      if (req.method === "query.run") calls.push(req);
      return { jsonrpc: "2.0", id: req.id, result: {} };
    };
    mount("mongodb");
    await flush();
    expect(host!.textContent).toContain("MongoDB");
    expect(host!.querySelector(".obj-kind-toggle")).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("falls back to Triggers when the engine stops supporting events mid-view", async () => {
    // MySQL bridge, then switch to sqlite (no events) while on the Eventos view.
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
      if (req.method !== "query.run") return { jsonrpc: "2.0", id: req.id, result: {} };
      const sql = req.params.sql ?? "";
      if (sql.includes("information_schema.EVENTS"))
        return result(req.id, ["EVENT_NAME"], [["ev"]]);
      if (sql.includes("sqlite_master"))
        return result(req.id, ["name", "table", "sql"], [["t", "x", "CREATE TRIGGER t ..."]]);
      return result(req.id, ["TRIGGER_NAME", "ACTION_TIMING", "EVENT_MANIPULATION", "EVENT_OBJECT_TABLE"], [["trg", "AFTER", "INSERT", "orders"]]);
    };
    const { setEngine } = mount("mysql");
    await flush();
    [...host!.querySelectorAll<HTMLButtonElement>(".obj-kind-toggle .edit-btn")]
      .find((b) => b.textContent === "Eventos")!
      .click();
    await flush();
    expect(host!.textContent).toContain("ev"); // on the events view

    setEngine("sqlite"); // no events support
    await flush();
    // Toggle is gone AND we're not stranded on the unsupported fallback.
    expect(host!.querySelector(".obj-kind-toggle")).toBeNull();
    expect(host!.textContent).not.toContain("no tiene eventos");
    expect(host!.querySelector(".routine-item")).not.toBeNull(); // triggers listed
  });

  it("reloads when the connection prop changes on the mounted tab", async () => {
    const calls = installMysqlBridge();
    const { setConnId } = mount("mysql");
    await flush();
    setConnId("c2");
    await flush();
    const listCalls = calls.filter((c) => c.sql.includes("information_schema.TRIGGERS"));
    expect(listCalls.map((c) => c.connId)).toEqual(["c1", "c2"]);
  });
});
