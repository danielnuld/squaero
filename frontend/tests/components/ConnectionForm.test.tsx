import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionForm } from "../../src/components/ConnectionForm";
import { QueryError } from "../../src/utils/query";
import type { Connection } from "../../src/utils/connections";

// Drives the real connection form (issue #109): per-field validation gating,
// engine icon, and an actionable test-connection error.

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
  onTest?: (c: Connection) => Promise<void>;
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
        />
      ),
      host!,
    );
  });
}

const clickText = (text: string) => {
  const btn = [...host!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement;
  btn.click();
};

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

  it("shows an engine icon in the title", () => {
    mount({});
    expect(host!.querySelector(".engine-icon")).not.toBeNull();
  });
});

describe("ConnectionForm tabs", () => {
  const visibleFieldLabels = () =>
    [...host!.querySelectorAll(".field > span")].map((s) => s.textContent ?? "");

  it("shows no tab bar for a driver without groups (sqlite)", () => {
    mount({});
    expect(host!.querySelector(".form-tabs")).toBeNull();
  });

  it("splits grouped fields behind tabs and only renders the active tab", () => {
    mount({ initial: { id: "c", name: "", driver: "mysql", params: {} } });
    // A tab bar appears (mysql declares SSL + SSH groups).
    expect(host!.querySelector(".form-tabs")).not.toBeNull();
    // General tab is active: base fields shown, SSH/SSL fields hidden.
    expect(visibleFieldLabels().some((l) => l.startsWith("Host"))).toBe(true);
    expect(visibleFieldLabels().some((l) => l.startsWith("Host SSH"))).toBe(false);
    // Switch to the SSH tab -> SSH fields appear, base fields gone.
    clickText("Túnel SSH");
    expect(visibleFieldLabels().some((l) => l.startsWith("Host SSH"))).toBe(true);
  });
});

describe("ConnectionForm test-connection feedback", () => {
  it("renders an actionable message when the test fails", async () => {
    const onTest = () => Promise.reject(new QueryError("refused", -32000));
    mount({
      initial: { id: "c", name: "Local", driver: "sqlite", params: { path: "/tmp/a.db" } },
      onTest,
    });
    clickText("Probar");
    await flush();
    const err = host!.querySelector(".test-error");
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/No se pudo conectar/);
  });
});
