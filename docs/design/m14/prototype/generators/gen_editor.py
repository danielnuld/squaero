# Generates the [editor] group .body files for the M14 redesign prototype (v2: audit applied).
# Previous version: gen_editor.v1.py
import io, json, os

BODIES = r'docs/design/m14/redesign\bodies'
T = '{{theme}}'

ICONS = {
    'table': '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 10v10"></path>',
    'view': '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
    'function': '<path d="M9 20c2 0 2.5-1.5 3-4l2-10c.5-2.5 1-4 3-4"></path><path d="M7 10h9"></path>',
    'query': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="m9 13-2 2 2 2"></path><path d="m13 13 2 2-2 2"></path>',
    'database': '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path>',
    'play': '<path d="M7 4v16l13-8z"></path>',
    'stop': '<rect x="6" y="6" width="12" height="12" rx="1"></rect>',
    'search': '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    'plus': '<path d="M12 5v14M5 12h14"></path>',
    'close': '<path d="M18 6 6 18M6 6l12 12"></path>',
    'chev': '<path d="m6 9 6 6 6-6"></path>',
    'chevr': '<path d="m9 6 6 6-6 6"></path>',
    'more': '<circle cx="5" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="19" cy="12" r="1.2"></circle>',
    'refresh': '<path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path>',
    'import': '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
    'export': '<path d="M12 15V3"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14"></path>',
    'pin': '<path d="M12 17v5"></path><path d="M9 3h6l-1 6 4 4H6l4-4z"></path>',
    'chart': '<path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M22 20H2"></path>',
    'transpose': '<path d="M4 4h7v7H4z"></path><path d="M13 13h7v7h-7z"></path><path d="M15 4h5v5"></path><path d="M9 20H4v-5"></path>',
    'compare': '<path d="M8 3v18"></path><path d="M16 3v18"></path><path d="M3 8h5"></path><path d="M16 16h5"></path>',
    'history': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path>',
    'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>',
    'lock': '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
    'check': '<path d="M20 6 9 17l-5-5"></path>',
    'warning': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    'info': '<circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
    'trash': '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>',
    'copy': '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    'format': '<path d="M4 6h16"></path><path d="M4 12h10"></path><path d="M4 18h14"></path>',
    'plan': '<rect x="9" y="2" width="6" height="5" rx="1"></rect><rect x="3" y="17" width="6" height="5" rx="1"></rect><rect x="15" y="17" width="6" height="5" rx="1"></rect><path d="M12 7v5"></path><path d="M6 17v-3h12v3"></path>',
    'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
    'open': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"></path><path d="M3 7v10a2 2 0 0 0 2 2h13l3-8H6l-3 8"></path>',
    'clock': '<circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2"></path><path d="M10 2h4"></path>',
    'key': '<circle cx="7.5" cy="15.5" r="4.5"></circle><path d="m10.7 12.3 9.3-9.3"></path><path d="m16 7 3 3"></path>',
    'filter': '<path d="M3 5h18l-7 8v6l-4 2v-8z"></path>',
    'spin': '<path d="M12 3a9 9 0 1 0 9 9"></path>',
}


def svg(name, size=15, style=''):
    st = f' style="{style}"' if style else ''
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{st}>{ICONS[name]}</svg>')


SEP = '<span style="width: 1px; height: 20px; flex: none; background: var(--border); margin: 0 4px"></span>'
FLEX = '<span style="flex: 1"></span>'
KBD = lambda *ks: f'<span class="kbd">{"+".join(ks)}</span>'   # R-33: one kbd per combination, Ctrl+Mayús+F
CHK = 'style="accent-color: var(--accent); margin: 0"'

# connections (AUDIT-RULES rule 2)
VENTAS = ('Ventas', 'main', '#2f7dd6', False)
PROD = ('Producción', 'ventas', '#c4302b', True)

TABS_EDITOR = [{'label': 'Consulta 1', 'kind': 'query', 'active': True, 'dirty': True, 'href': 'EditorResult.dc.html', 'color': '#2f7dd6'},
               {'label': 'clientes', 'kind': 'table', 'href': 'DataGrid.dc.html', 'color': '#2f7dd6'}]

# EditorResult script: the caret sits in statement 1 (lines 2-5); line 7 is a write that "Script completo" would also run.
SQL_SCRIPT = ("-- Pedidos por cliente\nSELECT c.nombre, c.ciudad, p.fecha, p.estado, p.total\nFROM clientes c\nJOIN pedidos p ON p.cliente_id = c.id\nORDER BY p.fecha;\n\n"
              "UPDATE pedidos SET estado = 'enviado'\n WHERE id = 31;")
RUN_RANGE = '2-5'
SQL_JOIN = 'SELECT c.nombre, c.ciudad, p.fecha, p.estado, p.total\nFROM clientes c\nJOIN pedidos p ON p.cliente_id = c.id\nORDER BY p.fecha;'
COLS_JOIN = [{'name': 'nombre', 'type': 'text', 'kind': 'text', 'w': '170px'}, {'name': 'ciudad', 'type': 'text', 'kind': 'text', 'w': '150px'},
             {'name': 'fecha', 'type': 'date', 'kind': 'date', 'w': '120px', 'sort': '↑'}, {'name': 'estado', 'type': 'text', 'kind': 'text', 'w': '130px'},
             {'name': 'total', 'type': 'numeric(10,2)', 'kind': 'num', 'w': '120px'}]
ROWS_JOIN = [['María López', 'Hermosillo', '2025-06-02', 'entregado', '2598.00'], ['Luis Ramírez', 'Cd. Obregón', '2025-06-11', 'enviado', '5890.00'],
             ['Juan Pérez', 'Nogales', '2025-06-18', 'pendiente', '1099.00'], ['Miguel Ángel', 'Nogales', '2025-06-24', 'entregado', '7640.00'],
             ['Sofía Torres', 'Hermosillo', '2025-07-01', 'cancelado', '549.50'], ['Paola Núñez', 'Hermosillo', '2025-07-08', 'entregado', '1750.00'],
             ['Verónica Paz', 'Agua Prieta', '2025-07-15', 'pendiente', '899.00'], ['Elena Díaz', 'Caborca', '2025-07-21', 'enviado', '1419.99']]
COLS_CLI = [{'name': 'id', 'type': 'integer', 'kind': 'num', 'w': '64px', 'key': True}, {'name': 'nombre', 'type': 'text', 'kind': 'text', 'w': '140px'},
            {'name': 'email', 'type': 'text', 'kind': 'text', 'w': '200px'}, {'name': 'ciudad', 'type': 'text', 'kind': 'text', 'w': '130px'},
            {'name': 'saldo', 'type': 'numeric(10,2)', 'kind': 'num', 'w': '110px'}, {'name': 'activo', 'type': 'boolean', 'kind': 'bool', 'w': '76px'},
            {'name': 'alta', 'type': 'date', 'kind': 'date', 'w': '1fr'}]
ROWS_CLI = [[1, 'María López', 'maria.lopez@correo.mx', 'Hermosillo', '1250.00', 'true', '2023-02-14'], [2, 'Juan Pérez', 'jperez@correo.mx', 'Nogales', '980.50', 'true', '2023-03-01'],
            [3, 'Ana Gómez', 'ana.gomez@correo.mx', 'Guaymas', None, 'false', '2023-05-22'], [4, 'Luis Ramírez', 'lramirez@correo.mx', 'Cd. Obregón', '4321.99', 'true', '2024-01-09'],
            [5, 'Sofía Torres', 'storres@correo.mx', 'Hermosillo', '12.00', 'true', '2024-04-18'], [6, 'Carlos Ruiz', 'cruiz@correo.mx', 'Navojoa', '777.77', 'false', '2024-06-30'],
            [7, 'Elena Díaz', 'ediaz@correo.mx', 'Caborca', '230.10', 'true', '2024-08-12'], [8, 'Miguel Ángel', '', 'Nogales', '5400.00', 'true', '2024-11-03'],
            [9, 'Paola Núñez', 'pnunez@correo.mx', 'Hermosillo', '88.25', 'true', '2025-01-27'], [10, 'Roberto Sil', 'rsil@correo.mx', 'Guaymas', '1590.40', 'false', '2025-03-15'],
            [11, 'Verónica Paz', 'vpaz@correo.mx', 'Agua Prieta', '640.00', 'true', '2025-05-02'], [12, 'Andrés Solís', 'asolis@correo.mx', 'Puerto Peñasco', '315.75', 'true', '2025-06-19']]
# 3-statement script used by EditorRunning / EditorMultipleResults
SQL_3 = ('SELECT * FROM clientes;\nSELECT p.estado, COUNT(*) AS n, SUM(d.cantidad * d.precio) AS importe\n  FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id\n'
         ' GROUP BY p.estado;\nSELECT * FROM productos;')

PROPS = ('{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},'
         '"$preview":{"width":1280,"height":800}}')


def write(name, title, markup, data=None):
    data = dict(data or {})
    js = ('class Component extends DCLogic {\n  renderVals() {\n    return Object.assign({ theme: this.props.theme ?? \'b\', os: this.props.os ?? \'windows\', yes: true, no: false }, '
          + json.dumps(data, ensure_ascii=False) + ');\n  }\n}\n')
    io.open(os.path.join(BODIES, name + '.body'), 'w', encoding='utf-8', newline='\n').write(
        title + '\n' + markup.strip('\n') + '\n---PROPS---\n' + PROPS + '\n---JS---\n' + js)


def shell(main, *, rail='explorer', explorer='state="connected" tree="tables" selected=""', status='conn="Ventas" db="main" info="Sin ejecutar"',
          overlay='', side=None, wtitle='Consulta 1 — Ventas — Squaero'):
    col = side if side is not None else f'<dc-import name="Explorer" theme="{T}" {explorer} height="738px" hint-size="248px,738px"></dc-import>'
    return f'''<div class="th th-{T}" data-os="{{{{os}}}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{T}" os="{{{{os}}}}" window-title="{wtitle}" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{T}" active="{rail}" height="738px" hint-size="56px,738px"></dc-import>
    {col}
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{T}" tabs="{{{{tabs}}}}" hint-size="100%,36px"></dc-import>
{main}
    </main>
  </div>
  <dc-import name="StatusBar" theme="{T}" {status} hint-size="1280px,24px"></dc-import>
{overlay}
</div>'''


def overlay_on(base, overlay, close_href=None):
    """Overlay screen that imports its base screen whole; a click outside closes back to the base."""
    return f'''<div class="th th-{T}" data-os="{{{{os}}}}" style="width: 1280px; height: 800px; overflow: hidden; position: relative; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="{base}" theme="{T}" os="{{{{os}}}}" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="{close_href or base}.dc.html" aria-label="Cerrar menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>
{overlay}
</div>'''


# ---------------------------------------------------------------- editor document parts

