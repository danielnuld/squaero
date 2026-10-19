import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { Toast } from "../../src/components/Toast";

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.useRealTimers();
});
const mount = (error: boolean, onClose: () => void, autoHideMs?: number) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <Toast error={error} autoHideMs={autoHideMs} onClose={onClose}>
        <span>texto</span>
      </Toast>
    ),
    host,
  );
  return host.querySelector<HTMLElement>(".app-toast")!;
};

describe("Toast (R-30)", () => {
  it("announces an error at once and keeps it until it is closed", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const el = mount(true, onClose, 1000);
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.classList.contains("app-toast-error")).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(onClose).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>(".app-toast-close")!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets anything else leave by itself, as a polite status", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const el = mount(false, onClose, 1000);
    expect(el.getAttribute("role")).toBe("status");
    vi.advanceTimersByTime(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("waits while the pointer rests on it", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const el = mount(false, onClose, 1000);
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(5000);
    expect(onClose).not.toHaveBeenCalled();
    el.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays without a time limit", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    mount(false, onClose);
    vi.advanceTimersByTime(60_000);
    expect(onClose).not.toHaveBeenCalled();
  });
});
