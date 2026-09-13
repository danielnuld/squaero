import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionForm } from "../../src/components/ConnectionForm";
import { INFORMIX_CSDK_URL } from "../../src/utils/errors";
import { QueryError } from "../../src/utils/query";
import type { Connection } from "../../src/utils/connections";

// Testing an Informix connection on a machine with no IBM client (issue #506):
// the form says what to install and links to IBM, instead of an ODBC code.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as { quaeroOpenExternal?: unknown }).quaeroOpenExternal;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

const informix: Connection = {
  id: "ifx",
  name: "Informix",
  driver: "informix",
  params: { host: "127.0.0.1", port: "9088", server: "informix", user: "informix" },
};

function mount(onTest: (c: Connection) => Promise<void>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionForm initial={informix} onSave={() => {}} onCancel={() => {}} onTest={onTest} />
      ),
      host!,
    );
  });
}

const button = (text: string) =>
  [...host!.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;

describe("ConnectionForm — Informix client missing", () => {
  it("shows install guidance and opens IBM's download page in the browser", async () => {
    const open = vi.fn();
    (globalThis as { quaeroOpenExternal?: unknown }).quaeroOpenExternal = open;
    mount(async () => {
      throw new QueryError(
        "IFX_CLIENT_MISSING: the IBM Informix Client SDK (32-bit) was not found [connect: [IM002] …]",
        -32000,
      );
    });

    button("Probar conexión")!.click();
    await flush();

    const error = host!.querySelector(".test-error")!;
    expect(error.textContent).toContain("Client SDK");
    // The raw marker and ODBC diagnostic are not what the user reads.
    expect(error.textContent).not.toContain("IFX_CLIENT_MISSING");
    expect(error.textContent).not.toContain("IM002");

    const link = button("Dónde descargar");
    expect(link).toBeDefined();
    link!.click();
    expect(open).toHaveBeenCalledWith(INFORMIX_CSDK_URL);
  });

  it("keeps the ordinary error, and no download link, for other failures", async () => {
    mount(async () => {
      throw new QueryError("connect: [08004] Attempt to connect to database server failed", -32000);
    });

    button("Probar conexión")!.click();
    await flush();

    expect(host!.querySelector(".test-error")!.textContent).toContain("08004");
    expect(button("Dónde descargar")).toBeUndefined();
  });
});
