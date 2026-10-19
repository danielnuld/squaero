import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { Panel } from "./Panel";
import { schemaTree, schemaDescribe, parseTreeRows } from "../utils/schema";
import { runQuery } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  inferRelations,
  realEdges,
  ER_BOX,
  boxHeight,
  rowY,
  packGrid,
  relationOrder,
  routeEdge,
  pathD,
  endMark,
  fitZoom,
  type ErTable,
  type ErColumn,
  type ErEdge,
  type Pt,
  type Rect,
} from "../utils/erDiagram";
import { foreignKeysFor, parseForeignKeys, type ForeignKey, type ForeignKeyQuery } from "../utils/foreignKeys";
import { openContextMenu } from "../utils/contextMenu";
import { saveBytes, saveText } from "../utils/download";
import { t, tn } from "../utils/i18n";
import { Icon, ObjectIcon } from "./icons";

// Entity-relationship diagram (issue #145, audit A-31): every table a box with
// its columns, every relation an orthogonal edge from the foreign-key column's
// row to the referenced column's row, routed around the other boxes, with the
// crow's-foot notation (one bar pair on the key, circle and foot on the many
// side). Views are dashed. Relations come from the engine's REAL foreign keys
// when it exposes them (#260); naming inference stays as the honest
// alternative, and the toolbar says which one is drawn. Boxes drag with the
// mouse and move with the arrows; the canvas fits the window (Ctrl+0), exports
// as SVG or PNG and carries a legend and a minimap. Geometry is pure in
// utils/erDiagram.ts.
const CELL_W = ER_BOX.w + 90;
const GAP_Y = 60;
const MAX_TABLES = 40;
const MINI_W = 160;

/** Walk the object tree (bounded) and describe each table into ErTable[]. When
    `db` is given the walk is scoped to that database (working-database context). */
async function loadTables(connId: string, db: string | undefined, max = MAX_TABLES): Promise<ErTable[]> {
  const targets: { table: string; db?: string; schema?: string; view: boolean }[] = [];
  const leaf = (n: { name: string; kind: string }, at: { db?: string; schema?: string }) =>
    targets.push({ table: n.name, ...at, view: n.kind === "view" });
  if (db) {
    const level1 = parseTreeRows(await schemaTree(connId, db), "schema");
    for (const n1 of level1) {
      if (targets.length >= max) break;
      if (n1.kind === "table" || n1.kind === "view") {
        leaf(n1, { db });
        continue;
      }
      const level2 = parseTreeRows(await schemaTree(connId, db, n1.name), "schema");
      for (const n2 of level2) {
        if (targets.length >= max) break;
        leaf(n2, { db, schema: n1.name });
      }
    }
  } else {
    const level0 = parseTreeRows(await schemaTree(connId), "database");
    for (const n0 of level0) {
      if (targets.length >= max) break;
      if (n0.kind === "table" || n0.kind === "view") {
        leaf(n0, {});
        continue;
      }
      const level1 = parseTreeRows(await schemaTree(connId, n0.name), "schema");
      for (const n1 of level1) {
        if (targets.length >= max) break;
        if (n1.kind === "table" || n1.kind === "view") {
          leaf(n1, { db: n0.name });
          continue;
        }
        const level2 = parseTreeRows(await schemaTree(connId, n0.name, n1.name), "schema");
        for (const n2 of level2) {
          if (targets.length >= max) break;
          leaf(n2, { db: n0.name, schema: n1.name });
        }
      }
    }
  }

  const tables: ErTable[] = [];
  for (const t of targets) {
    try {
      const desc = await schemaDescribe(connId, t.table, t.db, t.schema);
      const ni = desc.columns.findIndex((c) => c.name === "name");
      const ti = desc.columns.findIndex((c) => c.name === "type");
      const pi = desc.columns.findIndex((c) => c.name === "pk");
      const columns: ErColumn[] = desc.rows
        .map((r) => ({
          name: ni >= 0 ? (r[ni] ?? "") : "",
          type: ti >= 0 ? (r[ti] ?? "") : "",
          pk: pi >= 0 && (r[pi] ?? "0") !== "0",
        }))
        .filter((c) => c.name);
      tables.push({ name: t.table, columns, view: t.view });
    } catch {
      /* skip a table that fails to describe */
    }
  }
  return tables;
}

/** Fetch and parse the engine's real foreign keys for a supported plan.
    `truncated` is true if the FK query hit the core's row cap, so the caller can
    warn that the graph may be incomplete (docs/IPC.md: query.run caps silently
    when no limit is given). */