def conn_selector(conn=VENTAS, open_=False):
    """R-02: mandatory connection selector at the start of the run toolbar."""
    name, db, color, safe = conn
    lock = (f'<span class="chip" title="Conexión protegida: las escrituras están bloqueadas" style="height: 20px; margin-left: 2px; background: var(--hover); color: var(--text-dim); font-weight: 500">'
            f'{svg("lock", 11)}Solo lectura</span>') if safe else ''
    return (f'<a href="{"EditorResult" if open_ else "EditorConnectionMenu"}.dc.html" class="field{" is-focus" if open_ else ""}" role="button" aria-haspopup="listbox" aria-expanded="{"true" if open_ else "false"}" '
            f'aria-label="Conexión de esta pestaña: {name}, base {db}" title="Conexión y base de datos de esta pestaña" '
            f'style="flex: none; display: inline-flex; align-items: center; gap: 7px; padding: 0 8px; text-decoration: none; font-size: var(--fs-sm)">'
            f'<span style="width: 8px; height: 8px; border-radius: 50%; background: {color}; box-shadow: 0 0 0 2px color-mix(in srgb, {color} 25%, transparent)"></span>'
            f'<span style="font-weight: 600">{name}</span><span style="color: var(--text-dim)">· {db}</span>{lock}{svg("chev", 12, "color: var(--text-dim)")}</a>')


def run_toolbar(state='idle', tx='auto', conn=VENTAS, label='Ejecutar sentencia', conn_open=False, run_open=False, more_open=False, tx_open=False):
    """AUDIT-RULES 5: [conexión ▾] [▶ Ejecutar sentencia ▾] [■] | Formatear | Auto/Manual (+Commit/Revertir) | flex | Más ⋯"""
    if state == 'running':  # R-01: Detener replaces Ejecutar in the same place
        run = (f'<a href="EditorMultipleResults.dc.html" class="btn btn-danger" title="Detener la ejecución (Ctrl+Pausa)" style="flex: none">'
               f'{svg("stop", 14, "fill: currentColor")}Detener</a>')
    else:
        dis = state == 'disabled'
        main_attr = ' aria-disabled="true" title="Escribe una sentencia para ejecutarla"' if dis else ' title="Ejecutar la sentencia actual (Ctrl+Intro)"'
        run = (f'<span style="flex: none; display: inline-flex{"; opacity: .5" if dis else ""}">'
               f'<a href="EditorResult.dc.html" class="btn btn-primary"{main_attr} style="border-radius: var(--r-sm) 0 0 var(--r-sm)">{svg("play", 14)}{label}</a>'
               f'<a href="{"EditorResult" if run_open else "EditorRunMenu"}.dc.html" class="btn btn-primary{" focus" if run_open else ""}" aria-label="Qué ejecutar: sentencia actual, selección o script completo" aria-haspopup="menu" aria-expanded="{"true" if run_open else "false"}" '
               f'style="border-radius: 0 var(--r-sm) var(--r-sm) 0; padding: 0 7px; border-left: 1px solid color-mix(in srgb, var(--accent-fg) 40%, transparent)">{svg("chev", 13)}</a></span>'
               f'<button type="button" class="btn btn-icon" disabled aria-label="Detener (no hay nada en ejecución)" title="Detener (Ctrl+Pausa)" style="opacity: .45">{svg("stop", 14)}</button>')
    manual = tx != 'auto'
    seg = (f'<span class="seg" role="radiogroup" aria-label="Modo de transacción" style="flex: none">'
           f'<a href="EditorResult.dc.html" role="radio" class="{"" if manual else "on"}" aria-checked="{"false" if manual else "true"}" title="Auto: cada sentencia se confirma al ejecutarse">Auto</a>'
           f'<a href="TxManualPending.dc.html" role="radio" class="{"on" if manual else ""}" aria-checked="{"true" if manual else "false"}" title="Manual: agrupa las sentencias hasta Commit o Revertir">Manual</a>'
           f'<a href="{"EditorResult" if tx_open else "TxControlsMenu"}.dc.html" aria-label="Opciones de transacción" aria-haspopup="menu" aria-expanded="{"true" if tx_open else "false"}" style="padding: 0 6px{"; background: var(--hover)" if tx_open else ""}">{svg("chev", 12)}</a></span>')
    txb = ''
    if manual:
        en = tx == 'pending'
        d = '' if en else ' aria-disabled="true" style="opacity: .5"'
        txb = (f'<a href="EditorDmlResult.dc.html" class="btn" title="Commit: confirmar la transacción (Alt+Mayús+C)"{d}>{svg("check", 15, "color: var(--ok)")}Commit</a>'
               f'<a href="EditorResult.dc.html" class="btn" title="Revertir la transacción (Alt+Mayús+R)"{d}>{svg("refresh", 15)}Revertir</a>')
    more = (f'<a href="{"EditorResult" if more_open else "EditorMoreMenu"}.dc.html" class="btn btn-ghost{" focus" if more_open else ""}" aria-haspopup="menu" aria-expanded="{"true" if more_open else "false"}" '
            f'aria-label="Más: plan, historial, variables, abrir y guardar .sql, snippet" style="{"background: var(--hover)" if more_open else ""}">Más{svg("more")}</a>')
    return f'''      <div role="toolbar" aria-label="Ejecución de la consulta" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        {conn_selector(conn, conn_open)}
        {run}
        {SEP}
        <a href="#" class="btn btn-ghost" title="Formatear SQL (Alt+Mayús+F)">{svg("format")}Formatear</a>
        {SEP}
        {seg}{txb}
        {FLEX}
        {more}
      </div>'''


def sql_editor(attrs='current="0"', h=200, extra=''):
    return f'''      <div style="height: {h}px; flex: none; position: relative">
        <dc-import name="SqlEditor" theme="{T}" sql="{{{{sql}}}}" {attrs} height="{h}px" hint-size="100%,{h}px"></dc-import>{extra}
      </div>'''


SPLITTER = ('      <div role="separator" aria-orientation="horizontal" aria-label="Redimensionar editor y resultados" title="Arrastra para redimensionar · doble clic maximiza los resultados" '
            'style="height: 7px; flex: none; display: flex; align-items: center; justify-content: center; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--surface); cursor: row-resize">'
            '<span style="width: 36px; height: 3px; border-radius: 2px; background: var(--border-strong)"></span></div>')


def rtab(label, href, on=False, count='', badge=''):
    st = (f'height: 35px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; margin-right: 16px; text-decoration: none; font-size: var(--fs-md); white-space: nowrap; '
          f'border-bottom: 2px solid {"var(--accent)" if on else "transparent"}; color: {"var(--text)" if on else "var(--text-dim)"}; font-weight: {600 if on else 400}')
    c = f'<span class="num" style="font-weight: 400; color: var(--text-dim)">{count}</span>' if count else ''
    return f'<a href="{href}" role="tab" aria-selected="{"true" if on else "false"}" style="{st}">{label}{c}{badge}</a>'


def std_tabs(active='res', res_count='· 8 filas · 11 ms', msg_badge='', res_label='Resultado'):
    return [rtab(res_label, 'EditorResult.dc.html', active == 'res', res_count),
            rtab('Mensajes', 'EditorError.dc.html', active == 'msg', '', msg_badge),
            rtab('Plan', 'ExplainPlan.dc.html', active == 'plan')]


def band(tabs, right=''):
    """R-23 / rule 12: result tabs + result toolbar share one 36px band."""
    r = f'<div role="toolbar" aria-label="Acciones del resultado" style="display: flex; align-items: center; gap: 2px">{right}</div>' if right else ''
    return f'''      <div style="height: 36px; flex: none; display: flex; align-items: center; padding: 0 6px 0 14px; border-bottom: 1px solid var(--border)">
        <div role="tablist" aria-label="Panel de resultados" style="display: flex; align-items: center; height: 100%; min-width: 0">{"".join(tabs)}</div>
        {FLEX}
        {r}
      </div>'''


IB = 'style="width: 28px; height: 28px"'


def grid_actions(ro='', ro_title='', refresh=True, rows=8):
    """Same result toolbar as DataGrid, compact: Refrescar (F5 = re-read SELECT only, R-34), local search, transpose, pin, compare, chart, export."""
    chip = (f'<span class="chip" title="{ro_title}" style="margin-right: 6px; background: var(--hover); color: var(--text-dim); font-weight: 500">{svg("lock", 12)}{ro}</span>' if ro else '')
    rf = (f'<a href="EditorResult.dc.html" class="btn btn-icon" aria-label="Refrescar (F5): vuelve a leer este SELECT" title="Refrescar (F5) · vuelve a leer este SELECT" {IB}>{svg("refresh", 15)}</a>' if refresh else '')
    return (chip + rf
            + f'<a href="GridColumnFilter.dc.html" class="btn btn-icon" aria-label="Buscar en la página: solo en las {rows} filas cargadas" title="Buscar en la página · solo en las {rows} filas cargadas (Ctrl+F en la rejilla)" {IB}>{svg("search", 15)}</a>'
            + f'<a href="GridTransposed.dc.html" class="btn btn-icon" aria-label="Transponer" title="Transponer" {IB}>{svg("transpose", 15)}</a>'
            + f'<a href="PinnedResult.dc.html" class="btn btn-icon" aria-label="Fijar resultado" title="Fijar resultado" {IB}>{svg("pin", 15)}</a>'
            + f'<a href="CompareMenu.dc.html" class="btn btn-icon" aria-label="Comparar con…" title="Comparar con…" {IB}>{svg("compare", 15)}</a>'
            + f'<a href="Chart.dc.html" class="btn btn-icon" aria-label="Graficar" title="Graficar" {IB}>{svg("chart", 15)}</a>'
            + f'<a href="ExportMenu.dc.html" class="btn btn-ghost" aria-haspopup="menu" title="Exportar el resultado completo" style="height: 28px; padding: 0 8px">{svg("export", 15)}Exportar{svg("chev", 11)}</a>')


RO_JOIN = ('Solo lectura', 'Resultado de un JOIN: no corresponde a las filas de una sola tabla, así que no se puede editar.')


def grid(extra=''):
    return f'''      <div style="flex: 1; min-height: 0">
        <dc-import name="Grid" theme="{T}" columns="{{{{columns}}}}" rows="{{{{rows}}}}" {extra} label="Resultado de la consulta" height="100%" hint-size="100%,100%"></dc-import>
      </div>'''


GRID = grid()


def editor_doc(*, toolbar, editor, head, body, bar='', txband=''):
    return '\n'.join(x for x in [toolbar, bar, editor, SPLITTER, txband, head, body] if x)


DATA_RESULT = {'tabs': TABS_EDITOR, 'sql': SQL_SCRIPT, 'columns': COLS_JOIN, 'rows': ROWS_JOIN}
ST_RESULT = 'conn="Ventas" db="main" color="#2f7dd6" info="8 filas · 5 columnas · 11 ms · ejecutada 14:15:45"'
ED_RESULT = f'current="5" caret-line="5" run-range="{RUN_RANGE}"'


def result_doc(bar='', h=200, extra_ed='', toolbar=None):
    return editor_doc(toolbar=toolbar or run_toolbar(), bar=bar, editor=sql_editor(ED_RESULT, h=h, extra=extra_ed),
                      head=band(std_tabs(), grid_actions(*RO_JOIN)), body=GRID)


