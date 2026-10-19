import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { UserManager } from "../../src/components/UserManager";
import { paneSize } from "../../src/utils/paneSizes";
import { setConnGuard, setSafeModeUi } from "../../src/utils/transport";
import { dropdownValues, pickOption } from "./dropdownHarness";
import { contextMenu, closeContextMenu } from "../../src/utils/contextMenu";

// Drives the real UserManager in jsdom against a mocked bridge: it lists users,
// shows a selected user's grants, builds a GRANT from the form and applies it,
// and shows the honest message for an unsupported engine.

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

const usersResult = (id: number) => ({
  jsonrpc: "2.0",
  id,
  result: {
    columns: [
      { name: "User", type: "text" },
      { name: "Host", type: "text" },
      { name: "Super_priv", type: "text" },
      { name: "Grant_priv", type: "text" },
    ],
    rows: [
      ["root", "localhost", "Y", "Y"],
      ["app", "%", "N", "N"],
      ["mysql.sys", "localhost", "N", "N"],
    ],
    truncated: false,
    rowsAffected: 0,
  },
});

const grantsResult = (id: number) => ({
  jsonrpc: "2.0",
  id,
  result: {
    columns: [{ name: "Grants", type: "text" }],
    rows: [["GRANT USAGE ON *.* TO `app`@`%`"]],
    truncated: false,
    rowsAffected: 0,
  },
});

function installBridge() {
  const calls: { method: string; params: { sql?: string } }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
    calls.push({ method: req.method, params: req.params });
    if (req.method === "query.run") {
      const sql = req.params.sql ?? "";
      if (sql.includes("mysql.user")) return usersResult(req.id);
      if (sql.startsWith("SHOW GRANTS")) return grantsResult(req.id);
      // GRANT / REVOKE apply
      return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 0 } };
    }
    // schema.tree (issue #657): databases at the root, a database's tables below.
    if (req.method === "schema.describe") {
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
          rows: [["id", "int"], ["total", "float"]],
          truncated: false,
          rowsAffected: 0,
        },
      };
    }
    if (req.method === "schema.tree") {
      const db = (req.params as { db?: string }).db;
      const result = db
        ? {
            columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
            rows: [["orders", "table"], ["recent", "view"]],
          }
        : { columns: [{ name: "name", type: "text" }], rows: [["shop"], ["sello"]] };
      return { jsonrpc: "2.0", id: req.id, result: { ...result, truncated: false, rowsAffected: 0 } };
    }
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
  return calls;
}

function mount(engine: string, db?: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <UserManager connId="c1" engine={engine} db={db} onClose={vi.fn()} />, host!);
  });
}

