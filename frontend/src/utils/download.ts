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

/** Somewhere to write one file, chosen before its content exists. */
export interface SaveTarget {
  write: (data: string | Blob) => Promise<void>;
}

/**
 * Ask WHERE to save, before there is anything to save (issue #479).
 *
 * showSaveFilePicker needs transient user activation, and an export that reads a
 * million rows first has long since lost it: the dialog then throws and the
 * button looks broken. So the caller opens the dialog inside the click, gets a
 * target back, and writes to it whenever the rows are ready.
 *
 * Null means the user dismissed the dialog — a no-op, not an error, and
 * deliberately NOT a download of a file they just cancelled. Where the API is
 * missing (older webviews, jsdom) the target falls back to a browser download.
 */
export async function pickSaveTarget(
  filename: string,
  mime: string,
): Promise<SaveTarget | null> {
  const picker = (globalThis as SaveFilePicker).showSaveFilePicker;
  if (typeof picker === "function") {
    const ext = extensionOf(filename);
    try {
      const handle = await picker({
        suggestedName: filename,
        types: ext ? [{ accept: { [mime]: [`.${ext}`] } }] : undefined,
      });
      return {
        write: async (data) => {
          const writable = await handle.createWritable();
          await writable.write(data);
          await writable.close();
        },
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      // Any other failure (API present but blocked): fall back to a download.
    }
  }
  return {
    write: async (data) => {
      if (typeof data === "string") {
        anchorDownload(filename, data, mime);
        return;
      }
      anchorDownloadBlob(filename, data);
    },
  };
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
  const target = await pickSaveTarget(filename, mime);
  await target?.write(content);
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
  // `new Uint8Array(bytes)` rather than `bytes`: TypeScript 5.7 made Uint8Array
  // generic over its buffer, and BlobPart only takes a view over a real
  // ArrayBuffer -- which a SharedArrayBuffer-backed one is not. The copy is what
  // makes that true rather than asserted, and an export is bytes we just built.
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const target = await pickSaveTarget(filename, mime);
  await target?.write(blob);
}
