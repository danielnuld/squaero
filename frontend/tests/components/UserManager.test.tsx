import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { UserManager } from "../../src/components/UserManager";

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
    ],
    rows: [
      ["root", "localhost"],
      ["app", "%"],
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
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
  return calls;
}

function mount(engine: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <UserManager connId="c1" engine={engine} onClose={vi.fn()} />, host!);
  });
}

describe("UserManager", () => {
  it("lists users and shows the count", async () => {
    installBridge();
    mount("mysql");
    await flush();
    const items = host!.querySelectorAll(".um-user");
    expect(items.length).toBe(2);
    expect(host!.textContent).toContain("2 usuario");
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
    expect(host!.textContent).toContain("GRANT USAGE ON *.*");
  });

  it("builds and applies a GRANT from the form", async () => {
    const calls = installBridge();
    mount("mysql");
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

    // scope defaults to *.* -> preview shows both statements
    expect(host!.querySelector(".um-preview")!.textContent).toContain(
      "GRANT SELECT, INSERT ON *.* TO 'app'@'%'",
    );

    const grantBtn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Otorgar",
    )!;
    grantBtn.click();
    await flush();

    const applied = calls.find(
      (c) => c.method === "query.run" && (c.params.sql ?? "").startsWith("GRANT"),
    );
    expect(applied!.params.sql).toBe("GRANT SELECT, INSERT ON *.* TO 'app'@'%'");
    // Grants were refreshed after apply (a second SHOW GRANTS).
    expect(
      calls.filter((c) => (c.params.sql ?? "").startsWith("SHOW GRANTS")).length,
    ).toBe(2);
  });

  it("targets an edited host in the GRANT/REVOKE", async () => {
    installBridge();
    mount("mysql");
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
      "GRANT SELECT ON *.* TO 'app'@'localhost'",
    );
  });

  it("creates a new user from the form (CREATE USER)", async () => {
    const calls = installBridge();
    mount("mysql");
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

    [...host!.querySelectorAll<HTMLButtonElement>(".um-new-user button")]
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
      .querySelector<HTMLButtonElement>(".um-drop")!
      .click();
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

  it("does not drop when the dialog is cancelled", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    [...host!.querySelectorAll<HTMLElement>(".um-user")]
      .find((el) => el.textContent?.includes("app"))!
      .querySelector<HTMLButtonElement>(".um-drop")!
      .click();
    await flush();
    clickText("Cancelar");
    await flush();
    expect(host!.querySelector(".confirm-dialog")).toBeNull();
    expect(calls.some((c) => (c.params.sql ?? "").startsWith("DROP USER"))).toBe(false);
  });

  it("shows an honest message for an unsupported engine", async () => {
    const calls = installBridge();
    mount("sqlite");
    await flush();
    expect(host!.textContent).toContain("embebida");
    expect(calls.filter((c) => c.method === "query.run").length).toBe(0);
  });
});
