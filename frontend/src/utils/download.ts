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
  name?: string;
  createWritable: () => Promise<{
    write: (data: string | Blob) => Promise<void>;
    close: () => Promise<void>;
    abort?: () => Promise<void>;
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

/** Somewhere to write one file, chosen before its content exists. */
export interface SaveTarget {
  /** The file's name as chosen (the suggested one where the dialog cannot say). */
  name: string;
  /** Begin writing. The caller writes any number of pieces, then closes. */
  open: () => Promise<SaveWriter>;
  /** Write the whole thing at once, for content that is already one value. */
  write: (data: string | Blob) => Promise<void>;
}

/**
 * An open file, written in pieces (issue #479). A million rows do not fit in one
 * JavaScript string — the export failed with "Invalid string length" — so the
 * caller hands over a chunk at a time and the file never exists whole in memory.
 */
export interface SaveWriter {
  write: (chunk: string | Blob) => Promise<void>;
  /** Finish. Nothing is guaranteed on disk until this resolves. */
  close: () => Promise<void>;
  /** Give up: what was written is discarded instead of saved (a Cancel). */
  abort: () => Promise<void>;
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
        name: handle.name ?? filename,
        open: async () => {
          const writable = await handle.createWritable();
          return {
            write: (chunk) => writable.write(chunk),
            close: () => writable.close(),
            abort: async () => void (await writable.abort?.()),
          };
        },
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
  // The download fallback has nowhere to stream to, so it keeps the pieces and
  // makes a Blob of them at the end. A Blob of many parts is not a string, so it
  // has no string-length ceiling — only memory.
  const download = (parts: (string | Blob)[]) =>
    anchorDownloadBlob(filename, new Blob(parts, { type: `${mime};charset=utf-8` }));
  return {
    name: filename,
    open: async () => {
      const parts: (string | Blob)[] = [];
      return {
        write: async (chunk) => {
          parts.push(chunk);
        },
        close: async () => download(parts),
        abort: async () => {
          parts.length = 0;
        },
      };
    },
    write: async (data) => download([data]),
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

/**
 * A file name for saving a tab's SQL (issue #553): the tab title with what
 * Windows forbids in a name removed, and `.sql` on the end unless it is there.
 */
export function sqlFileName(title: string): string {
  const base = title.replace(/[\/:*?"<>|\u0000-\u001f]/g, "").trim() || "consulta";
  return /\.sql$/i.test(base) ? base : `${base}.sql`;
}

/** The part of a FileSystemDirectoryHandle a folder dump needs. */
export interface DirectoryHandleLike {
  name: string;
  getDirectoryHandle: (name: string, opts: { create: boolean }) => Promise<DirectoryHandleLike>;
  getFileHandle: (name: string, opts: { create: boolean }) => Promise<FileSystemFileHandleLike>;
}

/**
 * Ask for a folder to write into (issue #673). Undefined means this webview has
 * no usable folder picker (WKWebView, WebKitGTK, jsdom) and the caller falls back;
 * null means the user dismissed the dialog. Call it inside the click, like
 * pickSaveTarget: the picker needs the user gesture.
 */
export async function pickDirectory(): Promise<DirectoryHandleLike | null | undefined> {
  const picker = (globalThis as {
    showDirectoryPicker?: (opts: { mode: "readwrite" }) => Promise<DirectoryHandleLike>;
  }).showDirectoryPicker;
  if (typeof picker !== "function") return undefined;
  try {
    return await picker({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    // Present but blocked: the zip fallback, as pickSaveTarget does.
    return undefined;
  }
}

/** Write `files` (paths with `/`) under `dir`, creating the subfolders. */
export async function writeFilesToDirectory(
  dir: DirectoryHandleLike,
  files: { path: string; content: string }[],
  onFile?: (done: number) => void,
): Promise<void> {
  for (const [i, f] of files.entries()) {
    const parts = f.path.split("/");
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const handle = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await handle.createWritable();
    await w.write(f.content);
    await w.close();
    onFile?.(i + 1);
  }
}