# ---------------------------------------------------------------- 1. EditorEmpty
def empty_results():
    def colm(head, links):
        items = ''.join(f'<a href="{h}" style="{st}">{t}</a>' for t, h, st in links)
        return f'<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0"><span class="lbl">{head}</span>{items}</div>'
    lk = 'text-decoration: none; font-size: var(--fs-md)'
    mk = 'text-decoration: none; font-family: var(--font-mono); font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis'
    return f'''      <div style="flex: 1; min-height: 0; padding: 24px 32px; overflow: hidden">
        <div style="font-size: var(--fs-lg); font-weight: 600">Ejecuta una consulta para ver resultados</div>
        <div style="margin-top: 4px; color: var(--text-dim)">{KBD("Ctrl", "Intro")} ejecuta la sentencia donde está el cursor (o la selección); {KBD("Ctrl", "Mayús", "Intro")} ejecuta el script completo.</div>
        <div style="margin-top: 14px; display: flex; gap: 8px"><a href="SnippetPalette.dc.html" class="btn">{svg("bookmark")}Insertar un snippet</a><a href="#" class="btn btn-ghost">{svg("open")}Abrir .sql…</a></div>
        <div style="margin-top: 26px; display: grid; grid-template-columns: 160px 300px 200px; gap: 32px">
          {colm("Tablas recientes", [("clientes", "DataGrid.dc.html", lk), ("pedidos", "DataGrid.dc.html", lk), ("productos", "DataGrid.dc.html", lk)])}
          {colm("Consultas recientes", [("SELECT c.nombre, c.ciudad, p.fecha…", "EditorResult.dc.html", mk), ("SELECT * FROM productos WHERE exis…", "EditorResult.dc.html", mk), ("Ver el historial", "HistoryPanel.dc.html", lk)])}
          {colm("Snippets", [("Clientes activos", "SnippetsTool.dc.html", lk), ("Ventas por estado", "SnippetsTool.dc.html", lk), ("Productos sin existencias", "SnippetsTool.dc.html", lk)])}
        </div>
        <div style="margin-top: 26px; display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: var(--fs-sm); color: var(--text-dim)">
          <span>Sentencia {KBD("Ctrl", "Intro")}</span><span>Script {KBD("Ctrl", "Mayús", "Intro")}</span><span>Formatear {KBD("Alt", "Mayús", "F")}</span><span>Abrir .sql {KBD("Ctrl", "O")}</span><span>Snippets {KBD("Ctrl", "J")}</span>
          <a href="ShortcutsHelp.dc.html">Todos los atajos</a>
        </div>
      </div>'''


write('EditorEmpty', 'Consulta vacía', shell(editor_doc(
    toolbar=run_toolbar('disabled'),
    editor=sql_editor('current="1" caret-line="1"'),
    head=band(std_tabs(res_count='')),
    body=empty_results()), status='conn="Ventas" db="main" color="#2f7dd6" info="Sin ejecutar"'),
    {'tabs': [{'label': 'Consulta 1', 'kind': 'query', 'active': True, 'href': 'EditorEmpty.dc.html', 'color': '#2f7dd6'}], 'sql': ''})

# ---------------------------------------------------------------- 2. EditorAutocomplete (A-06: catalogue first, typed icons)
ac_items = [
    ('table', [('cli', True), ('entes', False)], 'tabla · 12 filas', True),
    ('view', [('cli', True), ('entes_activos', False)], 'vista', False),
    ('column', [('cli', True), ('ente_id', False)], 'pedidos', False),
    ('snippet', [('Cli', True), ('entes activos', False)], 'snippet', False),
    ('keyword', [('c', True), ('o', False), ('l', True), ('lat', False), ('i', True), ('on', False)], 'palabra clave', False),
    ('function', [('lo', False), ('c', True), ('a', False), ('l', True), ('t', False), ('i', True), ('me', False)], 'función', False),
]
ac_icon = {
    'table': svg('table', 14, 'color: var(--obj-table); flex: none'),
    'view': svg('view', 14, 'color: var(--obj-view); flex: none'),
    'column': '<span aria-hidden="true" style="width: 14px; flex: none; display: flex; justify-content: center"><span style="width: 7px; height: 7px; border-radius: 2px; background: var(--type-dot-num)"></span></span>',
    'snippet': svg('bookmark', 14, 'color: var(--accent-text); flex: none'),
    'keyword': '<span aria-hidden="true" style="width: 14px; flex: none; text-align: center; font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--syntax-keyword)">K</span>',
    'function': svg('function', 14, 'color: var(--obj-function); flex: none'),
}
rows_html = ''
for kind, parts, hint, on in ac_items:
    name = ''.join(f'<span style="{"color: var(--accent-text); font-weight: 600" if m else ""}">{s}</span>' for s, m in parts)
    rows_html += (f'<div class="mi{" on" if on else ""}" role="option" aria-selected="{"true" if on else "false"}" style="height: 26px; gap: 8px">{ac_icon[kind]}'
                  f'<span style="font-family: var(--font-mono); font-size: var(--fs-sm)">{name}</span><span class="k">{hint}</span></div>')
cols_detail = ''.join(
    f'<div style="display: flex; gap: 8px; height: 20px; align-items: center"><span class="mono" style="font-size: var(--fs-sm); flex: 1">{n}{" " + svg("key", 11, "color: var(--warn); vertical-align: -1px") if k else ""}</span><span class="mono" style="font-size: var(--fs-xs); color: var(--text-dim)">{t}</span></div>'
    for n, t, k in [('id', 'integer', True), ('nombre', 'text', False), ('email', 'text', False), ('ciudad', 'text', False), ('saldo', 'numeric(10,2)', False), ('activo', 'boolean', False), ('alta', 'date', False)])
ac_popup = f'''  <div class="menu" role="listbox" aria-label="Sugerencias para cli" style="left: 494px; top: 150px; width: 520px; padding: 0; display: flex; flex-direction: column; overflow: hidden">
    <div style="display: flex">
      <div style="width: 250px; flex: none; padding: 4px; border-right: 1px solid var(--border)">{rows_html}</div>
      <div style="flex: 1; min-width: 0; padding: 10px 12px">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 600">{svg("table", 14, "color: var(--obj-table)")}clientes<span style="font-weight: 400; font-size: var(--fs-xs); color: var(--text-dim)">tabla · main · 12 filas</span></div>
        <div style="margin-top: 8px">{cols_detail}</div>
      </div>
    </div>
    <div style="height: 30px; display: flex; align-items: center; gap: 12px; padding: 0 10px; border-top: 1px solid var(--border); background: var(--surface); font-size: var(--fs-xs); color: var(--text-dim); white-space: nowrap">
      <span>{KBD("↑")} {KBD("↓")} moverse</span><span>{KBD("Intro")} insertar</span><span>{KBD("Tab")} completar</span><span>{KBD("Esc")} cerrar</span>{FLEX}<span title="El catálogo se carga al conectar, aunque el árbol esté plegado">Catálogo de main</span>
    </div>
  </div>'''
write('EditorAutocomplete', 'Autocompletado', shell(editor_doc(
    toolbar=run_toolbar(),
    editor=sql_editor('current="1" caret-line="1" run-range="1-1"'),
    head=band(std_tabs(res_count='')),
    body=empty_results()), overlay=ac_popup, status='conn="Ventas" db="main" color="#2f7dd6" info="Sin ejecutar"'),
    {'tabs': TABS_EDITOR, 'sql': 'SELECT * FROM cli'})

# ---------------------------------------------------------------- 3. EditorFind
tg = lambda lab, txt, on=False: (f'<button type="button" aria-label="{lab}" aria-pressed="{"true" if on else "false"}" title="{lab}" '
                                 f'style="width: 24px; height: 24px; border: 0; border-radius: 4px; background: {"var(--accent-soft)" if on else "transparent"}; color: {"var(--accent-text)" if on else "var(--text-dim)"}; font-family: var(--font-mono); font-size: 11px; padding: 0">{txt}</button>')
find_bar = f'''      <div role="search" aria-label="Buscar y reemplazar en el editor" style="height: 40px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border); background: var(--surface)">
        <span class="field is-focus" style="width: 280px; display: inline-flex; align-items: center; gap: 6px; padding: 0 4px 0 8px">{svg("search", 14, "color: var(--text-dim); flex: none")}<input value="p.fecha" aria-label="Buscar" placeholder="Buscar" style="flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-family: var(--font-mono); font-size: var(--fs-sm)">{tg("Coincidir mayúsculas y minúsculas", "Aa")}{tg("Palabra completa", "ab")}{tg("Expresión regular", ".*")}</span>
        <span class="num" style="min-width: 52px; font-size: var(--fs-sm); color: var(--text-dim)">1 de 2</span>
        <button type="button" class="btn btn-icon" aria-label="Anterior (Mayús+Intro)" title="Anterior (Mayús+Intro)">{svg("chev", 15, "transform: rotate(180deg)")}</button>
        <button type="button" class="btn btn-icon" aria-label="Siguiente (Intro)" title="Siguiente (Intro)">{svg("chev", 15)}</button>
        {SEP}
        <input class="field" value="p.fecha_pedido" aria-label="Reemplazar con" placeholder="Reemplazar con" style="width: 190px; font-family: var(--font-mono); font-size: var(--fs-sm)">
        <button type="button" class="btn">Reemplazar</button>
        <button type="button" class="btn btn-ghost">Reemplazar todo</button>
        {FLEX}
        <label style="display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-dim); white-space: nowrap"><input type="checkbox" {CHK}>En la selección</label>
        <a href="EditorResult.dc.html" class="btn btn-icon" aria-label="Cerrar búsqueda (Esc)" title="Cerrar búsqueda (Esc)">{svg("close", 15)}</a>
      </div>'''
write('EditorFind', 'Buscar en el editor', shell(editor_doc(
    toolbar=run_toolbar(), bar=find_bar,
    editor=sql_editor('current="2" select-lines="2" run-range="2-5"', h=184),
    head=band(std_tabs(), grid_actions(*RO_JOIN)), body=GRID), status='conn="Ventas" db="main" color="#2f7dd6" info="2 coincidencias · 8 filas · 11 ms"'), DATA_RESULT)

# ---------------------------------------------------------------- 4. EditorResult
write('EditorResult', 'Resultado de la consulta', shell(result_doc(), status=ST_RESULT), DATA_RESULT)

# ---------------------------------------------------------------- NEW EditorRunning (R-01)
running_tabs = (rtab('1 · clientes', 'EditorMultipleResults.dc.html', False, '12 filas')
                + f'<span role="tab" aria-selected="true" aria-busy="true" style="height: 35px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px; margin-right: 16px; border-bottom: 2px solid var(--accent); font-weight: 600; white-space: nowrap">'
                  f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="color: var(--accent-text)">{ICONS["spin"]}</svg>2 · Ejecutando</span>'
                + rtab('Mensajes', 'EditorError.dc.html'))
running_right = (f'<span role="status" aria-live="polite" class="num" style="font-size: var(--fs-sm); color: var(--text-dim); margin-right: 10px">Ejecutando · 00:04 · sentencia 2 de 3</span>'
                 f'<a href="EditorMultipleResults.dc.html" class="btn" style="height: 28px">Cancelar</a>')
