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

// CodeMirror measures text by asking a Range for its client rects; jsdom's Range
// lacks getClientRects, which makes CM's async layer measurement throw (noisy,
// though harmless for our doc-level assertions). Provide empty rects so the SQL
// editor mounts quietly in tests.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () {
    return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  };
}
