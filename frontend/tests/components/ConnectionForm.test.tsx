import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionForm } from "../../src/components/ConnectionForm";
import { QueryError } from "../../src/utils/query";
import type { Connection } from "../../src/utils/connections";

// Drives the real connection form (issues #109, #531): one page of sections
// instead of tabs, engine cards instead of a dropdown, an optional name, and a
// side index that says which section still wants something.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

const blank: Connection = { id: "conn-1", name: "", driver: "sqlite", params: {} };

function mount(over: {
  initial?: Connection;
  onSave?: (c: Connection) => void;
  onSaveAndConnect?: (c: Connection) => void;
  onTest?: (c: Connection) => Promise<void>;
  onListDatabases?: (c: Connection) => Promise<string[]>;
}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionForm
          initial={over.initial ?? blank}
          onSave={over.onSave ?? (() => {})}
          onCancel={() => {}}
          onTest={over.onTest ?? (async () => {})}
          onSaveAndConnect={over.onSaveAndConnect}
          onListDatabases={over.onListDatabases}
        />
      ),
      host!,
    );
  });
}

const clickText = (text: string) => {
  const btn = [...host!.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement;
  btn.click();
};

/** The section headings actually on the page. */
const sectionTitles = () =>
  [...host!.querySelectorAll(".cf-section-title")].map((h) => h.textContent ?? "");

/** The side index, by the accessible name of each entry ("Servidor: completa"). */
const indexNames = () =>
  [...host!.querySelectorAll<HTMLButtonElement>(".cf-index-item")].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );

const mysql = (params: Record<string, string> = {}): Connection => ({
  id: "c",
  name: "",
  driver: "mysql",
  params,
});