write('EditorRunning', 'Ejecutando', shell(editor_doc(
    toolbar=run_toolbar('running'),
    editor=sql_editor('current="3" caret-line="5" run-range="2-4"', h=150),
    head=band([running_tabs], running_right),
    body=grid('loading="{{yes}}"')),
    status='conn="Ventas" db="main" color="#2f7dd6" info="Ejecutando script · sentencia 2 de 3 · 00:04"'),
    {'tabs': [{'label': 'Consulta 1', 'kind': 'query', 'active': True, 'dirty': True, 'running': True, 'href': 'EditorRunning.dc.html', 'color': '#2f7dd6'},
              {'label': 'clientes', 'kind': 'table', 'href': 'DataGrid.dc.html', 'color': '#2f7dd6'}],
     'sql': SQL_3, 'columns': [{'name': 'estado', 'type': 'text', 'kind': 'text', 'w': '200px'}, {'name': 'n', 'type': 'integer', 'kind': 'num', 'w': '120px'}, {'name': 'importe', 'type': 'numeric', 'kind': 'num', 'w': '1fr'}],
     'rows': []})


# ---------------------------------------------------------------- 5. EditorDmlResult
def outcome(icon, tone, title, sub, actions, extra=''):
    return f'''      <div style="flex: 1; min-height: 0; padding: 22px 28px; display: flex; gap: 14px; overflow: hidden">
        <span style="width: 36px; height: 36px; flex: none; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: var(--{tone}-soft); color: var(--{tone})">{svg(icon, 18)}</span>
        <div style="flex: 1; min-width: 0">
          <div style="font-size: var(--fs-lg); font-weight: 600">{title}</div>
          <div style="margin-top: 2px; color: var(--text-dim)">{sub}</div>
          <div style="margin-top: 14px; display: flex; gap: 8px">{actions}</div>{extra}
        </div>
      </div>'''


write('EditorDmlResult', 'Sentencia ejecutada', shell(editor_doc(
    toolbar=run_toolbar(),
    editor=sql_editor('current="3" caret-line="3" run-range="1-3"'),
    head=band(std_tabs(res_count='· 2 filas afectadas · 9 ms')),
    body=outcome('check', 'ok', '2 filas actualizadas', 'UPDATE en <span class="mono">clientes</span> · 9 ms · confirmado al ejecutarse (modo Auto)',
                 f'<a href="DataGrid.dc.html" class="btn">{svg("table")}Abrir clientes</a><a href="HistoryPanel.dc.html" class="btn btn-ghost">{svg("history")}Ver en el historial</a>',
                 '<div class="help" style="margin-top: 18px">¿Quieres revisar antes de confirmar? Cambia a <a href="TxManualPending.dc.html">transacción manual</a>. '
                 f'{KBD("F5")} solo vuelve a leer consultas SELECT: nunca repite una escritura.</div>')),
    status='conn="Ventas" db="main" color="#2f7dd6" info="2 filas afectadas · 9 ms · ejecutada 14:12:04"'),
    {'tabs': TABS_EDITOR, 'sql': "UPDATE clientes\n   SET activo = false\n WHERE ciudad = 'Guaymas';"})

# ---------------------------------------------------------------- 6. EditorError (A-08)
badge_err = '<span class="chip" style="height: 18px; padding: 0 6px; background: var(--danger-soft); color: var(--danger)">1</span>'
err_body = f'''      <div role="log" aria-label="Mensajes de la ejecución" style="flex: 1; min-height: 0; overflow: hidden">
        <div style="display: flex; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border)">
          <span class="mono num" style="font-size: var(--fs-xs); color: var(--text-dim); width: 56px; flex: none; padding-top: 2px">14:18:15</span>
          <span style="display: flex; color: var(--text-dim); padding-top: 1px">{svg("info", 15)}</span><div style="flex: 1; min-width: 0; color: var(--text-dim)">Ejecutando la sentencia de la línea 1 en Ventas · main</div>
        </div>
        <div role="alert" style="display: flex; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--danger-soft); box-shadow: inset 3px 0 0 var(--danger)">
          <span class="mono num" style="font-size: var(--fs-xs); color: var(--text-dim); width: 56px; flex: none; padding-top: 2px">14:18:15</span>
          <span style="display: flex; color: var(--danger); padding-top: 1px">{svg("warning", 15)}</span>
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600">No existe la columna «telefono» en clientes</div>
            <div style="margin-top: 2px; color: var(--text-dim)">Sentencia 1 de 1 · línea 1, columna 16 · la consulta falló y no se modificó nada · 13 ms</div>
            <dl style="margin: 10px 0 0; display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: var(--fs-sm)">
              <dt style="color: var(--text-dim)">Mensaje del motor</dt><dd class="mono" style="margin: 0">no such column: telefono</dd>
              <dt style="color: var(--text-dim)">Código</dt><dd class="mono" style="margin: 0">SQLITE_ERROR (1)</dd>
            </dl>
            <div class="help" style="margin-top: 8px">Columnas de <span class="mono">clientes</span>: <span class="mono">id, nombre, email, ciudad, saldo, activo, alta</span>. ¿Querías <span class="mono">email</span>?</div>
            <div style="margin-top: 12px; display: flex; gap: 8px"><a href="EditorError.dc.html" class="btn">Ir a la línea 1</a><button type="button" class="btn btn-ghost">{svg("copy")}Copiar error</button><a href="HistoryPanel.dc.html" class="btn btn-ghost">{svg("history")}Buscar en el historial</a></div>
          </div>
        </div>
      </div>'''
err_tip = f'''  <div role="tooltip" style="position: absolute; left: 500px; top: 152px; z-index: 5; display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--overlay); border: 1px solid var(--border); border-left: 3px solid var(--danger); border-radius: var(--r-sm); box-shadow: var(--shadow-sm); font-size: var(--fs-sm)">
    <span style="display: flex; color: var(--danger)">{svg("warning", 13)}</span>No existe la columna «telefono» en clientes
  </div>'''
write('EditorError', 'Error de la consulta', shell(editor_doc(
    toolbar=run_toolbar(),
    editor=sql_editor('current="1" caret-line="1" error-word="telefono"'),
    head=band(std_tabs('msg', res_count='', msg_badge=badge_err)),
    body=err_body), status='conn="Ventas" db="main" color="#2f7dd6" info="Error en la línea 1 · 13 ms"', overlay=err_tip),
    {'tabs': TABS_EDITOR, 'sql': 'SELECT nombre, telefono FROM clientes'})


# ---------------------------------------------------------------- 7. EditorMultipleResults
def rset(n, label, count, on):
    return (f'<a href="EditorMultipleResults.dc.html" role="tab" aria-selected="{"true" if on else "false"}" style="height: 35px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; margin-right: 14px; text-decoration: none; white-space: nowrap; '
            f'border-bottom: 2px solid {"var(--accent)" if on else "transparent"}; color: {"var(--text)" if on else "var(--text-dim)"}; font-weight: {600 if on else 400}">'
            f'<span class="num" style="color: var(--text-dim)">{n} ·</span><span class="mono" style="font-size: var(--fs-sm)">{label}</span><span class="num" style="font-weight: 400; color: var(--text-dim)">{count}</span></a>')


multi_tabs = (rset(1, 'clientes', '12', True) + rset(2, 'estado, n, importe', '4', False) + rset(3, 'productos', '8', False)
              + '<span style="width: 1px; height: 18px; background: var(--border); margin-right: 14px"></span>' + rtab('Mensajes', 'EditorError.dc.html') + rtab('Plan', 'ExplainPlan.dc.html'))
write('EditorMultipleResults', 'Varios resultados', shell(editor_doc(
    toolbar=run_toolbar(label='Ejecutar sentencia'),
    editor=sql_editor('current="1" caret-line="1" run-range="1-1"', h=150),
    head=band([multi_tabs], grid_actions(rows=12)),
    body=GRID + '''
      <div style="height: 30px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">
        <span class="num">Filas 1–12 de 12</span><span class="help">Doble clic, F2 o empieza a escribir para editar una celda</span>''' + FLEX + '''<span class="num">Script: 3 sentencias · 14 ms</span>
      </div>'''),
    status='conn="Ventas" db="main" color="#2f7dd6" info="clientes · 12 filas · 7 columnas · 14 ms · ejecutado 14:18:11"'),
    {'tabs': TABS_EDITOR, 'sql': SQL_3, 'columns': COLS_CLI, 'rows': ROWS_CLI})


# ---------------------------------------------------------------- menus over EditorResult
# measured anchors in EditorResult (toolbar y = 74..118): see the screenshots
def two(title, sub, on=False, href='#'):
    return (f'<a href="{href}" class="mi{" on" if on else ""}" role="menuitemradio" aria-checked="{"true" if on else "false"}" style="height: auto; align-items: flex-start; padding: 7px 10px">'
            f'<span style="width: 15px; display: flex; color: var(--accent-text)">{svg("check", 15) if on else ""}</span>'
            f'<span style="display: flex; flex-direction: column; gap: 1px"><span style="font-weight: 600">{title}</span><span style="font-size: var(--fs-sm); color: var(--text-dim)">{sub}</span></span></a>')


# 8. TxControlsMenu
tx_menu = f'''  <div class="menu" role="menu" aria-label="Modo de transacción" style="left: {{TXL}}px; top: 114px; width: 330px">
    <div class="lbl" style="padding: 6px 10px 4px">Modo de transacción</div>
    {two("Auto", "Cada sentencia se confirma al ejecutarse.", True, "EditorResult.dc.html")}
    {two("Manual", "Agrupa las sentencias hasta Commit o Revertir.", False, "TxManualPending.dc.html")}
    <div class="msep"></div>
    <span class="mi dis" role="menuitem" aria-disabled="true">{svg("check", 15)}Commit<span class="k">Alt+Mayús+C</span></span>
    <span class="mi dis" role="menuitem" aria-disabled="true">{svg("refresh", 15)}Revertir<span class="k">Alt+Mayús+R</span></span>
    <div class="msep"></div>
    <div class="help" style="padding: 4px 10px 6px; line-height: 1.45">Commit y Revertir se activan en modo Manual con una transacción abierta. Si cierras la pestaña o desconectas con cambios sin confirmar, Squaero pregunta antes.</div>
  </div>'''


def anchored(name, title, overlay):
    write(name, title, overlay_on('EditorResult', overlay), {})


# 9. TxManualPending (A-07, R-17): persistent amber band + Commit / Revertir
stmt = lambda n, sql, res: (f'<div style="display: flex; align-items: center; gap: 10px; height: 28px; border-bottom: 1px solid var(--border)"><span class="num" style="width: 16px; color: var(--text-dim); font-size: var(--fs-sm)">{n}</span>'
                            f'<span class="mono" style="flex: 1; font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{sql}</span><span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">{res}</span></div>')