async function fetchForeignKeys(
  connId: string,
  plan: ForeignKeyQuery,
): Promise<{ fks: ForeignKey[]; truncated: boolean }> {
  const r = await runQuery(connId, plan.bulkSql!);
  return { fks: parseForeignKeys(r.columns, r.rows), truncated: r.truncated };
}

/** The computed style an exported SVG needs, since the stylesheet stays behind. */
const EXPORT_PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size", "font-weight", "opacity"];

export function ErDiagram(props: {
  connId: string;
  engine: string;
  db?: string;
  onClose: () => void;
  /** Intro on a box: open that table or view. Absent → boxes only move. */
  onOpenTable?: (name: string, view: boolean) => void;
}) {
  const [tables, setTables] = createSignal<ErTable[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [pos, setPos] = createStore<Record<string, Pt>>({});
  const [zoom, setZoom] = createSignal(1);
  const clampZoom = (z: number) => Math.min(2, Math.max(0.25, Math.round(z * 20) / 20));
  const zoomBy = (f: number) => setZoom((z) => clampZoom(z * f));
  const [selected, setSelected] = createSignal<string | null>(null);
  const [showTypes, setShowTypes] = createSignal(true);
  const [hideViews, setHideViews] = createSignal(false);
  let scroller: HTMLDivElement | undefined;
  let svgEl: SVGSVGElement | undefined;

  // Both edge sets are kept: the real foreign keys (null when the engine has
  // none or the query failed) and the naming inference, and the toolbar picks.
  const [realList, setRealList] = createSignal<ErEdge[] | null>(null);
  const [inferred, setInferred] = createSignal<ErEdge[]>([]);
  const [mode, setMode] = createSignal<"fk" | "inferred">("fk");
  const [fkTruncated, setFkTruncated] = createSignal(false);
  const [fkReason, setFkReason] = createSignal<string | null>(null);
  const realFks = () => mode() === "fk" && realList() !== null;
  const edges = () => (realFks() ? realList()! : inferred());

  const shown = createMemo(() => tables().filter((tb) => !(hideViews() && tb.view)));
  const byName = createMemo(() => new Map(tables().map((tb) => [tb.name, tb])));
  const height = (tb: ErTable) => boxHeight(tb.columns.length);
  const rect = (tb: ErTable): Rect => {
    const p = pos[tb.name] ?? { x: 0, y: 0 };
    return { x: p.x, y: p.y, w: ER_BOX.w, h: height(tb) };
  };

  // Canvas extent so the scroll area fits every box.
  const extent = createMemo(() => {
    let w = 400;
    let h = 300;
    for (const tb of shown()) {
      const r = rect(tb);
      w = Math.max(w, r.x + r.w + 48);
      h = Math.max(h, r.y + r.h + 48);
    }
    return { w, h };
  });

  /** Lays the boxes out in a grid, related tables next to each other. */
  const layout = (ts: ErTable[], es: ErEdge[]) => {
    const order = relationOrder(ts, es);
    const map = new Map(ts.map((tb) => [tb.name, tb]));
    const cols = Math.max(1, Math.ceil(Math.sqrt(ts.length)));
    const grid = packGrid(order.map((n) => height(map.get(n)!)), cols, CELL_W, GAP_Y);
    const p: Record<string, Pt> = {};
    order.forEach((n, i) => (p[n] = grid[i]));
    setPos(p);
  };

  // (Re)load whenever the connection, engine or working database changes.
  createEffect(() => {
    const connId = props.connId;
    const engine = props.engine;
    const db = props.db;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const ts = await loadTables(connId, db);
        if (props.connId !== connId || props.db !== db) return; // superseded
        const names = ts.map((tb) => tb.name);
        // A view references nothing by key; only tables are inferred from.
        const guessed = inferRelations(ts.filter((tb) => !tb.view));
        // Prefer the engine's real foreign keys; fall back to naming inference
        // when the engine exposes none (with its honest reason) or if the FK
        // query fails (permissions/odd catalog).
        const plan = foreignKeysFor(engine, db);
        let real: ErEdge[] | null = null;
        let truncated = false;
        if (plan.supported && plan.bulkSql) {
          try {
            const res = await fetchForeignKeys(connId, plan);
            if (props.connId !== connId || props.db !== db) return; // superseded
            real = realEdges(res.fks, names);
            truncated = res.truncated;
          } catch {
            real = null; // FK query failed → honest name inference
          }
        }
        setFkReason(plan.supported ? null : plan.reason);
        setFkTruncated(truncated);
        setRealList(real);
        setInferred(guessed);
        setMode(real ? "fk" : "inferred");
        layout(ts, real ?? guessed);
        setTables(ts);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    })();
  });

  const relayout = () => layout(tables(), edges());

  // --- Edges ---------------------------------------------------------------
  const anchorRow = (tb: ErTable, column?: string) => {
    const i = column ? tb.columns.findIndex((c) => c.name === column) : tb.columns.findIndex((c) => c.pk);
    return i;
  };
  const drawn = createMemo(() => {
    const visible = new Set(shown().map((tb) => tb.name));
    return edges()
      .filter((e) => visible.has(e.fromTable) && visible.has(e.toTable))
      .map((e) => {
        const from = byName().get(e.fromTable)!;
        const to = byName().get(e.toTable)!;
        const a = rect(from);
        const b = rect(to);
        const fi = anchorRow(from, e.fromColumn);
        const ti = anchorRow(to, e.toColumn);
        const ay = fi >= 0 ? rowY(a.y, fi) : a.y + ER_BOX.header / 2;
        const by = ti >= 0 ? rowY(b.y, ti) : b.y + ER_BOX.header / 2;
        const others = shown().filter((tb) => tb !== from && tb !== to).map(rect);
        const route = routeEdge(a, ay, b, by, others);
        const pts = route.points;
        return {
          edge: e,
          d: pathD(pts),
          many: endMark("many", pts[0], route.intoFrom),
          one: endMark("one", pts[pts.length - 1], route.intoTo),
          active: selected() === e.fromTable || selected() === e.toTable,
        };
      });
  });
  const fkColumns = createMemo(() => new Set(edges().map((e) => `${e.fromTable}\u0000${e.fromColumn}`)));

  const relationText = (e: ErEdge) =>
    t("er.desc.edge", { from: `${e.fromTable}.${e.fromColumn}`, to: e.toColumn ? `${e.toTable}.${e.toColumn}` : e.toTable });
  /** What the drawing says, for the role="img" of the edge layer. */
  const description = () => {
    const parts = [t("er.desc.title", { db: props.db ?? "" })];
    const es = drawn().map((d) => d.edge);
    if (!es.length) parts.push(t("er.desc.none"));
    for (const e of es) parts.push(relationText(e));
    for (const tb of shown()) if (tb.view) parts.push(t("er.desc.view", { name: tb.name }));
    return parts.join(" ");
  };
  const boxLabel = (tb: ErTable) => {
    const n = edges().filter((e) => e.fromTable === tb.name || e.toTable === tb.name).length;
    return [
      t(tb.view ? "er.box.view" : "er.box.table", { name: tb.name }),
      tn("er.nColumns", tb.columns.length),
      tn("er.nRelations", n),
      selected() === tb.name ? t("er.box.selected") : "",
    ]
      .filter(Boolean)
      .join(", ");
  };

  // --- Moving boxes --------------------------------------------------------
  // Drag a box (anywhere on it) — screen deltas are divided by the zoom so the box
  // tracks the cursor 1:1 at any scale, and the dragged table is moved to the end
  // of the list so it renders on top of the others.
  const raise = (name: string) =>
    setTables((ts) => [...ts.filter((tb) => tb.name !== name), ...ts.filter((tb) => tb.name === name)]);
  const startDrag = (name: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(name);
    raise(name);
    const start = pos[name] ?? { x: 0, y: 0 };
    const ox = e.clientX;
    const oy = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const s = zoom();
      setPos(name, {
        x: Math.max(0, start.x + (ev.clientX - ox) / s),
        y: Math.max(0, start.y + (ev.clientY - oy) / s),
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const boxKey = (tb: ErTable, e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      const p = pos[tb.name] ?? { x: 0, y: 0 };
      setPos(tb.name, { x: Math.max(0, p.x + d[0]), y: Math.max(0, p.y + d[1]) });
    } else if (e.key === "Enter" && props.onOpenTable) {
      e.preventDefault();
      props.onOpenTable(tb.name, !!tb.view);
    }
  };

  // --- Viewport, fit, minimap ----------------------------------------------
  const [view, setView] = createSignal({ left: 0, top: 0, w: 0, h: 0 });
  const measure = () => {
    if (scroller) setView({ left: scroller.scrollLeft, top: scroller.scrollTop, w: scroller.clientWidth, h: scroller.clientHeight });
  };
  onMount(() => {
    measure();
    if (typeof ResizeObserver !== "undefined" && scroller) {
      const ro = new ResizeObserver(measure);
      ro.observe(scroller);
      onCleanup(() => ro.disconnect());
    }
  });
  const fit = () => {
    measure();
    const v = view();
    setZoom(fitZoom(extent(), { w: v.w - 8, h: v.h - 8 }));
    scroller?.scrollTo?.(0, 0);
  };
  const mini = createMemo(() => {
    const s = MINI_W / extent().w;
    return { s, h: Math.round(extent().h * s) };
  });
  const miniJump = (e: MouseEvent) => {
    const el = e.currentTarget as SVGSVGElement;
    const r = el.getBoundingClientRect();
    const z = zoom();
    const s = mini().s;
    const x = ((e.clientX - r.left) / s) * z - view().w / 2;
    const y = ((e.clientY - r.top) / s) * z - view().h / 2;
    scroller?.scrollTo?.(Math.max(0, x), Math.max(0, y));
  };

  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    const act = k === "0" ? fit : k === "+" || k === "=" ? () => zoomBy(1.2) : k === "-" ? () => zoomBy(1 / 1.2) : e.shiftKey && k === "r" ? relayout : null;
    if (!act) return;
    // The diagram's own zoom, not the interface's (Mod+0/±, issue #681).
    e.preventDefault();
    e.stopPropagation();
    act();
  };

  // --- Export --------------------------------------------------------------
  const svgText = (): string => {
    const src = svgEl!;
    const clone = src.cloneNode(true) as SVGSVGElement;
    const from = [src, ...src.querySelectorAll("*")];
    const to = [clone, ...clone.querySelectorAll("*")];
    from.forEach((el, i) => {
      const cs = getComputedStyle(el);
      (to[i] as Element).setAttribute("style", EXPORT_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
    });
    const { w, h } = extent();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", scroller ? getComputedStyle(scroller).backgroundColor : "white");
    clone.insertBefore(bg, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  };
  const fileBase = () => `er-${(props.db || "diagrama").replace(/[\\/:*?"<>|]/g, "")}`;
  const exportSvg = () => void saveText(`${fileBase()}.svg`, svgText(), "image/svg+xml");
  const exportPng = async () => {
    try {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText())}`;
      await img.decode();
      const { w, h } = extent();
      const canvas = document.createElement("canvas");
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error(t("er.exportFailed"));
      await saveBytes(`${fileBase()}.png`, new Uint8Array(await blob.arrayBuffer()), "image/png");
    } catch (err) {
      setError(errorText(err));
    }
  };
  const exportMenu = (e: MouseEvent) =>
    openContextMenu(e, [
      { label: t("er.exportSvg"), action: exportSvg },
      { label: t("er.exportPng"), action: () => void exportPng() },
    ]);
  const moreMenu = (e: MouseEvent) =>
    openContextMenu(e, [
      { label: showTypes() ? t("er.hideTypes") : t("er.showTypes"), action: () => setShowTypes((v) => !v) },
      {
        label: hideViews() ? t("er.showViews") : t("er.hideViews"),
        action: () => setHideViews((v) => !v),
        disabled: !tables().some((tb) => tb.view),
      },
    ]);

  // «Relaciones»: Claves foráneas | Inferidas, a radio group (arrows switch).
  const fkUnavailable = () => (realList() === null ? (fkReason() ?? t("er.fkFailed")) : null);
  const pickMode = (m: "fk" | "inferred") => {
    if (m === "fk" && realList() === null) return;
    setMode(m);
  };
  const modeKey = (e: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    pickMode(mode() === "fk" ? "inferred" : "fk");
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  };

  const counts = () => {
    const ts = shown();
    const views = ts.filter((tb) => tb.view).length;
    return [tn("er.nTables", ts.length - views), tn("er.nViews", views), tn("er.nRelations", drawn().length)].join(" · ");
  };

  return (
    <Panel
      title={t("tool.er.tab")}
      class="er-diagram"
      onClose={props.onClose}
      busy={loading()}
      actions={
        <Show when={!loading() && tables().length > 0}>
          <button class="edit-btn" title={t("er.relayoutTitle")} onClick={relayout}>
            {t("er.relayout")}
          </button>
          <button class="edit-btn" title={t("er.fitTitle")} onClick={fit}>
            {t("er.fit")}
          </button>
          <span class="toolbar-sep" aria-hidden="true" />
          <span id="er-rel" class="er-rel-label">{t("er.relations")}</span>
          <span class="seg" role="radiogroup" aria-labelledby="er-rel" onKeyDown={modeKey}>
            <button
              type="button"
              role="radio"
              class="seg-btn"
              classList={{ on: realFks() }}
              aria-checked={realFks()}
              tabindex={realFks() ? 0 : -1}
              aria-disabled={realList() === null}
              title={fkUnavailable() ?? undefined}
              onClick={() => pickMode("fk")}
            >
              {t("er.modeFk")}
            </button>
            <button
              type="button"
              role="radio"
              class="seg-btn"
              classList={{ on: !realFks() }}
              aria-checked={!realFks()}
              tabindex={realFks() ? -1 : 0}
              title={t("er.modeInferredTitle")}
              onClick={() => pickMode("inferred")}
            >
              {t("er.modeInferred")}
            </button>
          </span>
        </Show>
      }
      status={
        <Show when={!loading() && tables().length > 0}>
          <span>
            {counts()} {realFks() ? t("er.realFks") : t("er.inferredFks")}
            {realFks() && fkTruncated() ? t("er.listIncomplete") : ""}
          </span>
          <button class="edit-btn edit-btn-menu" aria-haspopup="menu" onClick={exportMenu}>
            <Icon name="export" size={14} class="eb-ic" /> {t("er.export")}{" "}
            <Icon name="chevron-down" size={12} class="eb-caret" />
          </button>
          <button
            class="edit-btn edit-btn-icon"
            aria-haspopup="menu"
            aria-label={t("er.more")}
            title={t("er.more")}
            onClick={moreMenu}
          >
            <Icon name="more" size={14} />
          </button>
        </Show>
      }
    >
      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show when={!loading()} fallback={<p class="grid-empty">{t("er.loadingSchema")}</p>}>
        <Show
          when={tables().length > 0}
          fallback={<p class="grid-empty">{t("er.noTables")}</p>}
        >
          <p class="chart-hint">
            <Show
              when={realFks()}
              fallback={
                <>
                  {t("er.inferredLead")} <strong>{t("er.inferredWord")}</strong>{t("er.inferredMid")}
                  <code>{t("er.fkExampleCol")}</code> → <code>{t("er.fkExampleTable")}</code>{t("er.inferredColon")}{" "}
                  {realList() === null ? (fkReason() ?? t("er.noFkDefault")) : t("er.inferredChosen")}{" "}
                </>
              }
            >
              {t("er.realLead")} <strong>{t("er.realWord")}</strong>{t("er.realMid")}{" "}
              <Show when={fkTruncated()}>
                <strong>{t("er.incompleteWord")}</strong>{t("er.incompleteRest")}{" "}
              </Show>
            </Show>
            {t("er.dragHint")}
          </p>
          <div class="er-stage" onKeyDown={onKey}>
            <div class="er-canvas" ref={scroller} onScroll={measure}>
              <svg
                ref={svgEl}
                class="er-svg"
                width={extent().w * zoom()}
                height={extent().h * zoom()}
                viewBox={`0 0 ${extent().w} ${extent().h}`}
                role="group"
                aria-label={t("tool.er.title")}
              >
                {/* Edges first so boxes sit on top of the line ends. The layer
                    is the picture of the relations, said in words. */}
                <g role="img" aria-label={description()}>
                  <For each={drawn()}>
                    {(d) => (
                      <g class="er-rel" classList={{ "er-rel-active": d.active }}>
                        <path class="er-edge" d={d.d}>
                          <title>{relationText(d.edge)}</title>
                        </path>
                        <path class="er-mark" d={d.many.d} />
                        <circle class="er-mark-circle" cx={d.many.circle!.cx} cy={d.many.circle!.cy} r={d.many.circle!.r} />
                        <path class="er-mark" d={d.one.d} />
                      </g>
                    )}
                  </For>
                </g>

                <For each={shown()}>
                  {(tb) => {
                    const p = () => pos[tb.name] ?? { x: 0, y: 0 };
                    return (
                      <g
                        transform={`translate(${p().x}, ${p().y})`}
                        class="er-box"
                        classList={{ "er-sel": selected() === tb.name }}
                        tabindex="0"
                        role="button"
                        aria-roledescription={t("er.box.role")}
                        aria-label={boxLabel(tb)}
                        onMouseDown={(e) => startDrag(tb.name, e)}
                        onFocus={() => setSelected(tb.name)}
                        onKeyDown={(e) => boxKey(tb, e)}
                        onDblClick={() => props.onOpenTable?.(tb.name, !!tb.view)}
                      >
                        <rect class="er-box-bg" classList={{ "er-view": !!tb.view }} x="0" y="0" width={ER_BOX.w} height={height(tb)} rx="6" />
                        <line class="er-box-rule" x1="0" x2={ER_BOX.w} y1={ER_BOX.header} y2={ER_BOX.header} />
                        <g transform={`translate(10, ${ER_BOX.header / 2 - 7})`}>
                          <ObjectIcon kind={tb.view ? "view" : "table"} size={14} />
                        </g>
                        <text class="er-box-title" x="30" y={ER_BOX.header / 2 + 4}>
                          {tb.name}
                        </text>
                        <text class="er-box-count" x={ER_BOX.w - 10} y={ER_BOX.header / 2 + 4} text-anchor="end">
                          {tb.view ? t("er.box.viewTag") : tn("er.nColumns", tb.columns.length)}
                        </text>
                        <For each={tb.columns}>
                          {(col, i) => {
                            const fk = () => fkColumns().has(`${tb.name}\u0000${col.name}`);
                            const y = () => rowY(0, i());
                            return (
                              <>
                                {/* The keys are the app's icons, not glyphs (#696). */}
                                <Show when={col.pk || fk()}>
                                  <g transform={`translate(8, ${y() - 5})`}>
                                    <Icon name={col.pk ? "key" : "fk"} size={10} class={col.pk ? "er-col-key" : "er-col-fk"} />
                                  </g>
                                </Show>
                                <text class={`er-col ${col.pk ? "er-col-pk" : ""}`} x="24" y={y() + 4}>
                                  {col.name}
                                </text>
                                <Show when={showTypes()}>
                                  <text class="er-col-type" x={ER_BOX.w - 10} y={y() + 4} text-anchor="end">
                                    {col.type}
                                  </text>
                                </Show>
                              </>
                            );
                          }}
                        </For>
                      </g>
                    );
                  }}
                </For>
              </svg>
            </div>

            <div class="er-zoom" role="group" aria-label={t("er.zoomGroup")}>
              <button class="edit-btn edit-btn-icon" title={t("er.zoomOut")} aria-label={t("er.zoomOut")} onClick={() => zoomBy(1 / 1.2)}>
                <Icon name="minus" size={14} />
              </button>
              <span class="panel-zoom">{Math.round(zoom() * 100)}%</span>
              <button class="edit-btn edit-btn-icon" title={t("er.zoomIn")} aria-label={t("er.zoomIn")} onClick={() => zoomBy(1.2)}>
                <Icon name="plus" size={14} />
              </button>
            </div>

            <div class="er-legend" role="note" aria-label={t("er.legend")}>
              <span>
                <svg width="28" height="12" aria-hidden="true">
                  <path class="er-legend-line" d="M0,6 L28,6" />
                  <path class="er-mark" d={endMark("one", { x: 28, y: 6 }, 1).d} />
                </svg>
                {t("er.legendOne")}
              </span>
              <span>
                <svg width="28" height="12" aria-hidden="true">
                  <path class="er-legend-line" d="M0,6 L28,6" />
                  <path class="er-mark" d={endMark("many", { x: 28, y: 6 }, 1).d} />
                  <circle class="er-mark-circle" cx="11" cy="6" r="3.5" />
                </svg>
                {t("er.legendMany")}
              </span>
              <span>
                <span class="er-legend-view" aria-hidden="true" />
                {t("er.legendView")}
              </span>
            </div>

            <svg
              class="er-minimap"
              width={MINI_W}
              height={mini().h}
              role="img"
              aria-label={t("er.minimap")}
              onClick={miniJump}
            >
              <For each={shown()}>
                {(tb) => {
                  const r = () => rect(tb);
                  return (
                    <rect
                      class="er-mini-box"
                      classList={{ "er-view": !!tb.view }}
                      x={r().x * mini().s}
                      y={r().y * mini().s}
                      width={r().w * mini().s}
                      height={r().h * mini().s}
                    />
                  );
                }}
              </For>
              <rect
                class="er-mini-view"
                x={(view().left / zoom()) * mini().s}
                y={(view().top / zoom()) * mini().s}
                width={(view().w / zoom()) * mini().s}
                height={(view().h / zoom()) * mini().s}
              />
            </svg>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