describe("ConnectionForm sections", () => {
  // The tabs are the thing being removed: they are what hid the tunnel, since
  // the model turns it on by ssh_host having a value and nothing said so.
  it("has no tabs any more", () => {
    mount({ initial: mysql() });
    expect(host!.querySelector(".form-tabs")).toBeNull();
  });

  it("lays a server engine out in the order of the task", () => {
    mount({ initial: mysql() });
    expect(sectionTitles()).toEqual([
      "Motor",
      "Servidor",
      "Acceso",
      "Seguridad",
      "Túnel SSH",
      "Apariencia",
    ]);
  });

  // SQLite is a file on disk: no host, no credentials, no tunnel. Empty
  // headings would be worse than no headings.
  it("gives SQLite a file section and nothing about servers", () => {
    mount({});
    expect(sectionTitles()).toEqual(["Motor", "Archivo", "Apariencia"]);
  });

  it("shows the engine's own fields at once, with no tab to open", () => {
    mount({ initial: mysql() });
    const labels = [...host!.querySelectorAll(".cf-label")].map((s) => s.textContent ?? "");
    expect(labels.some((l) => l.startsWith("Host"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Usuario"))).toBe(true);
  });

  it("marks the fields that are not required", () => {
    mount({ initial: mysql() });
    expect(host!.querySelectorAll(".cf-optional").length).toBeGreaterThan(0);
  });
});

describe("ConnectionForm engine cards", () => {
  it("offers the engines as cards rather than a dropdown", () => {
    mount({});
    const cards = host!.querySelectorAll<HTMLButtonElement>(".cf-engine");
    expect(cards.length).toBeGreaterThan(1);
    expect(host!.querySelector("select[value]")).toBeNull();
    const on = [...cards].filter((c) => c.getAttribute("aria-checked") === "true");
    expect(on).toHaveLength(1);
  });

  it("switching engine swaps the sections and clears what was typed", () => {
    mount({ initial: { id: "c", name: "", driver: "sqlite", params: { path: "/tmp/a.db" } } });
    expect(sectionTitles()).toContain("Archivo");
    const mysqlCard = [...host!.querySelectorAll<HTMLButtonElement>(".cf-engine")].find((c) =>
      c.textContent?.includes("MySQL"),
    )!;
    mysqlCard.click();
    expect(sectionTitles()).toContain("Servidor");
    expect(sectionTitles()).not.toContain("Archivo");
  });
});

describe("ConnectionForm side index", () => {
  it("names each section and its state, in words", () => {
    mount({ initial: mysql() });
    expect(indexNames()).toContain("Servidor: falta algo");
    // The tunnel is off until there is a host to tunnel to — which is exactly
    // what the model means.
    expect(indexNames()).toContain("Túnel SSH: apagado");
  });

  it("says a section is complete once its required fields are filled", () => {
    mount({ initial: mysql({ host: "127.0.0.1", user: "root" }) });
    expect(indexNames()).toContain("Servidor: completa");
    expect(indexNames()).toContain("Acceso: completa");
  });

  // Regression: the entries were called "Acceso y base de datos" and "Nombre y
  // apariencia", each CONTAINING the name of a field inside it. Anything asking
  // for the "Base de datos" box by label — a test, or a screen-reader user
  // hunting by name — landed on the index button instead. It cost three e2e
  // failures before the cause was visible.
  it("never repeats the name of a field it contains", () => {
    mount({ initial: mysql() });
    // The label's own text, without the "opcional" tag glued after it.
    const fieldNames = [...host!.querySelectorAll(".cf-label")]
      .map((s) => (s.firstChild?.textContent ?? "").trim())
      .filter((n) => n.length > 2);
    expect(fieldNames.length).toBeGreaterThan(0);
    for (const entry of indexNames()) {
      for (const name of fieldNames) {
        expect(
          entry.toLowerCase().includes(name.toLowerCase()),
          `the index entry "${entry}" swallows the field "${name}"`,
        ).toBe(false);
      }
    }
  });

  // A brand-new form that already complains about three fields nobody has
  // touched is noise: red only after trying.
  it("only reports errors once the user has tried to save", () => {
    mount({ initial: mysql() });
    expect(indexNames().some((n) => n.includes("con errores"))).toBe(false);
    clickText("Guardar");
    expect(indexNames()).toContain("Servidor: con errores");
  });

  it("marks the tunnel as on once it has a host", () => {
    mount({ initial: mysql({ host: "h", user: "u", ssh_host: "bastion" }) });
    expect(indexNames()).toContain("Túnel SSH: completa");
  });
});

describe("ConnectionForm name", () => {
  // The name used to block saving, which asked the user to invent one before
  // knowing what they were connecting to.
  it("saves without a name, using the one the details already imply", () => {
    const onSave = vi.fn();
    mount({ initial: mysql({ host: "10.0.4.12", user: "root", database: "ventas" }), onSave });
    clickText("Guardar");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].name).toBe("ventas @ 10.0.4.12");
  });

  it("shows that deduced name as the placeholder while the field is empty", () => {
    mount({ initial: mysql({ host: "10.0.4.12", database: "ventas" }) });
    const input = [...host!.querySelectorAll<HTMLInputElement>("input")].find(
      (i) => i.placeholder === "ventas @ 10.0.4.12",
    );
    expect(input).toBeDefined();
  });

  it("never overwrites a name the user typed", () => {
    const onSave = vi.fn();
    mount({
      initial: { id: "c", name: "Producción", driver: "mysql", params: { host: "h", user: "u" } },
      onSave,
    });
    clickText("Guardar");
    expect(onSave.mock.calls[0][0].name).toBe("Producción");
  });

  it("falls back to the engine when there is nothing to deduce from", () => {
    const onSave = vi.fn();
    mount({ initial: { id: "c", name: "", driver: "sqlite", params: { path: ":memory:" } }, onSave });
    clickText("Guardar");
    expect(onSave.mock.calls[0][0].name).toBe(":memory:");
  });
});

describe("ConnectionForm validation", () => {
  it("blocks save and shows inline errors when required fields are empty", () => {
    const onSave = vi.fn();
    mount({ onSave });
    clickText("Guardar");
    expect(onSave).not.toHaveBeenCalled();
    expect(host!.querySelectorAll(".field-error").length).toBeGreaterThan(0);
  });

  it("saves when the form is valid", () => {
    const onSave = vi.fn();
    mount({
      initial: { id: "c", name: "Local", driver: "sqlite", params: { path: "/tmp/a.db" } },
      onSave,
    });
    clickText("Guardar");
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("ConnectionForm save and connect", () => {
  it("is not drawn unless the caller can act on it", () => {
    mount({});
    expect(
      [...host!.querySelectorAll("button")].some(
        (b) => b.textContent?.trim() === "Guardar y conectar",
      ),
    ).toBe(false);
  });

  it("saves and hands the connection over, name filled in", () => {
    const onSaveAndConnect = vi.fn();
    mount({
      initial: mysql({ host: "10.0.4.12", user: "root", database: "ventas" }),
      onSaveAndConnect,
    });
    clickText("Guardar y conectar");
    expect(onSaveAndConnect).toHaveBeenCalledTimes(1);
    expect(onSaveAndConnect.mock.calls[0][0].name).toBe("ventas @ 10.0.4.12");
  });

  it("refuses an incomplete connection, like saving does", () => {
    const onSaveAndConnect = vi.fn();
    mount({ initial: mysql(), onSaveAndConnect });
    clickText("Guardar y conectar");
    expect(onSaveAndConnect).not.toHaveBeenCalled();
  });
});

describe("ConnectionForm security", () => {
  const segments = () =>
    [...host!.querySelectorAll<HTMLButtonElement>(".cf-seg-btn")].map(
      (b) => b.textContent?.trim() ?? "",
    );
  const hint = () => host!.querySelector(".cf-hint")?.textContent ?? "";
  /** By prefix: some option labels carry a parenthesis ("Estricto (TDS 8…)"). */
  const pick = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>(".cf-seg-btn")]
      .find((b) => (b.textContent ?? "").trim().startsWith(label))!
      .click();

  // The dropdown said "verify_ca" and left the user to work out what that
  // protects. Every choice is visible, and each one says what it does.
  it("lays the modes out in the open, with a sentence for the chosen one", () => {
    mount({ initial: mysql() });
    expect(segments()).toContain("Verificar CA");
    expect(hint()).toMatch(/cifra/i);
  });

  it("changes the sentence with the mode", () => {
    mount({ initial: mysql() });
    pick("Desactivado");
    expect(hint()).toMatch(/en claro/i);
    pick("Verificar identidad");
    expect(hint()).toMatch(/nombre del servidor/i);
  });

  // Offering certificate boxes where the driver cannot read them would promise
  // a check that never happens.
  it("asks for certificates only in the modes that verify one", () => {
    mount({ initial: mysql() });
    const caShown = () =>
      [...host!.querySelectorAll(".cf-label")].some((s) =>
        (s.textContent ?? "").startsWith("Certificado CA"),
      );
    expect(caShown()).toBe(false);
    pick("Verificar CA");
    expect(caShown()).toBe(true);
    pick("Desactivado");
    expect(caShown()).toBe(false);
  });

  it("offers no certificates for an engine whose driver cannot check one", () => {
    // SQL Server encrypts but db-lib takes no CA file.
    mount({ initial: { id: "c", name: "", driver: "mssql", params: {} } });
    pick("Estricto");
    expect(
      [...host!.querySelectorAll(".cf-label")].some((s) =>
        (s.textContent ?? "").startsWith("Certificado"),
      ),
    ).toBe(false);
  });
});

describe("ConnectionForm SSH tunnel", () => {
  const sshSwitch = () => host!.querySelector<HTMLInputElement>(".cf-switch input")!;
  const sshHostShown = () =>
    [...host!.querySelectorAll(".cf-label")].some((s) =>
      (s.textContent ?? "").startsWith("Host SSH"),
    );
  const toggle = () => {
    const box = sshSwitch();
    box.checked = !box.checked;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // The whole point of the redesign: the tunnel used to turn itself on by
  // typing into a field of a tab nobody had opened.
  it("is off on a new connection, and says so with a switch", () => {
    mount({ initial: mysql() });
    expect(sshSwitch().checked).toBe(false);
    expect(sshHostShown()).toBe(false);
  });

  it("reveals its fields when switched on", () => {
    mount({ initial: mysql() });
    toggle();
    expect(sshHostShown()).toBe(true);
  });

  // The model has no flag: a saved connection is tunnelling precisely when it
  // has a host, so editing one arrives with the switch already on.
  it("arrives on for a connection that already tunnels", () => {
    mount({ initial: mysql({ host: "h", user: "u", ssh_host: "bastion" }) });
    expect(sshSwitch().checked).toBe(true);
    expect(sshHostShown()).toBe(true);
  });

  it("wants somewhere to tunnel to once it is on", () => {
    const onSave = vi.fn();
    mount({ initial: mysql({ host: "h", user: "u" }), onSave });
    toggle();
    clickText("Guardar");
    expect(onSave).not.toHaveBeenCalled();
    expect(indexNames()).toContain("Túnel SSH: con errores");
  });

  // Leaving an ssh_host behind would keep tunnelling silently — the very thing
  // the switch exists to make visible.
  it("drops every ssh_* key when saved with the tunnel off", () => {
    const onSave = vi.fn();
    mount({
      initial: mysql({ host: "h", user: "u", ssh_host: "bastion", ssh_user: "root" }),
      onSave,
    });
    toggle(); // off
    clickText("Guardar");
    const saved = onSave.mock.calls[0][0].params;
    expect(Object.keys(saved).some((k) => k.startsWith("ssh_"))).toBe(false);
    expect(saved.host).toBe("h");
  });

  it("keeps what was typed while the switch is off, so turning it back on restores it", () => {
    const onSave = vi.fn();
    mount({ initial: mysql({ host: "h", user: "u", ssh_host: "bastion" }), onSave });
    toggle(); // off
    toggle(); // on again
    clickText("Guardar");
    expect(onSave.mock.calls[0][0].params.ssh_host).toBe("bastion");
  });

  it("folds away the options nobody fills on a first connection", () => {
    mount({ initial: mysql({ ssh_host: "bastion" }) });
    const advanced = host!.querySelector("details.cf-advanced")!;
    expect(advanced).not.toBeNull();
    expect((advanced as HTMLDetailsElement).open).toBe(false);
    expect(advanced.textContent).toContain("Host destino");
  });
});

describe("ConnectionForm preview and test card", () => {
  it("previews the connection as the bar will draw it", () => {
    mount({ initial: mysql({ host: "10.0.4.12", database: "ventas" }) });
    const preview = host!.querySelector(".cf-preview")!;
    expect(preview.textContent).toContain("MY"); // monogram
    expect(preview.textContent).toContain("ventas @ 10.0.4.12"); // deduced name
    expect(preview.textContent).toContain("MySQL / MariaDB");
  });

  it("starts by saying it has not been tested", () => {
    mount({});
    expect(host!.querySelector(".cf-test")!.textContent).toContain("Sin probar");
  });

  // The core reports no latency, so the number is measured here — showing one
  // nobody measured would be worse than showing none.
  it("reports how long a successful test took", async () => {
    mount({
      initial: { id: "c", name: "L", driver: "sqlite", params: { path: "/tmp/a.db" } },
      onTest: async () => {},
    });
    clickText("Probar conexión");
    await flush();
    const card = host!.querySelector(".cf-test")!;
    expect(card.getAttribute("data-state")).toBe("ok");
    expect(card.textContent).toMatch(/\d+ ms/);
  });
});

describe("ConnectionForm database picker", () => {
  it("loads the database list and offers it as a dropdown", async () => {
    const onListDatabases = vi.fn(async () => ["appdb", "reporting"]);
    mount({
      initial: { id: "c", name: "MY", driver: "mysql", params: { host: "h", user: "root" } },
      onListDatabases,
    });
    clickText("Listar");
    await flush();
    expect(onListDatabases).toHaveBeenCalledTimes(1);
    const select = host!.querySelector("select.db-picker-select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const opts = [...select.options].map((o) => o.value);
    expect(opts).toContain("appdb");
    expect(opts).toContain("reporting");
  });

  it("shows no picker button when onListDatabases is absent", () => {
    mount({ initial: { id: "c", name: "MY", driver: "mysql", params: {} } });
    expect(
      [...host!.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Listar"),
    ).toBe(false);
  });
});

describe("ConnectionForm test-connection feedback", () => {
  it("renders an actionable message when the test fails", async () => {
    const onTest = () => Promise.reject(new QueryError("refused", -32000));
    mount({
      initial: { id: "c", name: "Local", driver: "sqlite", params: { path: "/tmp/a.db" } },
      onTest,
    });
    clickText("Probar conexión");
    await flush();
    const err = host!.querySelector(".test-error");
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/No se pudo conectar/);
  });
});