tx_band = f'''      <div role="status" aria-label="Transacción abierta" style="height: 40px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 14px; background: var(--warn-soft); border-bottom: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); box-shadow: inset 3px 0 0 var(--warn)">
        <span style="display: flex; color: var(--warn)">{svg("clock", 16)}</span>
        <span style="font-weight: 600; white-space: nowrap">Transacción abierta · 2 sentencias</span>
        <span class="help" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0" title="Solo esta sesión ve los cambios hasta el Commit">Solo esta sesión ve los cambios</span>
        {FLEX}
        <a href="EditorDmlResult.dc.html" class="btn" title="Commit: confirmar la transacción (Alt+Mayús+C)">{svg("check", 15, "color: var(--ok)")}Commit <span class="kbd">Alt+Mayús+C</span></a>
        <a href="EditorResult.dc.html" class="btn" title="Revertir la transacción (Alt+Mayús+R)">{svg("refresh", 15)}Revertir <span class="kbd">Alt+Mayús+R</span></a>
      </div>'''
pend_extra = f'''
          <div style="margin-top: 20px; max-width: 620px">
            <div class="lbl" style="margin-bottom: 4px">Sentencias en esta transacción</div>
            {stmt(1, "UPDATE clientes SET saldo = saldo - 120 WHERE id = 4;", "1 fila")}
            {stmt(2, "DELETE FROM pedidos WHERE id = 31;", "1 fila")}
          </div>'''
write('TxManualPending', 'Transacción abierta', shell(editor_doc(
    toolbar=run_toolbar(tx='pending'),
    editor=sql_editor('current="2" caret-line="2" run-range="2-2"', h=150),
    txband=tx_band,
    head=band(std_tabs(res_count='· 1 fila afectada · 6 ms')),
    body=outcome('info', 'accent', '1 fila eliminada · pendiente de Commit', 'DELETE en <span class="mono">pedidos</span> · 6 ms · forma parte de la transacción abierta',
                 '', pend_extra)),
    explorer='state="connected" tree="tables" selected="" tx="{{yes}}"',
    status='conn="Ventas" db="main" color="#2f7dd6" tx="Transacción · 2 sentencias" info="1 fila afectada · 6 ms"'),
    {'tabs': TABS_EDITOR, 'sql': 'UPDATE clientes SET saldo = saldo - 120 WHERE id = 4;\nDELETE FROM pedidos WHERE id = 31;'})


# ---------------------------------------------------------------- 10. VariablesDialog (A-35)
def var_row(tok, val, ph, focus=False, err=''):
    cls = 'field is-focus' if focus else 'field'
    vid = 'var-' + tok.strip(':')
    errst = '; border-color: var(--danger); box-shadow: 0 0 0 1px var(--danger)' if err else ''
    e = (f'<div id="{vid}-err" style="grid-column: 2 / 4; margin-top: -6px; display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--danger)">{svg("warning", 13)}{err}</div>' if err else '')
    desc = f' aria-invalid="true" aria-describedby="{vid}-err"' if err else ''
    return (f'<label for="{vid}" class="mono" style="font-size: var(--fs-sm); color: var(--accent-text)">{tok}</label>'
            f'<input id="{vid}" class="{cls}" value="{val}" placeholder="{ph}"{desc} style="width: 100%; font-family: var(--font-mono); font-size: var(--fs-sm){errst}">'
            f'<label style="display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-dim)"><input type="checkbox" {CHK} aria-label="{tok} es NULL">NULL</label>{e}')


vars_dlg = f'''  <div class="dlg-scrim">
    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="vars-title" style="width: 560px">
      <div class="dlg-h"><span id="vars-title">Valores de la consulta</span>{FLEX}<a href="EditorResult.dc.html" class="btn btn-icon" aria-label="Cerrar (Esc)">{svg("close", 16)}</a></div>
      <div class="dlg-b">
        <div style="color: var(--text-dim)">La sentencia lleva 3 variables. Los valores se recuerdan en esta pestaña.</div>
        <div style="display: grid; grid-template-columns: 100px 1fr auto; gap: 12px 12px; align-items: center; padding: 3px">
          {var_row(":cliente", "4", "valor")}
          {var_row(":estado", "enviado", "texto, tal cual")}
          {var_row(":desde", "", "AAAA-MM-DD", focus=True, err="Falta un valor para :desde · escríbelo o márcalo como NULL")}
        </div>
        <div class="help">Los textos se envían como parámetros: no hace falta poner comillas.</div>
      </div>
      <div class="dlg-f">
        <span class="help">{KBD("Intro")} ejecutar · {KBD("Esc")} cancelar</span>
        {FLEX}
        <span class="dlg-actions"><a href="EditorResult.dc.html" class="btn btn-primary">{svg("play", 14)}Ejecutar</a><a href="EditorResult.dc.html" class="btn">Cancelar</a></span>
      </div>
    </div>
  </div>'''
write('VariablesDialog', 'Valores de la consulta', shell(editor_doc(
    toolbar=run_toolbar(),
    editor=sql_editor('current="4" caret-line="4" run-range="1-4"'),
    head=band(std_tabs(res_count='')),
    body=empty_results()), overlay=vars_dlg, status='conn="Ventas" db="main" color="#2f7dd6" info="Sin ejecutar"'),
    {'tabs': TABS_EDITOR, 'sql': 'SELECT * FROM pedidos\nWHERE cliente_id = :cliente\n  AND estado = :estado\n  AND fecha >= :desde;'})

# ---------------------------------------------------------------- 11. SnippetSaveInline (R-20: Guardar primary of its own form)
save_bar = f'''      <div role="form" aria-label="Guardar como snippet" style="height: 44px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 14px; border-bottom: 1px solid var(--border); background: var(--accent-soft)">
        <span style="display: flex; color: var(--accent-text)">{svg("bookmark")}</span>
        <label for="snip-name" style="font-weight: 600; white-space: nowrap">Guardar como snippet</label>
        <input id="snip-name" class="field is-focus" value="Pedidos por cliente" placeholder="Nombre del snippet" style="width: 240px">
        <span class="seg" role="radiogroup" aria-label="Qué guardar"><a href="SnippetSaveInline.dc.html" role="radio" class="on" aria-checked="true" style="white-space: nowrap">Sentencia</a><a href="SnippetSaveInline.dc.html" role="radio" aria-checked="false" style="white-space: nowrap">Script</a></span>
        <span class="help" style="white-space: nowrap">{KBD("Intro")} guardar · {KBD("Esc")} cancelar</span>
        {FLEX}
        <a href="SnippetsTool.dc.html" class="btn btn-primary">{svg("check", 15)}Guardar</a>
        <a href="EditorResult.dc.html" class="btn btn-icon" aria-label="Cancelar (Esc)" title="Cancelar (Esc)">{svg("close", 15)}</a>
      </div>'''
write('SnippetSaveInline', 'Guardar snippet', shell(result_doc(bar=save_bar, h=138), status=ST_RESULT), DATA_RESULT)


# ---------------------------------------------------------------- 12/13. Explain plans (A-09)
def plan_tree(nodes, sel, max_rows):
    """nodes: (depth, op, detail, est, real, self_cost, total_cost, ms, has_children). Self cost share drives the bar."""
    total = sum(n[5] for n in nodes)
    hot = max(range(len(nodes)), key=lambda i: nodes[i][5])
    cols = '1fr 120px 150px 70px'
    head = ''.join(f'<span style="padding: 0 10px; {"text-align: right;" if i else ""}">{h}</span>' for i, h in enumerate(['Operación', 'Filas (est. / reales)', 'Coste propio', 'Tiempo']))
    out = ''
    for i, (d, op, det, est, real, own, tot, ms, kids) in enumerate(nodes):
        pct = round(own * 100 / total)
        rw = round(real * 100 / max_rows)
        bar_c = 'var(--warn)' if i == hot else 'var(--accent)'
        bg = 'var(--sel)' if i == sel else ('var(--zebra)' if i % 2 else 'transparent')
        elbow = (f'<span style="width: 10px; height: 16px; flex: none; margin-top: -12px; border-left: 1px solid var(--border-strong); border-bottom: 1px solid var(--border-strong); border-bottom-left-radius: 4px"></span>' if d else '')
        caret = svg('chev', 12, 'color: var(--text-dim); flex: none') if kids else '<span style="width: 12px; flex: none"></span>'
        hotchip = '<span class="chip" style="height: 18px; background: var(--warn-soft); color: var(--warn)">Más costoso</span>' if i == hot else ''
        out += (f'<a href="#" role="treeitem" aria-level="{d + 1}" aria-selected="{"true" if i == sel else "false"}" class="{"focus-in" if i == sel else ""}" style="display: grid; grid-template-columns: {cols}; align-items: center; height: 36px; text-decoration: none; color: var(--text); border-bottom: 1px solid var(--border); background: {bg}">'
                f'<span style="display: flex; align-items: center; gap: 6px; padding-left: {10 + d * 22}px; min-width: 0">{elbow}{caret}<span style="font-weight: 600; white-space: nowrap">{op}</span>'
                f'<span class="mono" style="font-size: var(--fs-sm); color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{det}</span>{hotchip}</span>'
                f'<span style="padding: 0 10px; display: flex; flex-direction: column; align-items: flex-end; gap: 3px"><span class="mono num" style="font-size: var(--fs-sm)">{est} <span style="color: var(--text-dim)">/</span> {real}</span>'
                f'<span style="width: 90px; height: 3px; border-radius: 2px; background: var(--hover)"><span style="display: block; width: {rw}%; height: 3px; border-radius: 2px; background: var(--type-dot-num)"></span></span></span>'
                f'<span style="padding: 0 10px; display: flex; align-items: center; gap: 8px"><span style="flex: 1; height: 8px; border-radius: 4px; background: var(--hover)"><span style="display: block; width: {max(pct, 2)}%; height: 8px; border-radius: 4px; background: {bar_c}"></span></span>'
                f'<span class="mono num" style="width: 34px; text-align: right; font-size: var(--fs-sm); color: var(--text-dim)">{pct} %</span></span>'
                f'<span class="mono num" style="padding: 0 10px; text-align: right; font-size: var(--fs-sm); color: var(--text-dim)">{ms}</span></a>')
    return (f'<div role="tree" aria-label="Plan de ejecución" style="flex: 1; min-width: 0; overflow: hidden">'
            f'<div style="display: grid; grid-template-columns: {cols}; height: 30px; align-items: center; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); font-weight: 600">{head}</div>{out}</div>')


def plan_detail(title, chip, props, note):
    dl = ''.join(f'<dt style="color: var(--text-dim)">{k}</dt><dd class="{"mono" if m else ""}" style="margin: 0; {"font-size: var(--fs-sm);" if m else ""}">{v}</dd>' for k, v, m in props)
    return (f'<aside aria-label="Detalle del nodo" style="width: 270px; flex: none; border-left: 1px solid var(--border); padding: 12px 16px; overflow: hidden">'
            f'<div style="font-weight: 600; font-size: var(--fs-lg)">{title}</div><div style="margin-top: 6px">{chip}</div>'
            f'<dl style="margin: 12px 0 0; display: grid; grid-template-columns: 96px 1fr; gap: 6px 10px; font-size: var(--fs-md)">{dl}</dl>'
            f'<div class="help" style="margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); line-height: 1.5">{note}</div></aside>')


