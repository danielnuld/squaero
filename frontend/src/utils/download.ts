// Saving exported text to disk (issue #30 follow-up).
//
// The app runs inside a WebView2/Chromium shell. The original export path used
// an <a download> click, which surfaces the browser's download shelf — it works
// but reads like "a web page downloaded a file", not a desktop app. When the
// File System Access API is available (it is in WebView2/Edge), we instead open
// a native "Guardar como" dialog via showSaveFilePicker and write the file
// directly, with no download shelf. We fall back to the anchor-download when the
// API is missing (older webviews, jsdom in tests) so behavior degrades cleanly.

/** Minimal shape of the File System Access API we rely on. */
interface SaveFilePicker {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandleLike>;
}

interface FileSystemFileHandleLike {
  createWritable: () => Promise<{
    write: (data: string | Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

/** Fallback: trigger a browser download of an already-built Blob. */
function anchorDownloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** File extension of a name like "customers.csv" -> "csv" (lowercased). */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** Fallback: trigger a browser download via a transient <a download>. */
function anchorDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Save `content` to disk as `filename`. Prefers the native save dialog; falls
 * back to a browser download. Resolves once saved (or the download is
 * triggered); a user-cancelled dialog resolves without writing anything.
 */
export async function saveText(
  filename: string,
  content: string,
  mime: string,
): Promise<void> {
  const picker = (globalThis as SaveFilePicker).showSaveFilePicker;
  if (typeof picker === "function") {
    const ext = extensionOf(filename);
    try {
      const handle = await picker({
        suggestedName: filename,
        types: ext
          ? [{ accept: { [mime]: [`.${ext}`] } }]
          : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err) {
      // The user dismissing the dialog throws AbortError: treat as a no-op, not
      // an error, and do NOT fall through to a download (that would surprise
      // them with a file they just cancelled).
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Any other failure (API present but blocked): fall back to a download.
    }
  }
  anchorDownload(filename, content, mime);
}

/**
 * Save binary `bytes` to disk as `filename` (e.g. an XLSX workbook). Same native
 * "Guardar como" preference and download fallback as saveText; a cancelled
 * dialog resolves without writing.
 */
export async function saveBytes(
  filename: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  const blob = new Blob([bytes], { type: mime });
  const picker = (globalThis as SaveFilePicker).showSaveFilePicker;
  if (typeof picker === "function") {
    const ext = extensionOf(filename);
    try {
      const handle = await picker({
        suggestedName: filename,
        types: ext ? [{ accept: { [mime]: [`.${ext}`] } }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Any other failure: fall back to a download.
    }
  }
  anchorDownloadBlob(filename, blob);
}
