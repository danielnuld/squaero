import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { SqlEditor } from "../../src/components/SqlEditor";

// Drives the real CodeMirror-backed editor in jsdom to check the format wiring
// (issue #106): bumping formatTick reformats the current document and persists
// it via onChange.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

describe("SqlEditor formatting", () => {
  it("reformats the document when formatTick is bumped", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [tick, setTick] = createSignal(0);
    let lastSql = "select a,b from t where x=1";

    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => "select a,b from t where x=1"}
            onChange={(_id, sql) => (lastSql = sql)}
            onRun={() => {}}
            dialect="sqlite"
            formatTick={tick()}
          />
        ),
        host!,
      );
    });

    setTick(1); // request a format
    expect(lastSql).toContain("SELECT");
    expect(lastSql.split("\n").length).toBeGreaterThan(1);
  });
});