LEGEND = ('<span class="help" style="display: inline-flex; align-items: center; gap: 10px; white-space: nowrap">'
          '<span style="display: inline-flex; align-items: center; gap: 5px"><span style="width: 14px; height: 8px; border-radius: 4px; background: var(--accent)"></span>Coste propio</span>'
          '<span style="display: inline-flex; align-items: center; gap: 5px"><span style="width: 14px; height: 8px; border-radius: 4px; background: var(--warn)"></span>Nodo más costoso</span>'
          '<span style="display: inline-flex; align-items: center; gap: 5px"><span style="width: 14px; height: 3px; border-radius: 2px; background: var(--type-dot-num)"></span>Filas reales</span></span>')


def plan_bar(right, refresh_href='#'):
    return f'''      <div role="toolbar" aria-label="Opciones del plan" style="height: 36px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--border)">
        <span class="seg" role="radiogroup" aria-label="Vista del plan"><a href="#" role="radio" class="on" aria-checked="true">Árbol</a><a href="#" role="radio" aria-checked="false">Tabla</a><a href="#" role="radio" aria-checked="false">Texto</a></span>
        <label style="display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); white-space: nowrap"><input type="checkbox" checked {CHK}>Con ANALYZE <span style="color: var(--text-dim)">(ejecuta la consulta)</span></label>
        {LEGEND}
        {FLEX}
        <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim); white-space: nowrap">{right}</span>
        <a href="{refresh_href}" class="btn btn-icon" aria-label="Refrescar el plan (F5)" title="Refrescar el plan (F5)" {IB}>{svg("refresh", 15)}</a>
      </div>'''


PG_EXPLORER = 'state="connected" tree="tables" conn-name="Producción (PostgreSQL)" conn-color="#c4302b" safe="{{yes}}" second="{{no}}" selected=""'
PG_STATUS = 'conn="Producción" db="ventas" color="#c4302b" safe="{{yes}}"'
nodes1 = [(0, 'Sort', 'clave: p.fecha', 1240, 1238, 54.2, 152.4, '4.1 ms', True),
          (1, 'Hash Join', 'p.cliente_id = c.id', 1240, 1238, 15.7, 98.2, '3.2 ms', True),
          (2, 'Seq Scan', 'pedidos p', 1240, 1238, 64.0, 64.0, '1.6 ms', False),
          (2, 'Hash', 'buckets 1024 · 41 kB', 412, 412, 4.4, 18.5, '0.6 ms', True),
          (3, 'Seq Scan', 'clientes c', 412, 412, 14.1, 14.1, '0.4 ms', False)]
det1 = plan_detail('Seq Scan · pedidos', '<span class="chip" style="background: var(--warn-soft); color: var(--warn)">42 % del coste total</span>',
                   [('Relación', 'pedidos (alias p)', True), ('Filas est.', '1240', True), ('Filas reales', '1238', True), ('Bucles', '1', True),
                    ('Ancho', '48 bytes', True), ('Coste', '0.00 … 64.00', True), ('Tiempo real', '1.6 ms', True)],
                   'Lee la tabla completa. Con ANALYZE las filas y los tiempos son medidos; sin él, son estimaciones del planificador.')
analyzed = (f'<span class="help" style="white-space: nowrap; margin-right: 8px">Sentencia de las líneas 1–4 · 14:30:02</span>')
write('ExplainPlan', 'Plan de ejecución', shell(editor_doc(
    toolbar=run_toolbar(conn=PROD),
    editor=sql_editor('current="4" caret-line="4" run-range="1-4"', h=118),
    head=band(std_tabs('plan', res_count=''), analyzed),
    body=plan_bar('Coste total 152.40 · 4.1 ms') + f'\n      <div style="flex: 1; min-height: 0; display: flex">{plan_tree(nodes1, 2, 1240)}{det1}</div>'),
    explorer=PG_EXPLORER, status=PG_STATUS + ' info="Plan · 5 nodos · 4.1 ms"', wtitle='Consulta 2 — Producción — Squaero'),
    {'tabs': [{'label': 'Consulta 1', 'kind': 'query', 'dirty': True, 'href': 'EditorResult.dc.html', 'color': '#2f7dd6', 'conn': 'Ventas'},
              {'label': 'Consulta 2', 'kind': 'query', 'active': True, 'href': 'ExplainPlan.dc.html', 'color': '#c4302b', 'conn': 'Producción', 'safe': True}], 'sql': SQL_JOIN})

nodes2 = [(0, 'Limit', '1000 filas', 1000, 1000, 2.1, 88.1, '2.3 ms', True),
          (1, 'Sort', 'clave: fecha DESC · top-N heapsort', 1240, 1000, 22.0, 86.0, '2.1 ms', True),
          (2, 'Seq Scan', 'pedidos', 1240, 1240, 64.0, 64.0, '0.9 ms', False)]
det2 = plan_detail('Sort · pedidos', '<span class="chip" style="background: var(--accent-soft); color: var(--accent-text)">25 % del coste total</span>',
                   [('Clave', 'fecha DESC', True), ('Método', 'top-N heapsort', True), ('Memoria', '92 kB', True), ('Filas est.', '1240', True),
                    ('Filas reales', '1000', True), ('Coste', '83.90 … 86.00', True), ('Tiempo real', '2.1 ms', True)],
                   'Ordena en memoria y se queda con las primeras 1000 filas; no necesita escribir en disco.')
plan_doc = f'''      <div role="toolbar" aria-label="Acciones del plan" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <a href="ExplainPlanTable.dc.html" class="btn btn-primary" title="Refrescar el plan (F5)">{svg("refresh", 14)}Refrescar</a>
        {SEP}
        <a href="ExplainPlan.dc.html" class="btn btn-ghost">{svg("query")}Abrir en el editor</a>
        <button type="button" class="btn btn-ghost">{svg("copy")}Copiar plan</button>
        {FLEX}
        <span class="chip" style="background: var(--hover); color: var(--text-dim); font-weight: 500">{svg("lock", 11)}Producción · solo lectura</span>
      </div>
      <div style="flex: none; padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px">
        <div style="display: flex; align-items: center; gap: 8px"><span class="lbl">Consulta analizada</span>{FLEX}
          <span class="chip" style="background: var(--hover); color: var(--text-dim)">Coste total 88.10</span><span class="chip" style="background: var(--hover); color: var(--text-dim)">2.3 ms</span><span class="chip" style="background: var(--hover); color: var(--text-dim)">1000 filas</span></div>
        <code class="mono" style="font-size: var(--fs-sm); color: var(--text-dim)"><span style="color: var(--syntax-keyword)">SELECT</span> * <span style="color: var(--syntax-keyword)">FROM</span> pedidos <span style="color: var(--syntax-keyword)">ORDER BY</span> fecha <span style="color: var(--syntax-keyword)">DESC LIMIT</span> <span style="color: var(--syntax-number)">1000</span></code>
      </div>
{plan_bar("3 nodos · 14:32:40", "ExplainPlanTable.dc.html")}
      <div style="flex: 1; min-height: 0; display: flex">{plan_tree(nodes2, 1, 1240)}{det2}</div>'''
write('ExplainPlanTable', 'Plan de la tabla', shell(plan_doc,
    explorer='state="connected" tree="tables" conn-name="Producción (PostgreSQL)" conn-color="#c4302b" safe="{{yes}}" second="{{no}}" selected="pedidos"',
    status=PG_STATUS + ' info="Plan · 3 nodos · 2.3 ms"', wtitle='Plan · pedidos — Producción — Squaero'),
    {'tabs': [{'label': 'pedidos', 'kind': 'table', 'href': 'DataGrid.dc.html', 'color': '#c4302b', 'safe': True},
              {'label': 'Plan · pedidos', 'kind': 'tool', 'active': True, 'href': 'ExplainPlanTable.dc.html', 'color': '#c4302b'}]})


# ---------------------------------------------------------------- toolbar menus (anchored to EditorResult's toolbar)
def mi(label, icon='', k='', href='#', on=False, sub=False, extra=''):
    ic = svg(icon, 15, 'color: var(--text-dim); flex: none') if icon else '<span style="width: 15px; flex: none"></span>'
    kk = f'<span class="k">{k}</span>' if k else ''
    ch = svg('chevr', 13, 'margin-left: auto; color: var(--text-dim)') if sub else ''
    return f'<a href="{href}" class="mi{" on" if on else ""}" role="menuitem"{" aria-haspopup=\"menu\" aria-expanded=\"true\"" if sub and on else ""}>{ic}<span>{label}</span>{extra}{kk}{ch}</a>'


MORE_ITEMS = lambda hist_on=False: f'''
    {mi("Plan de ejecución", "plan", "Ctrl+Mayús+X", "ExplainPlan.dc.html")}
    {mi("Ejecutar con EXPLAIN", "play", "", "ExplainPlan.dc.html")}
    <div class="msep"></div>
    {mi("Historial", "history", "", "EditorRecentQueries.dc.html", on=hist_on, sub=True)}
    {mi("Versiones de esta pestaña…", "clock", "", "LocalHistory.dc.html")}
    {mi("Variables…", "", "", "VariablesDialog.dc.html", extra='<span class="mono" style="color: var(--text-dim); font-size: var(--fs-xs)">:var</span>')}
    <div class="msep"></div>
    {mi("Abrir .sql…", "open", "Ctrl+O")}
    {mi("Guardar .sql", "save", "Ctrl+S")}
    {mi("Guardar como snippet…", "bookmark", "Ctrl+Mayús+S", "SnippetSaveInline.dc.html")}'''

# x of the right edge of main (Más is right-aligned)
more_menu = f'''  <div class="menu" role="menu" aria-label="Más acciones de la consulta" style="right: 10px; top: 114px; width: 290px">{MORE_ITEMS()}
  </div>'''

recent = lambda sql, when, href='EditorResult.dc.html', dot='': (f'<a href="{href}" class="mi" role="menuitem" title="{sql}">'
                                                                f'<span style="width: 6px; height: 6px; flex: none; border-radius: 999px; background: {dot or "transparent"}"></span>'
                                                                f'<span class="mono" style="flex: 1; min-width: 0; font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{sql}</span><span class="k">{when}</span></a>')
recent_menu = f'''  <div class="menu" role="menu" aria-label="Más acciones de la consulta" style="right: 10px; top: 114px; width: 290px">{MORE_ITEMS(True)}
  </div>
  <div class="menu" role="menu" aria-label="Consultas recientes en Ventas" style="right: 304px; top: 182px; width: 440px">
    <div class="lbl" style="padding: 6px 10px 4px">Recientes en Ventas · se insertan en el editor</div>
    {recent("SELECT * FROM productos WHERE existencias &lt; 10", "hace 1 min")}
    {recent("SELECT c.nombre, c.ciudad, p.fecha, p.estado, p.total FROM clientes c JOIN pedidos p …", "hace 3 min")}
    {recent("UPDATE clientes SET activo = false WHERE ciudad = 'Guaymas'", "hace 9 min", "EditorDmlResult.dc.html")}
    {recent("SELECT nombre, telefono FROM clientes", "hace 12 min", "EditorError.dc.html", "var(--danger)")}
    {recent("SELECT estado, COUNT(*) AS n, SUM(total) AS total FROM pedidos GROUP BY estado", "ayer")}
    <div class="msep"></div>
    <a href="HistoryPanel.dc.html" class="mi" role="menuitem">{svg("history", 15, "color: var(--text-dim)")}Abrir el panel de historial<span class="k">Ctrl+Mayús+H</span></a>
  </div>'''

