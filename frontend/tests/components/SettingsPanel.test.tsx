import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { SettingsPanel } from "../../src/components/SettingsPanel";
import { DEFAULT_SETTINGS, type Settings } from "../../src/utils/settings";
import { APP_VERSION } from "../../src/utils/version";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as { quaeroRpc?: unknown }).quaeroRpc;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(over: {
  theme?: "system" | "light" | "dark";
  skin?: "indigo" | "blue";
  settings?: Settings;
  onSetTheme?: (p: "system" | "light" | "dark") => void;
  onSetSkin?: (s: "indigo" | "blue") => void;
  onSetHistoryLimit?: (n: number) => void;
  onSetSettings?: (p: Partial<Settings>) => void;
} = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <SettingsPanel
          theme={over.theme ?? "system"}
          onSetTheme={over.onSetTheme ?? (() => {})}
          skin={over.skin ?? "indigo"}
          onSetSkin={over.onSetSkin ?? (() => {})}
          historyLimit={200}
          onSetHistoryLimit={over.onSetHistoryLimit ?? (() => {})}
          settings={over.settings ?? DEFAULT_SETTINGS}
          onSetSettings={over.onSetSettings ?? (() => {})}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
}

describe("SettingsPanel", () => {
  it("marks the active theme and density chips", () => {
    mount({ theme: "dark", settings: { ...DEFAULT_SETTINGS, gridDensity: "compact" } });
    const active = [...host!.querySelectorAll(".chip.active")].map((c) => c.textContent);
    expect(active).toContain("Oscuro");
    expect(active).toContain("Compacta");
  });

  it("reports a theme change through the handler", () => {
    const onSetTheme = vi.fn();
    mount({ theme: "system", onSetTheme });
    const light = [...host!.querySelectorAll(".chip")].find((c) => c.textContent === "Claro")!;
    (light as HTMLButtonElement).click();
    expect(onSetTheme).toHaveBeenCalledWith("light");
  });

  it("reports an accent-skin change through the handler", () => {
    const onSetSkin = vi.fn();
    mount({ skin: "indigo", onSetSkin });
    const blue = [...host!.querySelectorAll(".chip")].find((c) => c.textContent === "Azul")!;
    (blue as HTMLButtonElement).click();
    expect(onSetSkin).toHaveBeenCalledWith("blue");
  });

  it("patches grid density and clamps the slow threshold", () => {
    const onSetSettings = vi.fn();
    mount({ onSetSettings });
    // density chip
    const compact = [...host!.querySelectorAll(".chip")].find((c) => c.textContent === "Compacta")!;
    (compact as HTMLButtonElement).click();
    expect(onSetSettings).toHaveBeenCalledWith({ gridDensity: "compact" });
    // slow threshold: a negative value clamps to 0
    const numbers = host!.querySelectorAll<HTMLInputElement>('input[type="number"]');
    numbers[0].value = "-50";
    numbers[0].dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetSettings).toHaveBeenCalledWith({ slowThresholdMs: 0 });
  });

  it("routes the history limit through its own handler (single store)", () => {
    const onSetHistoryLimit = vi.fn();
    mount({ onSetHistoryLimit });
    const numbers = host!.querySelectorAll<HTMLInputElement>('input[type="number"]');
    // second number input is the history limit
    numbers[1].value = "1"; // below MIN -> clamped to 10
    numbers[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetHistoryLimit).toHaveBeenCalledWith(10);
  });

  it("toggles check-updates-on-start", () => {
    const onSetSettings = vi.fn();
    mount({ settings: { ...DEFAULT_SETTINGS, checkUpdatesOnStart: true }, onSetSettings });
    const check = host!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    check.checked = false;
    check.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetSettings).toHaveBeenCalledWith({ checkUpdatesOnStart: false });
  });

  it("shows the injected app version and the core version from app.hello", async () => {
    (globalThis as { quaeroRpc?: (r: string) => Promise<unknown> }).quaeroRpc = async (raw) => {
      const req = JSON.parse(raw) as { id: number; method: string };
      expect(req.method).toBe("app.hello");
      return { jsonrpc: "2.0", id: req.id, result: { name: "quaero", coreVersion: "9.9.9", protocolVersion: 6 } };
    };
    mount();
    await flush();
    const about = host!.querySelector(".settings-about")!;
    expect(about.textContent).toContain(APP_VERSION);
    expect(about.textContent).toContain("9.9.9");
    expect(about.textContent).toContain("v6");
  });

  it("falls back to a dash when the bridge is unavailable", async () => {
    mount(); // no quaeroRpc installed -> call() throws
    await flush();
    const about = host!.querySelector(".settings-about")!;
    expect(about.textContent).toContain("—");
  });

  it("falls back to a dash for a well-formed envelope with an ill-typed payload", async () => {
    (globalThis as { quaeroRpc?: (r: string) => Promise<unknown> }).quaeroRpc = async (raw) => {
      const req = JSON.parse(raw) as { id: number };
      // coreVersion is a number, protocolVersion missing — must not be shown.
      return { jsonrpc: "2.0", id: req.id, result: { coreVersion: 123 } };
    };
    mount();
    await flush();
    const about = host!.querySelector(".settings-about")!;
    expect(about.textContent).toContain("—");
    expect(about.textContent).not.toContain("123");
  });
});