describe("UserManager", () => {
  it("lists users and shows the count", async () => {
    installBridge();
    mount("mysql");
    await flush();
    const items = host!.querySelectorAll(".um-user");
    expect(items.length).toBe(3);
    expect(host!.textContent).toContain("3 usuario");
  });

  it("marks the superuser and who can grant (issue #360)", async () => {
    installBridge();
    mount("mysql");
    await flush();
    const row = (name: string) =>
      [...host!.querySelectorAll<HTMLElement>(".um-user")].find((el) =>
        el.querySelector(".um-user-name")?.textContent === name,
      )!;
    expect([...row("root").querySelectorAll(".um-chip")].map((c) => c.textContent)).toEqual([
      "SUPER",
      "GRANT",
    ]);
    expect(row("app").querySelectorAll(".um-chip").length).toBe(0);
  });

  const search = () => host!.querySelector<HTMLInputElement>(".um-search")!;
  const type = (value: string) => {
    search().value = value;
    search().dispatchEvent(new Event("input", { bubbles: true }));
  };
  const names = () =>
    [...host!.querySelectorAll<HTMLElement>(".um-user-name")].map((el) => el.textContent);

  it("filters as you type and counts n of m", async () => {
    installBridge();
    mount("mysql");
    await flush();
    type("APP");                       // case-insensitive
    expect(names()).toEqual(["app"]);
    expect(host!.textContent).toContain("1 de 3");
    type("localhost");                 // matches on the host part too
    expect(names()).toEqual(["root", "mysql.sys"]);
    type("");
    expect(names().length).toBe(3);
    expect(host!.textContent).toContain("3 usuario");
  });

  it("says so when nothing matches instead of showing an empty list", async () => {
    installBridge();
    mount("mysql");
    await flush();
    type("nobody");
    expect(names()).toEqual([]);
    expect(host!.textContent).toContain("Ningún usuario coincide");
  });

  it("filters with the superuser and system-account chips", async () => {
    installBridge();
    mount("mysql");
    await flush();
    const filter = (label: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>(".um-filter")].find(
        (b) => b.textContent === label,
      )!;

    filter("Ocultar cuentas del sistema").click();
    expect(names()).toEqual(["root", "app"]);

    filter("Solo superusuarios").click();
    expect(names()).toEqual(["root"]);
    expect(filter("Solo superusuarios").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a user's grants on selection", async () => {
    installBridge();
    mount("mysql");
    await flush();
    const app = [...host!.querySelectorAll<HTMLElement>(".um-user")].find((el) =>
      el.textContent?.includes("app"),
    )!;
    app.click();
    await flush();
    expect(host!.textContent).toContain("Permisos de app@%");
    // Read as scope → privileges; the statement is one click away.
    const grant = host!.querySelector(".um-grant")!;
    expect(grant.querySelector(".um-grant-scope")!.textContent).toBe("Todo el servidor (*.*)");
    expect(grant.querySelector(".um-priv-chip")!.textContent).toBe("USAGE");
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Ver sentencias GRANT")!.click();
    expect(host!.textContent).toContain("GRANT USAGE ON *.* TO `app`@`%`;");
  });

  it("changes the password and locks the account from «Más»", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    const more = [...host!.querySelectorAll<HTMLButtonElement>(".panel-bar button")].find((b) => b.textContent === "Más")!;
    expect(more.disabled).toBe(true); // nobody selected
    [...host!.querySelectorAll<HTMLElement>(".um-user")].find((el) => el.textContent?.includes("app"))!.click();
    await flush();
    more.click();
    const items = contextMenu()!.items;
    expect(items.map((i) => i.label ?? "-")).toEqual([
      "Cambiar contraseña…",
      "Bloquear cuenta",
      "Desbloquear cuenta",
      "-",
      "Copiar sentencias GRANT",
    ]);
    items[1].action!();
    await flush();
    expect(calls.some((c) => c.params.sql === "ALTER USER 'app'@'%' ACCOUNT LOCK")).toBe(true);
    items[0].action!();
    await flush();
    const pw = host!.querySelector<HTMLInputElement>(".dlg input[type=password]")!;
    pw.value = "s3cret";
    pw.dispatchEvent(new Event("input", { bubbles: true }));
    [...host!.querySelectorAll<HTMLButtonElement>(".dlg button")].find((b) => b.textContent === "Cambiar contraseña")!.click();
    await flush();
    expect(calls.some((c) => c.params.sql === "ALTER USER 'app'@'%' IDENTIFIED BY 's3cret'")).toBe(true);
    closeContextMenu();
  });

  it("builds and applies a GRANT from the form", async () => {
    const calls = installBridge();
    mount("mysql", "shop");
    await flush();
    // select app@%
    [...host!.querySelectorAll<HTMLElement>(".um-user")]
      .find((el) => el.textContent?.includes("app"))!
      .click();
    await flush();

    // tick SELECT and INSERT
    const boxes = host!.querySelectorAll<HTMLInputElement>(".um-priv input");
    const byLabel = (name: string) =>
      [...host!.querySelectorAll<HTMLLabelElement>(".um-priv")].find((l) =>
        l.textContent?.trim().startsWith(name),
      )!.querySelector("input")!;
    byLabel("SELECT").click();
    byLabel("INSERT").click();
    expect(boxes.length).toBeGreaterThan(0);

    // The scope defaults to the active database, not *.* (issue #657).
    expect(host!.querySelector(".um-preview")!.textContent).toContain(
      "GRANT SELECT, INSERT ON `shop`.* TO 'app'@'%'",
    );

    const grantBtn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Otorgar",
    )!;
    grantBtn.click();
    await flush();

    const applied = calls.find(
      (c) => c.method === "query.run" && (c.params.sql ?? "").startsWith("GRANT"),
    );
    expect(applied!.params.sql).toBe("GRANT SELECT, INSERT ON `shop`.* TO 'app'@'%'");
    // Grants were refreshed after apply (a second SHOW GRANTS).
    expect(
      calls.filter((c) => (c.params.sql ?? "").startsWith("SHOW GRANTS")).length,
    ).toBe(2);
  });

  it("revokes only after a confirmation naming who loses what, where", async () => {
    const calls = installBridge();
    mount("mysql", "shop");
    await flush();
    [...host!.querySelectorAll<HTMLElement>(".um-user")].find((el) => el.textContent?.includes("app"))!.click();
    await flush();
    [...host!.querySelectorAll<HTMLLabelElement>(".um-priv")]
      .find((l) => l.textContent?.trim().startsWith("SELECT"))!
      .querySelector("input")!
      .click();
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Revocar")!.click();
    await flush();
    const revokes = () => calls.filter((c) => (c.params.sql ?? "").startsWith("REVOKE"));
    expect(revokes()).toHaveLength(0);
    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg.textContent).toContain("¿Revocar permisos a app@%?");
    expect(dlg.textContent).toContain("app@% dejará de tener SELECT sobre `shop`.*");
    const confirm = dlg.querySelector<HTMLButtonElement>(".btn-danger")!;
    expect(confirm.textContent).toBe("Revocar 1 permiso");
    confirm.click();
    await flush();
    expect(revokes()).toHaveLength(1);
  });

  it("targets an edited host in the GRANT/REVOKE", async () => {
    installBridge();
    mount("mysql", "shop");
    await flush();
    [...host!.querySelectorAll<HTMLElement>(".um-user")]
      .find((el) => el.textContent?.includes("app"))!
      .click();
    await flush();
    // Tick a privilege and change the host from % to localhost.
    [...host!.querySelectorAll<HTMLLabelElement>(".um-priv")]
      .find((l) => l.textContent?.trim().startsWith("SELECT"))!
      .querySelector("input")!
      .click();
    const hostInput = [...host!.querySelectorAll<HTMLInputElement>(".um-form-row input")].find(
      (i) => i.value === "%",
    )!;
    hostInput.value = "localhost";
    hostInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(host!.querySelector(".um-preview")!.textContent).toContain(
      "GRANT SELECT ON `shop`.* TO 'app'@'localhost'",
    );
  });

  // Issue #657: what the grant applies to is picked, not typed.
  const selectApp = async () => {
    [...host!.querySelectorAll<HTMLElement>(".um-user")]
      .find((el) => el.textContent?.includes("app"))!
      .click();
    await flush();
  };
  const tick = (name: string) =>
    [...host!.querySelectorAll<HTMLLabelElement>(".um-priv")]
      .find((l) => l.textContent?.trim() === name)!
      .querySelector("input")!
      .click();
  const selects = () => [...host!.querySelectorAll<HTMLElement>(".um-form-row .dropdown")];
  const choose = (sel: HTMLElement, value: string) => pickOption(sel, value);
  const scope = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>(".um-form-row [role=radio]")].find((b) => b.textContent === label)!.click();
  const preview = () => host!.querySelector(".um-detail .um-preview")!.textContent!;

  it("builds no statement until a database is picked when none is active", async () => {
    installBridge();
    mount("mysql");
    await flush();
    await selectApp();
    tick("SELECT");
    expect(preview()).not.toContain("GRANT");
    const [db] = selects();
    expect(dropdownValues(db)).toEqual(["", "shop", "sello"]);
    choose(db, "sello");
    expect(preview()).toContain("GRANT SELECT ON `sello`.* TO 'app'@'%'");
  });

  it("warns when the grant applies to the whole server", async () => {
    installBridge();
    mount("mysql", "shop");
    await flush();
    await selectApp();
    tick("SELECT");
    expect(host!.querySelector(".related-warn")).toBeNull();
    scope("Todo el servidor");
    expect(preview()).toContain("GRANT SELECT ON *.* TO 'app'@'%'");
    expect(host!.querySelector(".related-warn")!.textContent).toContain("todas las bases de datos");
  });

  it("grants on one table and hides EXECUTE there", async () => {
    installBridge();
    mount("mysql", "shop");
    await flush();
    await selectApp();
    tick("EXECUTE");
    tick("SELECT");
    scope("Una tabla");
    await flush();
    const privNames = () =>
      [...host!.querySelectorAll(".um-priv")].map((l) => l.textContent!.trim());
    expect(privNames()).not.toContain("EXECUTE");
    const table = selects()[1];
    expect(dropdownValues(table)).toEqual(["", "orders", "recent"]);
    choose(table, "orders");
    // EXECUTE was ticked before switching: it is not sent ON a table.
    expect(preview()).toContain("GRANT SELECT ON `shop`.`orders` TO 'app'@'%'");
  });

  it("keeps a typed target for wildcards", async () => {
    installBridge();
    mount("mysql", "shop");
    await flush();
    await selectApp();
    tick("SELECT");
    scope("Otro (ON …)");
    const input = host!.querySelector<HTMLInputElement>(".um-scope input")!;
    input.value = "`app\_%`.*";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(preview()).toContain("GRANT SELECT ON `app\_%`.* TO 'app'@'%'");
  });

  it("grants on some columns only", async () => {
    const calls = installBridge();
    mount("mysql", "shop");
    await flush();
    await selectApp();
    scope("Unas columnas");
    await flush();
    expect([...host!.querySelectorAll(".um-priv")].map((l) => l.textContent!.trim())).toEqual([
      "SELECT",
      "INSERT",
      "UPDATE",
      "REFERENCES",
    ]);
    tick("SELECT");
    choose(selects()[1], "orders");
    await flush();
    await flush();
    expect(calls.some((c) => c.method === "schema.describe")).toBe(true);
    const col = [...host!.querySelectorAll<HTMLLabelElement>(".um-cols label")].find((l) => l.textContent?.trim() === "total")!;
    col.querySelector("input")!.click();
    expect(preview()).toContain("GRANT SELECT (`total`) ON `shop`.`orders` TO 'app'@'%'");
  });

  it("creates a new user from the form (CREATE USER)", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    [...host!.querySelectorAll<HTMLButtonElement>(".panel-bar button")].find((b) => b.textContent === "Nuevo usuario…")!.click();
    await flush();
    const field = (label: string) =>
      host!.querySelector<HTMLInputElement>(`.um-new-user input[aria-label="${label}"]`)!;
    const setVal = (input: HTMLInputElement, v: string) => {
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setVal(field("Nombre de usuario"), "reporter");
    setVal(field("Host del nuevo usuario"), "localhost");
    setVal(field("Contraseña del nuevo usuario"), "pw123");

    // Live preview MASKS the password (not shown on screen).
    const previewText = host!.querySelector(".um-new-user .um-preview")!.textContent!;
    expect(previewText).toContain("CREATE USER 'reporter'@'localhost' IDENTIFIED BY '••••••'");
    expect(previewText).not.toContain("pw123");

    [...host!.querySelectorAll<HTMLButtonElement>(".dlg button")]
      .find((b) => b.textContent === "Crear usuario")!
      .click();
    await flush();

    // The statement actually run carries the real password.
    const created = calls.find((c) => (c.params.sql ?? "").startsWith("CREATE USER"));
    expect(created!.params.sql).toBe("CREATE USER 'reporter'@'localhost' IDENTIFIED BY 'pw123'");
    // The list was refreshed after creating (a second mysql.user query).
    expect(calls.filter((c) => (c.params.sql ?? "").includes("mysql.user")).length).toBe(2);
  });

  const clickText = (text: string) =>
    ([...host!.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement).click();

  it("drops a user after confirming in the dialog (DROP USER)", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    [...host!.querySelectorAll<HTMLElement>(".um-user")]
      .find((el) => el.textContent?.includes("app"))!
      .click();
    await flush();
    // Deleting is the selected account's action, in its heading.
    expect(host!.querySelectorAll(".um-user .um-drop").length).toBe(0);
    host!.querySelector<HTMLButtonElement>(".um-detail-head .um-drop")!.click();
    await flush();
    // The themed confirm dialog shows the exact SQL — no native confirm().
    const dialog = host!.querySelector(".confirm-dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("DROP USER 'app'@'%'");

    clickText("Eliminar usuario"); // confirm
    await flush();
    const dropped = calls.find((c) => (c.params.sql ?? "").startsWith("DROP USER"));
    expect(dropped!.params.sql).toBe("DROP USER 'app'@'%'");
  });

  it("on a protected connection asks for the user's name in the same dialog, once", async () => {
    const calls = installBridge();
    const asked: string[][] = [];
    setConnGuard("c1", { mode: "confirm", engine: "mysql", name: "Prod" });
    setSafeModeUi({
      confirm: async (_g, writes) => {
        asked.push(writes);
        return true;
      },
      blocked: () => "blocked",
      declined: () => "declined",
    });
    try {
      mount("mysql");
      await flush();
      [...host!.querySelectorAll<HTMLElement>(".um-user")]
        .find((el) => el.textContent?.includes("app"))!
        .click();
      await flush();
      // Deleting is the selected account's action, in its heading.
      expect(host!.querySelectorAll(".um-user .um-drop").length).toBe(0);
      host!.querySelector<HTMLButtonElement>(".um-detail-head .um-drop")!.click();
      await flush();
      const dialog = host!.querySelector(".confirm-dialog")!;
      const confirm = dialog.querySelector<HTMLButtonElement>(".btn-danger")!;
      expect(confirm.disabled).toBe(true);
      const input = dialog.querySelector<HTMLInputElement>(".dlg-field input")!;
      input.value = "app";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      confirm.click();
      await flush();
      expect(calls.some((c) => (c.params.sql ?? "").startsWith("DROP USER"))).toBe(true);
      // The typed name was the confirmation: the guard did not ask again.
      expect(asked).toEqual([]);
    } finally {
      setConnGuard("c1", null);
      setSafeModeUi(null);
    }
  });

  it("does not drop when the dialog is cancelled", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    [...host!.querySelectorAll<HTMLElement>(".um-user")]
      .find((el) => el.textContent?.includes("app"))!
      .click();
    await flush();
    // Deleting is the selected account's action, in its heading.
    expect(host!.querySelectorAll(".um-user .um-drop").length).toBe(0);
    host!.querySelector<HTMLButtonElement>(".um-detail-head .um-drop")!.click();
    await flush();
    clickText("Cancelar");
    await flush();
    expect(host!.querySelector(".confirm-dialog")).toBeNull();
    expect(calls.some((c) => (c.params.sql ?? "").startsWith("DROP USER"))).toBe(false);
  });

  // Issue #491: the list column was pinned at 14rem, which cut every long name.
  it("drags the list column wider and remembers the width", async () => {
    installBridge();
    mount("mysql");
    await flush();
    const body = host!.querySelector<HTMLElement>(".um-body")!;
    expect(body.style.gridTemplateColumns).toBe("224px 5px 1fr");
    body.getBoundingClientRect = () => ({ left: 100 }) as DOMRect;
    host!.querySelector<HTMLElement>(".um-body > .resizer")!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 460 }));
    expect(body.style.gridTemplateColumns).toBe("360px 5px 1fr");
    // Neither side may vanish: the drag is clamped like the sidebar's.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 110 }));
    expect(body.style.gridTemplateColumns).toBe("140px 5px 1fr");
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(paneSize("usersList", 224)).toBe(140);
  });

  it("shows an honest message for an unsupported engine", async () => {
    const calls = installBridge();
    mount("sqlite");
    await flush();
    expect(host!.textContent).toContain("embebida");
    expect(calls.filter((c) => c.method === "query.run").length).toBe(0);
  });
});