run_menu = f'''  <div class="menu" role="menu" aria-label="Qué ejecutar" style="left: {{RUNL}}px; top: 114px; width: 360px">
    <a href="EditorResult.dc.html" class="mi on" role="menuitemradio" aria-checked="true">{svg("check", 15, "color: var(--accent-text); flex: none")}<span>Sentencia actual <span style="color: var(--text-dim)">· líneas 2–5</span></span><span class="k">Ctrl+Intro</span></a>
    <span class="mi dis" role="menuitemradio" aria-checked="false" aria-disabled="true"><span style="width: 15px; flex: none"></span><span>Selección <span>· no hay texto seleccionado</span></span><span class="k">Ctrl+Intro</span></span>
    <a href="EditorMultipleResults.dc.html" class="mi" role="menuitemradio" aria-checked="false"><span style="width: 15px; flex: none"></span><span>Script completo <span style="color: var(--text-dim)">· 2 sentencias</span></span><span class="k">Ctrl+Mayús+Intro</span></a>
    <div class="msep"></div>
    <div role="note" style="display: flex; gap: 8px; margin: 2px 4px 4px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--warn-soft); font-size: var(--fs-sm); line-height: 1.45">
      <span style="display: flex; color: var(--warn); padding-top: 1px">{svg("warning", 14)}</span>
      <span>El script completo incluye un <span class="mono">UPDATE</span> (línea 7). En modo Auto se confirma al ejecutarse. <a href="TxManualPending.dc.html">Usar transacción manual</a></span>
    </div>
    <div class="help" style="padding: 2px 10px 6px">El botón dice siempre qué va a ejecutar; el editor resalta ese bloque.</div>
  </div>'''

conn_row = lambda color, name, eng, dbs, on=False, safe=False, href='EditorResult.dc.html': (
    f'<div role="group" aria-label="{name}" style="padding: 2px 0">'
    f'<div style="height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-weight: 600"><span style="width: 8px; height: 8px; border-radius: 50%; background: {color}; box-shadow: 0 0 0 2px color-mix(in srgb, {color} 25%, transparent)"></span>{name}'
    f'<span style="font-weight: 400; font-size: var(--fs-xs); color: var(--text-dim)">{eng}</span>'
    + (f'<span class="chip" style="height: 18px; margin-left: auto; background: var(--hover); color: var(--text-dim); font-weight: 500">{svg("lock", 11)}Solo lectura</span>' if safe else '')
    + '</div>'
    + ''.join(f'<a href="{h}" class="mi{" on" if o else ""}" role="option" aria-selected="{"true" if o else "false"}" style="padding-left: 26px">{svg("database", 14, "color: var(--obj-database); flex: none")}<span class="mono" style="font-size: var(--fs-sm)">{d}</span>'
              f'{svg("check", 14, "margin-left: auto; color: var(--accent-text)") if o else ""}</a>' for d, o, h in dbs)
    + '</div>')
conn_menu = f'''  <div class="menu" role="listbox" aria-label="Conexión y base de esta pestaña" style="left: 314px; top: 114px; width: 320px">
    <div class="lbl" style="padding: 6px 10px 2px">Conexiones abiertas</div>
    {conn_row("#2f7dd6", "Ventas", "SQLite", [("main", True, "EditorResult.dc.html"), ("archivo_2024", False, "EditorResult.dc.html")])}
    {conn_row("#c4302b", "Producción", "PostgreSQL", [("ventas", False, "ExplainPlan.dc.html"), ("ventas_hist", False, "ExplainPlan.dc.html")], safe=True)}
    <div class="msep"></div>
    <div class="lbl" style="padding: 6px 10px 2px">Guardadas · sin conectar</div>
    <a href="ConnectionSearch.dc.html" class="mi" role="option" aria-selected="false"><span style="width: 8px; height: 8px; border-radius: 50%; background: #2e9e52; opacity: .6"></span>Ventas copia<span class="k">conectar</span></a>
    <a href="ConnectionSearch.dc.html" class="mi" role="option" aria-selected="false">{svg("plus", 15, "color: var(--text-dim)")}Otra conexión…</a>
    <div class="msep"></div>
    <div class="help" style="padding: 4px 10px 6px; line-height: 1.45">Cambia solo esta pestaña. El color de la conexión aparece en la pestaña y en la barra de estado.</div>
  </div>'''


def toolbar_overlay(name, title, menu, **kw):
    """Menu screen: full EditorResult with the toolbar trigger drawn open, plus the menu and a click-away layer."""
    close = '  <a href="EditorResult.dc.html" aria-label="Cerrar menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>\n'
    write(name, title, shell(result_doc(toolbar=run_toolbar(**kw)), status=ST_RESULT, overlay=close + menu), DATA_RESULT)


# left offsets measured on the EditorResult render (toolbar starts at x=314)
toolbar_overlay('TxControlsMenu', 'Modo de transacción', tx_menu.replace('{TXL}', '650'), tx_open=True)
toolbar_overlay('EditorRunMenu', 'Qué ejecutar', run_menu.replace('{RUNL}', '444'), run_open=True)
toolbar_overlay('EditorMoreMenu', 'Más acciones de la consulta', more_menu, more_open=True)
toolbar_overlay('EditorRecentQueries', 'Consultas recientes', recent_menu, more_open=True)
toolbar_overlay('EditorConnectionMenu', 'Conexión de la consulta', conn_menu, conn_open=True)


# ---------------------------------------------------------------- list helpers
def item_row(title_html, meta, on=False, href='#', mono=True):
    return (f'<a href="{href}" role="option" aria-selected="{"true" if on else "false"}" style="display: block; padding: 8px 10px; border-radius: var(--r-sm); text-decoration: none; color: var(--text); '
            f'background: {"var(--sel)" if on else "transparent"}{"; box-shadow: inset 2px 0 0 var(--accent)" if on else ""}">'
            f'<div class="{"mono" if mono else ""}" style="font-size: {"var(--fs-sm)" if mono else "var(--fs-md)"}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis{"" if mono else "; font-weight: 600"}">{title_html}</div>'
            f'<div style="margin-top: 3px; display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-dim); white-space: nowrap; overflow: hidden">{meta}</div></a>')


group = lambda t: f'<div class="lbl" style="padding: 10px 10px 4px">{t}</div>'
chipw = lambda t, tone='warn': f'<span class="chip" style="height: 16px; padding: 0 6px; background: var(--{tone}-soft); color: var(--{tone})">{t}</span>'
dot = lambda c: f'<span style="width: 6px; height: 6px; flex: none; border-radius: 50%; background: {c}"></span>'


def side_panel(title, label, head_btns, search_ph, body, foot):
    return f'''<aside aria-label="{label}" style="width: 248px; height: 738px; flex: none; box-sizing: border-box; display: flex; flex-direction: column; background: var(--chrome)">
      <div style="height: 40px; flex: none; display: flex; align-items: center; gap: 2px; padding: 0 8px 0 14px">
        <span style="font-weight: 600; flex: 1">{title}</span>{head_btns}
      </div>
      <div style="padding: 0 10px 8px"><span class="field" style="width: 100%; display: flex; align-items: center; gap: 6px">{svg("search", 14, "color: var(--text-dim)")}<input aria-label="{search_ph}" placeholder="{search_ph}" style="flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text)"></span></div>
      {body}
      <div class="help" style="flex: none; padding: 10px 14px; border-top: 1px solid var(--border); line-height: 1.45">{foot}</div>
    </aside>'''


# ---------------------------------------------------------------- 15. HistoryPanel (Rail "history" swaps the side column)
sel_hist = f'''<div style="margin: 2px 0 6px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--content)">
          <div class="mono" style="font-size: var(--fs-xs); white-space: pre-wrap; line-height: 1.5"><span style="color: var(--syntax-keyword)">SELECT</span> c.nombre, c.ciudad, p.fecha, p.estado, p.total
<span style="color: var(--syntax-keyword)">FROM</span> clientes c <span style="color: var(--syntax-keyword)">JOIN</span> pedidos p …</div>
          <div class="help" style="margin-top: 6px">Ventas · main · 11 ms · 8 filas · sentencia actual</div>
          <div style="margin-top: 8px; display: flex; gap: 6px"><a href="EditorResult.dc.html" class="btn" style="height: 26px; font-size: var(--fs-sm)">Insertar</a><a href="EditorResult.dc.html" class="btn btn-ghost" style="height: 26px; font-size: var(--fs-sm)">{svg("plus", 13)}En pestaña nueva</a></div>
        </div>'''
hist_body = ('<div style="padding: 0 10px 6px; display: flex; gap: 6px"><span class="seg" role="radiogroup" aria-label="Qué mostrar">'
             '<a href="HistoryPanel.dc.html" role="radio" class="on" aria-checked="true">Todas</a><a href="HistoryPanel.dc.html" role="radio" aria-checked="false">Esta conexión</a><a href="HistoryPanel.dc.html" role="radio" aria-checked="false">Errores</a></span></div>'
             '<div role="listbox" aria-label="Consultas ejecutadas" style="flex: 1; min-height: 0; padding: 0 6px; overflow: hidden">'
             + group('Hoy')
             + item_row('SELECT * FROM productos WHERE existencias &lt; 10', dot('#2f7dd6') + 'Ventas · 14:18 · 5 ms · 3 filas')
             + item_row('SELECT c.nombre, c.ciudad, p.fecha, p.estado…', dot('#2f7dd6') + 'Ventas · 14:15 · 11 ms · 8 filas', True) + sel_hist
             + item_row("UPDATE clientes SET activo = false WHERE…", dot('#2f7dd6') + 'Ventas · 14:12 · 2 afectadas')
             + item_row('SELECT nombre, telefono FROM clientes', dot('#2f7dd6') + 'Ventas · 14:10 · ' + chipw('Error', 'danger'))
             + group('Ayer')
             + item_row('SELECT estado, COUNT(*) AS n, SUM(total)…', dot('#c4302b') + 'Producción · 18:02 · 1.4 s · ' + chipw('Lenta'))
             + '</div>')
hist_side = side_panel('Historial', 'Historial de consultas',
                       f'<button type="button" class="btn btn-icon" aria-label="Limpiar historial…" title="Limpiar historial…">{svg("trash", 15)}</button>',
                       'Buscar en el historial', hist_body,
                       f'Doble clic inserta en la pestaña activa. {KBD("Ctrl", "Mayús", "H")} abre y cierra el panel.')
write('HistoryPanel', 'Historial de consultas', shell(result_doc(), rail='history', side=hist_side, status=ST_RESULT), DATA_RESULT)

