// Test-environment polyfills. jsdom does not implement ResizeObserver, which the
// virtualized grid uses to track its viewport height; the real webview provides
// it. A no-op stub is enough for component tests (the grid falls back to its
// overscan when the viewport measures 0).
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub;
}
