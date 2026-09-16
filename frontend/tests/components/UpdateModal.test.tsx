import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { UpdateModal } from "../../src/components/UpdateModal";
import type { UpdateInfo } from "../../src/utils/update";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const update: UpdateInfo = {
  version: "9.9.9",
  notes: "",
  releaseUrl: "https://github.com/danielnuld/squaero/releases/tag/v9.9.9",
  downloadUrl: "https://github.com/danielnuld/squaero/releases/download/v9.9.9/squaero-9.9.9-x86.msi",
};

function mount(props: { onInstall?: (url: string) => Promise<boolean> }) {
  const onDownload = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <UpdateModal
          update={update}
          currentVersion="1.0.0"
          onClose={() => {}}
          onSkip={() => {}}
          onDownload={onDownload}
          onInstall={props.onInstall}
        />
      ),
      host!,
    );
  });
  return onDownload;
}

describe("UpdateModal", () => {
  it("without the native installer, sends the user to the release page, never the MSI", () => {
    const onDownload = mount({});
    const primary = host!.querySelector<HTMLButtonElement>(".update-actions button.primary")!;
    primary.click();
    expect(onDownload).toHaveBeenCalledWith(update.releaseUrl);
  });

  it("with the native installer, still offers the MSI in the browser", () => {
    const onDownload = mount({ onInstall: async () => true });
    host!.querySelector<HTMLButtonElement>(".update-browser")!.click();
    expect(onDownload).toHaveBeenCalledWith(update.downloadUrl);
  });
});