# ---------------------------------------------------------------- 16. SnippetsPanel (Rail "snippets")
SNIPS = [('Clientes activos', 'act', 'SELECT * FROM clientes WHERE activo'),
         ('Ventas por estado', 'vxe', 'SELECT estado, COUNT(*) AS n, SUM(total)…'),
         ('Productos sin existencias', '', 'SELECT sku, nombre FROM productos WHERE…')]


def snip_rows(sel, href):
    return ''.join(item_row(n + (f' <span class="kbd" style="font-weight: 400">{a}</span>' if a else ''), f'<span class="mono" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{b}</span>', i == sel, href, mono=False)
                   for i, (n, a, b) in enumerate(SNIPS))


snip_body = (f'<div role="listbox" aria-label="Snippets guardados" style="flex: 1; min-height: 0; padding: 0 6px; display: flex; flex-direction: column; gap: 2px; overflow: hidden">{snip_rows(0, "SnippetsPanel.dc.html")}'
             f'''<div style="margin: 6px 4px 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--content)">
          <div class="lbl">Vista previa · Clientes activos</div>
          <pre class="mono" style="margin: 6px 0 10px; font-size: var(--fs-xs); white-space: pre-wrap; color: var(--text)"><span style="color: var(--syntax-keyword)">SELECT</span> * <span style="color: var(--syntax-keyword)">FROM</span> clientes
<span style="color: var(--syntax-keyword)">WHERE</span> activo</pre>
          <div style="display: flex; gap: 6px"><a href="EditorResult.dc.html" class="btn" style="height: 26px; font-size: var(--fs-sm)">Insertar</a><a href="EditorResult.dc.html" class="btn btn-ghost" style="height: 26px; font-size: var(--fs-sm)">{svg("plus", 13)}En pestaña nueva</a></div>
        </div></div>''')
snip_side = side_panel('Snippets', 'Snippets',
                       f'<a href="SnippetSaveInline.dc.html" class="btn btn-icon" aria-label="Guardar la consulta como snippet (Ctrl+Mayús+S)" title="Guardar la consulta como snippet (Ctrl+Mayús+S)">{svg("plus", 16)}</a>'
                       f'<a href="SnippetsTool.dc.html" class="btn btn-icon" aria-label="Abrir la biblioteca de snippets" title="Abrir la biblioteca de snippets">{svg("open", 16)}</a>',
                       'Buscar snippets', snip_body, f'Arrastra uno al editor o escribe su abreviatura y pulsa {KBD("Tab")}.')
write('SnippetsPanel', 'Panel de snippets', shell(result_doc(), rail='snippets', side=snip_side, status=ST_RESULT), DATA_RESULT)

# ---------------------------------------------------------------- 17. SnippetsTool (library document)
SQL_SNIP = 'SELECT estado,\n       COUNT(*)   AS n,\n       SUM(total) AS total\n  FROM pedidos\n GROUP BY estado\n ORDER BY total DESC;'
snip_doc = f'''      <div role="toolbar" aria-label="Biblioteca de snippets" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <span class="field" style="width: 300px; display: inline-flex; align-items: center; gap: 6px">{svg("search", 14, "color: var(--text-dim)")}<input aria-label="Buscar snippets" placeholder="Buscar por nombre o por lo que hace" style="flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text)"></span>
        {FLEX}
        <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim); margin-right: 6px">3 snippets</span>
        <button type="button" class="btn btn-ghost">{svg("import")}Importar…</button>
        <button type="button" class="btn btn-ghost">{svg("export")}Exportar…</button>
      </div>
      <div style="flex: 1; min-height: 0; display: flex">
        <div role="listbox" aria-label="Snippets guardados" style="width: 300px; flex: none; border-right: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 2px">{snip_rows(1, "SnippetsTool.dc.html")}</div>
        <section aria-label="Snippet seleccionado" style="flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 18px 20px; gap: 16px; overflow: hidden">
          <div style="display: flex; align-items: center; gap: 8px">
            <div style="flex: 1"><div style="font-size: var(--fs-lg); font-weight: 600">Ventas por estado</div><div class="help" style="margin-top: 2px">Guardado el 12/10/2026 · 6 líneas · se guarda al escribir</div></div>
            <a href="EditorMultipleResults.dc.html" class="btn btn-primary" title="Abrir en una pestaña de consulta nueva">{svg("plus", 14)}Abrir en pestaña nueva</a>
            <a href="EditorResult.dc.html" class="btn">Insertar en Consulta 1</a>
            <a href="#" class="btn btn-icon" aria-label="Más: renombrar, duplicar, eliminar" title="Más: renombrar, duplicar, eliminar">{svg("more", 16)}</a>
          </div>
          <div style="display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; align-items: center">
            <label for="snip-abbr" style="color: var(--text-dim)">Abreviatura</label>
            <input id="snip-abbr" class="field" value="vxe" placeholder="p. ej. sel" style="width: 160px; font-family: var(--font-mono)">
            <span></span><span class="help">Escríbela en el editor y pulsa {KBD("Tab")} para expandirla. Una palabra; vacía la quita.</span>
          </div>
          <div style="flex: 1; min-height: 0; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">
            <dc-import name="SqlEditor" theme="{T}" sql="{{{{sql}}}}" current="0" height="100%" hint-size="100%,100%"></dc-import>
          </div>
        </section>
      </div>'''
write('SnippetsTool', 'Snippets', shell(snip_doc, rail='explorer', status='conn="Ventas" db="main" color="#2f7dd6" info="3 snippets"', wtitle='Snippets — Squaero'),
      {'tabs': [{'label': 'Consulta 1', 'kind': 'query', 'href': 'EditorResult.dc.html', 'dirty': True, 'color': '#2f7dd6'}, {'label': 'Snippets', 'kind': 'tool', 'active': True, 'href': 'SnippetsTool.dc.html'}],
       'sql': SQL_SNIP})

# ---------------------------------------------------------------- 18. LocalHistory
old = ['SELECT c.nombre, c.ciudad, p.total', 'FROM clientes c', 'JOIN pedidos p ON p.cliente_id = c.id', 'WHERE p.total > 1000;']
new = ['SELECT c.nombre, c.ciudad, p.fecha, p.estado, p.total', 'FROM clientes c', 'JOIN pedidos p ON p.cliente_id = c.id', 'ORDER BY p.fecha;']
old_hl = ['SELECT c.nombre, c.ciudad, p.total', None, None, '<mark>WHERE p.total &gt; 1000</mark>;']
new_hl = ['SELECT c.nombre, c.ciudad, <mark>p.fecha, p.estado, </mark>p.total', None, None, '<mark>ORDER BY p.fecha</mark>;']


def dline(n, text, kind):
    bg = {'del': 'var(--danger-soft)', 'add': 'var(--ok-soft)', 'same': 'transparent'}[kind]
    sign = {'del': '−', 'add': '+', 'same': ''}[kind]
    tone = {'del': 'var(--danger)', 'add': 'var(--ok)', 'same': 'var(--text-dim)'}[kind]
    text = text.replace('<mark>', f'<mark style="background: color-mix(in srgb, {tone} 22%, transparent); color: inherit; border-radius: 2px">')
    return (f'<div style="display: flex; height: 24px; align-items: center; background: {bg}"><span class="num" style="width: 34px; flex: none; text-align: right; padding-right: 6px; color: var(--text-dim)">{n}</span>'
            f'<span aria-label="{ {"del": "eliminada", "add": "añadida", "same": ""}[kind] }" style="width: 14px; flex: none; color: {tone}">{sign}</span><span style="white-space: pre">{text}</span></div>')


L = ''.join(dline(i + 1, old_hl[i] or old[i], 'same' if old_hl[i] is None else 'del') for i in range(4))
R = ''.join(dline(i + 1, new_hl[i] or new[i], 'same' if new_hl[i] is None else 'add') for i in range(4))
vers = (group('Hoy')
        + item_row('14:21:30', f'Al ejecutar · {len(chr(10).join(new))} caracteres · igual al texto actual', href='LocalHistory.dc.html', mono=False)
        + item_row('14:12:04', f'Automática · {len(chr(10).join(old))} caracteres', True, 'LocalHistory.dc.html', mono=False)
        + item_row('13:58:47', 'Al ejecutar · 22 caracteres', href='LocalHistory.dc.html', mono=False)
        + group('Ayer')
        + item_row('18:40:12', 'Al cerrar · 210 caracteres', href='LocalHistory.dc.html', mono=False)
        + item_row('17:02:09', 'Restaurada · 45 caracteres', href='LocalHistory.dc.html', mono=False))
pane_head = lambda t, sub: f'<div style="height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); font-family: var(--font-ui)"><span style="font-weight: 600">{t}</span><span style="color: var(--text-dim)">{sub}</span></div>'
lh_doc = f'''      <div role="toolbar" aria-label="Acciones del historial local" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <a href="EditorResult.dc.html" class="btn btn-primary" title="El texto actual se guarda como versión antes de restaurar">{svg("history", 14)}Restaurar esta versión</a>
        <a href="EditorResult.dc.html" class="btn btn-ghost">{svg("plus")}Abrir en pestaña nueva</a>
        {SEP}
        <label for="lh-tab" style="font-size: var(--fs-sm); color: var(--text-dim)">Pestaña</label>
        <button id="lh-tab" type="button" class="field" aria-haspopup="listbox" style="display: inline-flex; align-items: center; gap: 8px">Consulta 1{svg("chev", 12)}</button>
        {FLEX}
        <span style="font-size: var(--fs-sm); color: var(--text-dim)"><span style="color: var(--danger)">−2</span> · <span style="color: var(--ok)">+2</span> líneas respecto al texto actual</span>
      </div>
      <div class="help" style="flex: none; padding: 8px 14px; border-bottom: 1px solid var(--border)">Restaurar no pierde nada: el texto actual se guarda antes como una versión más.</div>
      <div style="flex: 1; min-height: 0; display: flex">
        <div role="listbox" aria-label="Versiones guardadas" style="width: 240px; flex: none; border-right: 1px solid var(--border); padding: 0 8px; overflow: hidden">{vers}</div>
        <div role="region" aria-label="Diferencias" style="flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; align-content: start; font-family: var(--font-mono); font-size: var(--fs-sm)">
          <div style="border-right: 1px solid var(--border); min-width: 0; overflow: hidden">{pane_head("Versión de las 14:12:04", "automática")}{L}</div>
          <div style="min-width: 0; overflow: hidden">{pane_head("Texto actual", "Consulta 1")}{R}</div>
        </div>
      </div>'''
write('LocalHistory', 'Historial local', shell(lh_doc, status='conn="Ventas" db="main" color="#2f7dd6" info="Consulta 1 · 5 versiones"', wtitle='Historial local — Ventas — Squaero'),
      {'tabs': [{'label': 'Consulta 1', 'kind': 'query', 'href': 'EditorResult.dc.html', 'dirty': True, 'color': '#2f7dd6'}, {'label': 'Historial local', 'kind': 'tool', 'active': True, 'href': 'LocalHistory.dc.html'}]})
print('ok')
