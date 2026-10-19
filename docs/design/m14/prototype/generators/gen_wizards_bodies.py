# Writes the [wizards] group bodies into bodies/. Run, then build.py.
# v2: applies the UI/UX audit (AUDIT-RULES.md): os tweak + data-os, OS-ordered
# .dlg-actions footers, object switcher identical to DataGrid, destructive
# actions named and confirmed, running states with Cancelar, Spanish keys.
import io, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
BODIES = os.path.join(HERE, 'bodies')
J = lambda v: json.dumps(v, ensure_ascii=False)

IC = {
    'table': '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 10v10"></path>',
    'view': '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
    'plus': '<path d="M12 5v14M5 12h14"></path>',
    'close': '<path d="M18 6 6 18M6 6l12 12"></path>',
    'chev-r': '<path d="m9 6 6 6-6 6"></path>',
    'chev-d': '<path d="m6 9 6 6 6-6"></path>',
    'more': '<circle cx="5" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="19" cy="12" r="1.2"></circle>',
    'refresh': '<path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path>',
    'edit': '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    'search': '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    'check': '<path d="M20 6 9 17l-5-5"></path>',
    'warning': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    'info': '<circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
    'trash': '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>',
    'copy': '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
    'query': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="m9 13-2 2 2 2"></path><path d="m13 13 2 2-2 2"></path>',
    'open': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"></path><path d="M3 7v10a2 2 0 0 0 2 2h13l3-8H6l-3 8"></path>',
    'key': '<circle cx="7.5" cy="15.5" r="4.5"></circle><path d="m10.7 12.3 9.3-9.3"></path><path d="m16 7 3 3"></path>',
    'transfer': '<path d="M4 8h14l-4-4"></path><path d="M20 16H6l4 4"></path>',
    'database': '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path>',
    'stop': '<rect x="6" y="6" width="12" height="12" rx="1"></rect>',
    'trigger': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"></path>',
    'lock': '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
    # not in icons.md: drawn here for running states (reported as a gap)
    'spin': '<circle cx="12" cy="12" r="9" stroke-opacity=".25"></circle><path d="M21 12a9 9 0 0 0-9-9"></path>',
    'arrow-r': '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>',
}
CONN = {'Ventas': '#2f7dd6', 'Ventas copia': '#2e9e52', 'Producción': '#c4302b'}


def ic(name, size=15, style=''):
    st = ' style="%s"' % style if style else ''
    return ('<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"%s>%s</svg>') % (size, size, st, IC[name])


def dot(conn):
    return '<span aria-hidden="true" style="width: 8px; height: 8px; flex: none; border-radius: 50%%; background: %s"></span>' % CONN[conn]


SEP = '<span style="width: 1px; height: 20px; background: var(--border); margin: 0 4px"></span>'
FLEX = '<span style="flex: 1"></span>'


def shell(main, wtitle, rail='explorer', explorer='state="connected" tree="tables" selected="clientes"',
          status='conn="Ventas" db="main" info=""', overlay=''):
    return '''<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" window-title="%s" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="%s" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" %s height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%%,36px"></dc-import>
%s
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" %s hint-size="1280px,24px"></dc-import>
%s</div>''' % (wtitle, rail, explorer, main, status, overlay)


def stepper(title, sub, steps, cur, all_done=False):
    """steps: labels; cur: 1-based current step."""
    parts = []
    for i, label in enumerate(steps, 1):
        if i < cur or all_done:
            dot_ = 'background: var(--accent-soft); color: var(--accent-text)'
            inner = ic('check', 13) + '<span style="position: absolute; left: -9999px">Hecho:</span>'
            lab = 'color: var(--text-dim)'
        elif i == cur:
            dot_ = 'background: var(--accent); color: var(--accent-fg)'
            inner = str(i)
            lab = 'color: var(--text); font-weight: 600'
        else:
            dot_ = 'border: 1px solid var(--border-strong); color: var(--text-dim)'
            inner = str(i)
            lab = 'color: var(--text-dim)'
        aria = ' aria-current="step"' if i == cur else ''
        if i > 1:
            parts.append(ic('chev-r', 14, 'color: var(--text-dim)'))
        parts.append('<li%s style="display: flex; align-items: center; gap: 8px"><span style="position: relative; width: 22px; height: 22px; box-sizing: border-box; border-radius: 50%%; display: flex; align-items: center; justify-content: center; font-size: var(--fs-sm); font-weight: 600; %s">%s</span><span style="%s">%s</span></li>'
                     % (aria, dot_, inner, lab, label))
    return '''      <header style="height: 56px; flex: none; display: flex; align-items: center; gap: 16px; padding: 0 24px; border-bottom: 1px solid var(--border)">
        <div style="min-width: 0">
          <h1 style="margin: 0; font-size: var(--fs-lg); font-weight: 600">%s</h1>
          <div style="font-size: var(--fs-sm); color: var(--text-dim)">%s</div>
        </div>
        %s
        <ol aria-label="Pasos del asistente" style="list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 10px; font-size: var(--fs-md)">%s</ol>
      </header>''' % (title, sub, FLEX, ''.join(parts))


def btn_disabled(label, cls='btn', icon=''):
    return '<button type="button" class="%s" disabled="disabled" style="opacity: .45">%s%s</button>' % (cls, icon, label)


def footer(primary, primary_href, back_href=None, cancel='Cancelar', cancel_href='DataGrid.dc.html', helpers='',
           primary_cls='btn btn-primary', back=True):
    """Wizard footer: [Atrás] helpers … [Primary][Cancelar] (order flips on macOS/Linux via .dlg-actions)."""
    if not back:
        b = ''
    elif back_href:
        b = '<a href="%s" class="btn">Atrás</a>' % back_href
    else:
        b = btn_disabled('Atrás')
    prim = ('<a href="%s" class="%s">%s</a>' % (primary_href, primary_cls, primary)) if primary else ''
    return '''      <footer style="height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 24px; border-top: 1px solid var(--border); background: var(--surface)">
        %s
        %s
        %s
        <span class="dlg-actions">%s<a href="%s" class="btn">%s</a></span>
      </footer>''' % (b, helpers, FLEX, prim, cancel_href, cancel)


def body(inner, pad='24px 32px', gap='24px', extra=''):
    return '''      <div style="flex: 1; min-height: 0; overflow: auto; padding: %s; display: flex; flex-direction: column; gap: %s%s">
%s
      </div>''' % (pad, gap, extra, inner)


def help_(text):
    return '<div class="help" style="margin-top: 4px">%s</div>' % text


def row(label, field, hlp='', for_=''):
    lab = ('<label for="%s" style="padding-top: 5px; color: var(--text-dim)">%s</label>' % (for_, label)) if for_ else \
        '<span style="padding-top: 5px; color: var(--text-dim)">%s</span>' % label
    return '''          <div style="display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 0 16px; align-items: start">
            %s
            <div style="max-width: 360px">%s%s</div>
          </div>''' % (lab, field, help_(hlp) if hlp else '')


def wide_row(label, field, hlp=''):
    return '''          <div style="display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 0 16px; align-items: start">
            <span style="padding-top: 5px; color: var(--text-dim)">%s</span>
            <div>%s%s</div>
          </div>''' % (label, field, help_(hlp) if hlp else '')


def group(title, rows, right=''):
    return '''        <section style="display: flex; flex-direction: column; gap: 12px">
          <div style="display: flex; align-items: baseline; gap: 8px"><h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">%s</h2>%s</div>
%s
        </section>''' % (title, right, '\n'.join(rows))


def select(id_, options, sel=0, width='100%', cls='field', disabled=False):
    opts = ''.join('<option%s>%s</option>' % (' selected="selected"' if i == sel else '', o) for i, o in enumerate(options))
    return '<select id="%s" class="%s" style="width: %s"%s>%s</select>' % (id_, cls, width, ' disabled="disabled"' if disabled else '', opts)


def inp(id_, value='', width='100%', cls='field', mono=False, extra='', readonly=False):
    return '<input id="%s" class="%s" value="%s"%s style="width: %s; %s%s">' % (
        id_, cls, value, ' readonly="readonly"' if readonly else '', width,
        'font-family: var(--font-mono); font-size: var(--fs-sm);' if mono else '', extra)


def check(label, checked=True):
    return '<label style="display: flex; align-items: center; gap: 8px; min-height: 28px"><input type="checkbox"%s style="accent-color: var(--accent); width: 16px; height: 16px; margin: 0">%s</label>' % (
        ' checked="checked"' if checked else '', label)


def radios(name, items, on=0, label=''):
    return '<div role="radiogroup" aria-label="%s" style="display: flex; flex-direction: column; gap: 2px">' % label + ''.join(
        '<label style="display: flex; align-items: center; gap: 8px; min-height: 28px"><input type="radio" name="%s"%s style="accent-color: var(--accent); width: 16px; height: 16px; margin: 0">%s</label>' % (
            name, ' checked="checked"' if i == on else '', t) for i, t in enumerate(items)) + '</div>'


def static(text):
    return '<div style="min-height: 28px; display: flex; align-items: center; gap: 8px">%s</div>' % text


def note(text, tone='info', icon='info'):
    bg = {'info': 'var(--surface)', 'warn': 'var(--warn-soft)', 'danger': 'var(--danger-soft)', 'ok': 'var(--ok-soft)'}[tone]
    fg = {'info': 'var(--text-dim)', 'warn': 'var(--warn)', 'danger': 'var(--danger)', 'ok': 'var(--ok)'}[tone]
    txt = 'var(--text-dim)' if tone == 'info' else 'var(--text)'
    return ('<div style="display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--r-md); background: %s; font-size: var(--fs-sm); color: %s; line-height: 1.45">'
            '<span style="display: flex; flex: none; margin-top: 1px; color: %s">%s</span><span>%s</span></div>') % (bg, txt, fg, ic(icon, 15), text)


def sqlbox(var, height, title='', right=''):
    head = ''
    if title:
        head = '<div style="height: 32px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); color: var(--text-dim)">%s%s%s</div>' % (title, FLEX, right)
    return '<div style="height: %s; flex: none; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">%s<div style="flex: 1; min-height: 0"><dc-import name="SqlEditor" theme="{{theme}}" sql="{{%s}}" current="{{noLine}}" height="100%%" hint-size="100%%,100%%"></dc-import></div></div>' % (height, head, var)


def gridbox(cols, rows, label, height, extra=''):
    return '<div style="height: %s; flex: none; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden"><dc-import name="Grid" theme="{{theme}}" columns="{{%s}}" rows="{{%s}}" label="%s" %sheight="100%%" hint-size="100%%,100%%"></dc-import></div>' % (height, cols, rows, label, extra)


def table(label, heads, rows, tmpl, row_h=30):
    """Small static table (role=table). heads: header cells; rows: list of cell lists (html)."""
    st = 'display: grid; grid-template-columns: %s; align-items: center; gap: 0 12px; padding: 0 12px' % tmpl
    out = ['<div role="table" aria-label="%s" style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">' % label,
           '<div role="row" style="%s; height: 30px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); font-weight: 600">%s</div>' % (
               st, ''.join('<span role="columnheader">%s</span>' % h for h in heads))]
    for i, r in enumerate(rows):
        out.append('<div role="row" style="%s; min-height: %dpx; %s%s">%s</div>' % (
            st, row_h, 'border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); ' if i else '',
            'background: var(--zebra);' if i % 2 else '', ''.join('<span role="cell" style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">%s</span>' % c for c in r)))
    out.append('</div>')
    return ''.join(out)


def mono(t, extra=''):
    return '<span class="mono" style="font-size: var(--fs-sm)%s">%s</span>' % ('; ' + extra if extra else '', t)


OS_PROP = '"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"}'


def props(extra=''):
    return '{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},%s,%s"$preview":{"width":1280,"height":800}}' % (OS_PROP, extra + ',' if extra else '')


def js(vals):
    lines = ["      theme: this.props.theme ?? 'b',", "      os: this.props.os ?? 'windows',", '      noLine: 0,']
    for k, v in vals.items():
        lines.append('      %s: %s,' % (k, v[3:] if isinstance(v, str) and v.startswith('JS:') else J(v)))
    return 'class Component extends DCLogic {\n  renderVals() {\n    return {\n' + '\n'.join(lines) + '\n    };\n  }\n}\n'


def write(name, title, markup, vals, extra_props=''):
    src = '%s\n%s\n---PROPS---\n%s\n---JS---\n%s' % (title, markup, props(extra_props), js(vals))
    io.open(os.path.join(BODIES, name + '.body'), 'w', encoding='utf-8', newline='\n').write(src)


def tabs(label, kind='tool', href='#', running=False):
    t = {'label': label, 'kind': kind, 'active': True, 'href': href, 'color': CONN['Ventas']}
    if running:
        t['running'] = True
    return [{'label': 'Consulta 1', 'kind': 'query', 'href': 'EditorResult.dc.html', 'dirty': True},
            {'label': 'clientes', 'kind': 'table', 'href': 'DataGrid.dc.html'}, t]


def conn_card(conn, line2, tone='plain'):
    bg = 'var(--surface)' if tone == 'plain' else 'var(--accent-soft)'
    return ('<span style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: var(--r-md); background: %s; border: 1px solid var(--border)">'
            '%s<b style="font-weight: 600">%s</b><span style="color: var(--text-dim)">%s</span></span>') % (bg, dot(conn), conn, line2)


def route(src_line, dst_conn, dst_line, change_href=None):
    ch = ('<a href="%s" style="font-size: var(--fs-sm)">Cambiar destino</a>' % change_href) if change_href else ''
    return '''        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--fs-md)">
          <span class="lbl" style="font-size: var(--fs-sm)">Origen</span>%s
          <span style="display: flex; color: var(--text-dim)" aria-label="hacia">%s</span>
          <span class="lbl" style="font-size: var(--fs-sm)">Destino</span>%s
          %s
        </div>''' % (conn_card('Ventas', src_line), ic('arrow-r', 18), conn_card(dst_conn, dst_line, 'dst'), ch)


# ---------- shared fixtures ----------
CLI_COLS = [('id', 'INTEGER'), ('nombre', 'TEXT'), ('email', 'TEXT'), ('ciudad', 'TEXT'), ('saldo', 'NUMERIC(10,2)'), ('activo', 'BOOLEAN'), ('alta', 'DATE')]
PASTE_COLS = [{'name': 'nombre', 'type': 'texto', 'kind': 'text', 'w': '130px'}, {'name': 'email', 'type': 'texto', 'kind': 'text', 'w': '180px'},
              {'name': 'ciudad', 'type': 'texto', 'kind': 'text', 'w': '120px'}, {'name': 'saldo', 'type': 'número', 'kind': 'num', 'w': '90px'},
              {'name': 'activo', 'type': 'número', 'kind': 'num', 'w': '70px'}, {'name': 'alta', 'type': 'fecha', 'kind': 'date', 'w': '1fr'}]
PASTE_ROWS = [['Laura Méndez', 'lmendez@correo.mx', 'Hermosillo', '450.00', 1, '2025-07-01'],
              ['Pedro Ochoa', 'pochoa@correo.mx', 'Nogales', '1200.50', 0, '2025-07-03']]
PASTE_TEXT = 'nombre,email,ciudad,saldo,activo,alta\nLaura Méndez,lmendez@correo.mx,Hermosillo,450.00,1,2025-07-01\nPedro Ochoa,pochoa@correo.mx,Nogales,1200.50,0,2025-07-03'

IMPORT_STEPS = ['Origen', 'Columnas', 'Importar']
IMP_TITLE = 'Importar · clientes — Ventas — Squaero'


# ---------- import: source ----------
def seg_links(items, on):
    return '<span class="seg" role="radiogroup" aria-label="Origen de los datos">' + ''.join(
        '<a href="%s" role="radio" aria-checked="%s"%s>%s</a>' % (h, 'true' if i == on else 'false', ' class="on"' if i == on else '', t)
        for i, (t, h) in enumerate(items)) + '</span>'


def import_source(clip):
    src_seg = seg_links([('Archivo', 'ImportWizard.dc.html'), ('Portapapeles', 'ImportWizardClipboard.dc.html')], 1 if clip else 0)
    rows = [row('Tabla destino', static('%s<span style="display: flex; color: var(--obj-table)">%s</span><span style="font-weight: 600">clientes</span><span style="color: var(--text-dim)">· Ventas · main · 7 columnas</span>' % (dot('Ventas'), ic('table', 15)))),
            row('Origen de los datos', src_seg)]
    if clip:
        rows.append(wide_row('<label for="paste">Filas pegadas</label>',
                             '<textarea id="paste" class="field is-focus" spellcheck="false" style="width: 100%; max-width: 640px; height: 96px; box-sizing: border-box; padding: 8px 10px; resize: none; font-family: var(--font-mono); font-size: var(--fs-sm); line-height: 20px">' + PASTE_TEXT + '</textarea>',
                             'TSV copiado de una hoja de cálculo, o CSV. La primera fila son los encabezados. Formato detectado: CSV, separador coma.'))
        rows.append(row('Valores vacíos', check('Las celdas vacías son NULL')))
    else:
        # A-26: own file button that shows the chosen file name (no native "Choose File")
        rows.append(row('<span>Archivo</span>', '<div style="display: flex; gap: 8px; align-items: center"><span class="mono" style="flex: 1; min-width: 0; height: var(--h-control); box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-radius: var(--r-sm); background: var(--surface); border: 1px solid var(--border); font-size: var(--fs-sm); overflow: hidden; white-space: nowrap">clientes_julio.csv<span style="color: var(--text-dim)">· 312 KB</span></span><a href="#" class="btn">' + ic('open', 15) + 'Elegir archivo…</a></div>',
                        'CSV, JSON o XLSX. Ruta: C:\\Users\\ana\\Documents'))
        rows.append(row('Formato', static('<span>CSV · coma · UTF-8 · con encabezados</span><a href="#" style="font-size: var(--fs-sm)">Cambiar…</a>'), 'Detectado al leer el archivo.'))
    origin = 'lo pegado' if clip else 'clientes_julio.csv'
    count = '2 filas · 6 columnas' if clip else 'primeras 2 de 4812 filas · 6 columnas'
    prev = '''        <section style="display: flex; flex-direction: column; gap: 8px; max-width: 840px">
          <div style="display: flex; align-items: baseline; gap: 8px"><h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">Vista previa</h2><span class="help">de %s · %s</span></div>
          %s
        </section>''' % (origin, count, gridbox('pcols', 'prows', 'Vista previa de ' + origin, '124px'))
    main = '\n'.join([stepper('Importar a clientes', 'Asistente de importación · Ventas', IMPORT_STEPS, 1),
                      body(group('Origen', rows) + '\n' + prev),
                      footer('Siguiente', 'ImportWizardMapping.dc.html')])
    return shell(main, IMP_TITLE, status='conn="Ventas" db="main" info="Importar · clientes"')


write('ImportWizard', 'Importar · archivo', import_source(False), {'tabs': tabs('Importar · clientes'), 'pcols': PASTE_COLS, 'prows': PASTE_ROWS})
write('ImportWizardClipboard', 'Importar · portapapeles', import_source(True), {'tabs': tabs('Importar · clientes'), 'pcols': PASTE_COLS, 'prows': PASTE_ROWS})


# ---------- mapping (import + transfer) ----------
def mapping_section(title, src_label, maps, note_=''):
    """maps: [(target, type, source or None, sample)]"""
    tmpl = 'grid-template-columns: 210px 28px 260px 1fr'
    head = '''          <div role="row" style="display: grid; %s; align-items: center; height: 30px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); font-weight: 600">
            <span role="columnheader">Columna destino</span><span></span><span role="columnheader">%s</span><span role="columnheader">Ejemplo (fila 1)</span>
          </div>''' % (tmpl, src_label)
    rows = []
    for i, (t, ty, s, sample) in enumerate(maps):
        opts = ['Omitir · la genera la BD' if t == 'id' else 'Omitir'] + [m[2] for m in maps if m[2]]
        sel = 0 if s is None else opts.index(s)
        key = ic('key', 12, 'color: var(--warn)') if t == 'id' else ''
        samp = '<span class="help">Autoincremental: la asigna la BD</span>' if s is None else '<span class="mono" style="font-size: var(--fs-sm)">%s</span>' % sample
        rows.append('''          <div role="row" style="display: grid; %s; align-items: center; height: 36px; padding: 0 12px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%%, transparent)">
            <label for="map%d" style="display: flex; align-items: center; gap: 6px"><span class="mono" style="font-size: var(--fs-sm); font-weight: 500">%s</span>%s<span style="font-size: var(--fs-xs); color: var(--text-dim)">%s</span></label>
            <span aria-hidden="true" style="color: var(--text-dim)">←</span>
            %s
            <span style="color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">%s</span>
          </div>''' % (tmpl, i, t, key, ty.lower(), select('map%d' % i, opts, sel, width='240px'), samp))
    n_ok = sum(1 for m in maps if m[2])
    return '''        <section style="display: flex; flex-direction: column; gap: 8px; max-width: 880px">
          <div style="display: flex; align-items: baseline; gap: 8px"><h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">%s</h2><span class="help">%d de %d columnas asignadas%s</span><span style="flex: 1"></span><a href="#" style="font-size: var(--fs-sm)">Asignar por nombre</a></div>
          <div role="table" aria-label="%s" style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">
%s
%s
          </div>
        </section>''' % (title, n_ok, len(maps), note_, title, head, '\n'.join(rows))


IMPORT_MAP = [('id', 'INTEGER', None, ''), ('nombre', 'TEXT', 'nombre', 'Laura Méndez'), ('email', 'TEXT', 'email', 'lmendez@correo.mx'),
              ('ciudad', 'TEXT', 'ciudad', 'Hermosillo'), ('saldo', 'NUMERIC(10,2)', 'saldo', '450.00'), ('activo', 'BOOLEAN', 'activo', '1 → true'), ('alta', 'DATE', 'alta', '2025-07-01')]
opts_grp = group('Opciones', [row('Si una fila falla', radios('fail', ['Omitirla e importar el resto', 'Abortar todo (no se importa nada)'], label='Si una fila falla')),
                              row('Transacción', static('<span>Todo en una transacción</span>'), 'Si cancelas la importación, no se guarda ninguna fila.')])
main = '\n'.join([stepper('Importar a clientes', 'Desde clientes_julio.csv · 4812 filas', IMPORT_STEPS, 2),
                  body(mapping_section('Mapeo de columnas', 'Columna de origen', IMPORT_MAP, ' · id se omite: es autoincremental') + '\n' + opts_grp, pad='20px 32px', gap='20px'),
                  footer('Importar 4812 filas', 'ImportProgress.dc.html', back_href='ImportWizard.dc.html')])
write('ImportWizardMapping', 'Importar · columnas', shell(main, IMP_TITLE, status='conn="Ventas" db="main" info="Importar · clientes · 4812 filas"'), {'tabs': tabs('Importar · clientes')})


# ---------- import: progress (NEW, R-01) ----------
def progress(pct, label_left, label_right, aria):
    return '''<div style="display: flex; flex-direction: column; gap: 8px">
            <div style="display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-md)"><span class="num" style="font-weight: 600">%s</span><span style="flex: 1"></span><span class="help num">%s</span></div>
            <div role="progressbar" aria-label="%s" aria-valuemin="0" aria-valuemax="100" aria-valuenow="%d" style="height: 8px; border-radius: 999px; background: var(--hover); overflow: hidden"><div style="width: %d%%; height: 100%%; border-radius: 999px; background: var(--accent)"></div></div>
          </div>''' % (label_left, label_right, aria, pct, pct)


imp_err = table('Errores hasta ahora', ['Fila', 'Columna', 'Error', 'Qué se hizo'], [
    [mono('318'), mono('email'), 'Ya existe <span class="mono" style="font-size: var(--fs-sm)">jperez@correo.mx</span> (índice único ux_clientes_email)', '<span style="color: var(--text-dim)">Omitida</span>'],
    [mono('1022'), mono('alta'), '<span class="mono" style="font-size: var(--fs-sm)">31/02/2025</span> no es una fecha válida', '<span style="color: var(--text-dim)">Omitida</span>']],
    '64px 80px 1fr 110px')
imp_body = '''        <section style="display: flex; flex-direction: column; gap: 16px; max-width: 760px">
          <div style="display: flex; align-items: center; gap: 10px"><span style="display: flex; color: var(--accent)">%s</span><span style="font-size: var(--fs-lg); font-weight: 600">Importando clientes_julio.csv en clientes</span></div>
          %s
          <div style="display: flex; gap: 24px; font-size: var(--fs-sm); color: var(--text-dim)"><span class="num"><b style="color: var(--text); font-weight: 600">2138</b> insertadas</span><span class="num"><b style="color: var(--danger); font-weight: 600">2</b> con error, omitidas</span><span class="num"><b style="color: var(--text); font-weight: 600">2672</b> pendientes</span><span class="num">00:06 transcurrido</span></div>
        </section>
        <section style="display: flex; flex-direction: column; gap: 8px; max-width: 760px">
          <div style="display: flex; align-items: baseline; gap: 8px"><h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">Errores hasta ahora (2)</h2><span class="help">Si una fila falla: omitirla e importar el resto</span><span style="flex: 1"></span><a href="#" style="font-size: var(--fs-sm)">Copiar errores</a></div>
          %s
        </section>
        <div style="max-width: 760px">%s</div>''' % (
    ic('spin', 18), progress(44, '2140 de 4812 filas · 44 %', 'quedan unos 8 s', 'Filas importadas'), imp_err,
    note('Todo va en una transacción: si cancelas, no se guarda ninguna fila y clientes queda como estaba. Puedes seguir trabajando en otras pestañas; te avisaremos al terminar.'))
main = '\n'.join([stepper('Importar a clientes', 'Desde clientes_julio.csv · 4812 filas', IMPORT_STEPS, 3),
                  body(imp_body, gap='24px'),
                  footer('', '', back=True, cancel=ic('stop', 14) + 'Cancelar importación', cancel_href='ImportWizardMapping.dc.html')])
write('ImportProgress', 'Importar · en curso', shell(main, IMP_TITLE, status='conn="Ventas" db="main" info="Importando · 2140 de 4812 filas · 44 %"'),
      {'tabs': tabs('Importar · clientes', running=True)})


# ---------- data generator (A-29) ----------
GEN = [('id', 'INTEGER · PK', 0, '<span class="help">Autoincremental: la BD asigna 13, 14, 15…</span>'),
       ('nombre', 'TEXT', 3, [('plantilla', 'nombre completo', 'text')]),
       ('email', 'TEXT', 3, [('plantilla', 'correo electrónico', 'text')]),
       ('ciudad', 'TEXT', 5, [('valores', 'Hermosillo, Nogales, Guaymas', 'text')]),
       ('saldo', 'NUMERIC(10,2)', 2, [('mín', '0', 'number'), ('máx', '1000', 'number'), ('decimales', '2', 'number')]),
       ('activo', 'BOOLEAN', 6, []),
       ('alta', 'DATE', 4, [('desde', '2025-10-18', 'date'), ('hasta', '2026-10-18', 'date')])]
STRATS = ['Omitir · la genera la BD', 'Secuencia desde MAX+1', 'Número aleatorio', 'Texto', 'Fecha', 'Lista de valores', 'Booleano', 'Valor fijo', 'NULL', 'Omitir columna']
GTMPL = 'grid-template-columns: 140px 120px 210px 1fr'
gen_rows = []
for i, (c, t, s, params) in enumerate(GEN):
    if isinstance(params, str):
        ps = params
    elif params:
        ps = ''.join('<label style="display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: var(--fs-sm)">%s<input class="field" type="%s" value="%s" style="width: %s; height: 26px; font-size: var(--fs-sm)%s"></label>' % (
            k, ty, v, '190px' if ty == 'text' else ('130px' if ty == 'date' else '68px'), '; font-family: var(--font-mono)' if ty != 'text' else '') for k, v, ty in params)
    else:
        ps = '<span class="help">true o false al azar</span>'
    key = ic('key', 12, 'color: var(--warn)') if c == 'id' else ''
    gen_rows.append('''          <div role="row" style="display: grid; %s; align-items: center; height: 34px; padding: 0 12px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%%, transparent)">
            <label for="st%d" style="display: flex; align-items: center; gap: 6px"><span class="mono" style="font-size: var(--fs-sm); font-weight: 500">%s</span>%s</label>
            <span style="font-size: var(--fs-xs); color: var(--text-dim)">%s</span>
            %s
            <span style="display: flex; align-items: center; gap: 12px">%s</span>
          </div>''' % (GTMPL, i, c, key, t.lower(), select('st%d' % i, STRATS, s, width='196px'), ps))
gen_table = '''        <section style="display: flex; flex-direction: column; gap: 8px">
          <h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">Estrategia por columna</h2>
          <div role="table" aria-label="Estrategia por columna" style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">
          <div role="row" style="display: grid; %s; align-items: center; height: 30px; padding: 0 12px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); font-weight: 600"><span>Columna</span><span>Tipo</span><span>Estrategia</span><span>Parámetros</span></div>
%s
          </div>
        </section>''' % (GTMPL, '\n'.join(gen_rows))
gen_prev = '''        <section style="display: flex; flex-direction: column; gap: 8px">
          <div style="display: flex; align-items: center; gap: 8px"><h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">Vista previa</h2><span class="help">4 de 10 filas · id previsto, lo asigna la BD</span><span style="flex: 1"></span><a href="#" class="btn btn-ghost" style="height: 26px">%sOtra muestra</a></div>
          %s
        </section>''' % (ic('refresh', 14), gridbox('gcols', 'grows', 'Vista previa de los datos generados', '160px'))
main = '\n'.join([stepper('Generar datos · clientes', 'Inserta filas de prueba en la tabla · Ventas', ['Configurar', 'Resultado'], 1),
                  body(row('Número de filas', inp('nrows', '10', width='120px', extra='font-variant-numeric: tabular-nums'), 'Hasta 10000 filas por tanda, en una transacción.', 'nrows') + '\n' + gen_table + '\n' + gen_prev, pad='18px 32px', gap='16px'),
                  footer('Generar 10 filas', 'DataGrid.dc.html', back=False)])
write('DataGenerator', 'Generar datos', shell(main, 'Generar datos · clientes — Ventas — Squaero', status='conn="Ventas" db="main" info="Generar · clientes"'), {
    'tabs': tabs('Generar · clientes'),
    'gcols': [{'name': c, 'type': t.lower(), 'kind': k, 'w': w, 'key': c == 'id'} for (c, t), k, w in zip(CLI_COLS, ['num', 'text', 'text', 'text', 'num', 'bool', 'date'], ['64px', '140px', '190px', '130px', '110px', '76px', '1fr'])],
    'grows': [[13, 'Beta Ipsum', 'beta.ipsum@correo.mx', 'Nogales', '24.99', 'true', '2026-03-25'], [14, 'Nova Rivas', 'nova.rivas@correo.mx', 'Hermosillo', '248.07', 'true', '2026-08-24'],
              [15, 'Amet Orión', 'amet.orion@correo.mx', 'Guaymas', '889.59', 'false', '2026-01-18'], [16, 'Umbra Soto', 'umbra.soto@correo.mx', 'Hermosillo', '151.37', 'false', '2025-11-04']]})


# ---------- transfer (A-10) ----------
TR_STEPS = ['Destino', 'Columnas', 'Transferir']
TR_TITLE = 'Transferir · clientes — Ventas — Squaero'
tr_rows = [row('Origen', static('%s<span style="display: flex; color: var(--obj-table)">%s</span><span style="font-weight: 600">clientes</span><span style="color: var(--text-dim)">· Ventas · main</span>' % (dot('Ventas'), ic('table', 15)))),
           row('Filas', radios('trows', ['Toda la tabla · 12 filas', 'Solo las que cumplan un filtro…'], label='Filas que se transfieren'), 'Se lee la tabla completa, no solo la página cargada.'),
           row('Conexión destino', select('dst', ['Elige una conexión…', 'Ventas copia', 'Producción (PostgreSQL) · solo lectura'], cls='field is-focus'), 'Cualquier conexión guardada; puede ser de otro motor. Las de solo lectura no admiten escrituras.', 'dst'),
           row('Base de datos', select('dstdb', ['Elige primero una conexión'], disabled=True), '', 'dstdb'),
           row('Tabla destino', select('dsttbl', ['Elige primero una conexión'], disabled=True), 'Se leen sus columnas al pulsar Siguiente.', 'dsttbl')]
main = '\n'.join([stepper('Transferir datos · clientes', 'Copia filas a otra conexión o tabla', TR_STEPS, 1),
                  body(group('Origen y destino', tr_rows)),
                  footer('Siguiente', 'TransferWizardResult.dc.html')])
write('TransferWizard', 'Transferir · destino', shell(main, TR_TITLE, status='conn="Ventas" db="main" info="Transferir · clientes · 12 filas"'), {'tabs': tabs('Transferir · clientes')})

TR_MAP = [('id', 'INTEGER', 'id', '1'), ('nombre', 'TEXT', 'nombre', 'María López'), ('email', 'TEXT', 'email', 'maria.lopez@correo.mx'),
          ('ciudad', 'TEXT', 'ciudad', 'Hermosillo'), ('saldo', 'NUMERIC(10,2)', 'saldo', '1250.00'), ('activo', 'BOOLEAN', 'activo', 'true'), ('alta', 'DATE', 'alta', '2023-02-14')]
main = '\n'.join([stepper('Transferir datos · clientes', 'Destino: Ventas copia › main.clientes_archivo', TR_STEPS, 2),
                  body(route('clientes · main · 12 filas (toda la tabla)', 'Ventas copia', 'clientes_archivo · main · vacía', 'TransferWizard.dc.html') + '\n' +
                       mapping_section('Mapeo de columnas', 'Columna de origen', TR_MAP) + '\n' +
                       group('Opciones', [row('Si una fila falla', radios('tfail', ['Omitirla y transferir el resto', 'Abortar todo (no se escribe nada)'], 1, label='Si una fila falla'),
                                              'Se escribe en una transacción en Ventas copia. No se borra ni se sobrescribe nada.')]), pad='20px 32px', gap='20px'),
                  footer('Transferir 12 filas a Ventas copia', 'DataGrid.dc.html', back_href='TransferWizard.dc.html')])
write('TransferWizardResult', 'Transferir · columnas', shell(main, TR_TITLE, status='conn="Ventas" db="main" info="Transferir · clientes → Ventas copia · 12 filas"'), {'tabs': tabs('Transferir · clientes')})


# ---------- schema sync (R-15, A-30) ----------
SS_STEPS = ['Comparar', 'Revisar', 'Aplicar']
SS_TITLE = 'Sincronizar estructura — Ventas — Squaero'


def end_card(role, conn, engine, fields, help_txt, accent=False):
    return '''          <div style="display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: var(--r-md); background: %s">
            <span class="lbl" style="font-size: var(--fs-sm)">%s</span>
            <div style="display: flex; align-items: center; gap: 8px; font-weight: 600">%s%s<span style="font-weight: 400; color: var(--text-dim)">· %s</span></div>
            <div style="display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center">%s</div>
            <div class="help">%s</div>
          </div>''' % ('var(--accent-soft)' if accent else 'var(--surface)', role, dot(conn), conn, engine, fields, help_txt)


ends = '''        <section aria-label="Origen y destino" style="display: grid; grid-template-columns: 1fr 44px 1fr; align-items: stretch; max-width: 880px">
%s
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: var(--text-dim)">%s<span style="font-size: var(--fs-xs)">iguala</span></div>
%s
        </section>''' % (
    end_card('Origen · el modelo', 'Ventas', 'SQLite · conexión activa',
             '<label for="sdb" style="color: var(--text-dim)">Base de datos</label>%s' % select('sdb', ['main']), 'No se modifica.'),
    ic('arrow-r', 20),
    end_card('Destino · se modifica', 'Ventas copia', 'SQLite',
             '<label for="dconn" style="color: var(--text-dim)">Conexión</label>%s<label for="ddb" style="color: var(--text-dim)">Base de datos</label>%s' % (
                 select('dconn', ['Ventas copia', 'Producción (PostgreSQL) · solo lectura']), select('ddb', ['main'])),
             'Aquí se aplican los cambios. Con un destino de solo lectura solo se genera el script.', accent=True))
main = '\n'.join([stepper('Sincronizar estructura', 'Genera el SQL que iguala el destino al origen', SS_STEPS, 1),
                  body(ends + '\n' + group('Qué comparar', [
                      row('Objetos', '<div style="display: flex; flex-direction: column">' + check('Tablas, columnas y claves primarias') + check('Índices y restricciones') + check('Vistas') + '</div>'),
                      row('Tablas sobrantes', check('Eliminar las tablas que solo están en el destino', False), 'Desmarcado: se conservan. Si lo marcas, esas sentencias aparecen en «Elimina datos» y empiezan desmarcadas.')])),
                  footer('Comparar', 'SchemaSyncResult.dc.html')])
write('SchemaSync', 'Sincronizar estructura', shell(main, SS_TITLE, status='conn="Ventas" db="main" info="Sincronizar estructura · Ventas → Ventas copia"'), {'tabs': tabs('Sincronizar estructura')})

# review
DIFFS = [('ok', '+', 'Índice', 'ix_clientes_ciudad', 'Solo en el origen — se creará'),
         ('warn', '~', 'Vista', 'ventas_por_ciudad', 'Distinta — se recreará'),
         ('danger', '−', 'Columna', 'clientes.telefono', 'Solo en el destino — se eliminará')]
dl = ''.join('''<li style="display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 12px; %s">
              <span aria-hidden="true" class="mono" style="width: 22px; height: 22px; flex: none; border-radius: var(--r-sm); display: flex; align-items: center; justify-content: center; font-weight: 600; background: var(--%s-soft); color: var(--%s)">%s</span>
              <span style="display: flex; flex-direction: column; min-width: 0"><span><span style="color: var(--text-dim)">%s</span> <span class="mono" style="font-size: var(--fs-sm); font-weight: 500">%s</span></span><span style="font-size: var(--fs-sm); color: %s">%s</span></span></li>''' % (
    'border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent)' if i else '', c, c, s, k, n,
    'var(--danger)' if c == 'danger' else 'var(--text-dim)', d) for i, (c, s, k, n, d) in enumerate(DIFFS))
legend = '<div class="help" style="display: flex; gap: 12px; flex-wrap: wrap"><span><b class="mono" style="color: var(--ok)">+</b> se crea</span><span><b class="mono" style="color: var(--warn)">~</b> se cambia</span><span><b class="mono" style="color: var(--danger)">−</b> se elimina</span><span>· en el destino</span></div>'
left = '''          <div style="width: 330px; flex: none; display: flex; flex-direction: column; gap: 14px">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--fs-sm)">%s<b style="font-weight: 600">Ventas</b><span style="display: flex; color: var(--text-dim)">%s</span>%s<b style="font-weight: 600">Ventas copia</b><span style="color: var(--text-dim)">· main</span></div>
            <section style="display: flex; flex-direction: column; gap: 8px">
              <h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">Diferencias (3)</h2>
              <ul style="list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">%s</ul>
              %s
            </section>
            %s
          </div>''' % (dot('Ventas'), ic('arrow-r', 14), dot('Ventas copia'), dl, legend,
                       note('Restricciones CHECK sin comparar: SQLite no las expone en su catálogo.'))


def stmt(n, sql_lines, why, checked, danger=False):
    sql = '<br>'.join(sql_lines)
    return '''<label style="display: grid; grid-template-columns: 20px 22px 1fr; gap: 0 8px; align-items: start; padding: 8px 12px; %s">
                <input type="checkbox"%s aria-label="Incluir la sentencia %d" style="accent-color: %s; width: 16px; height: 16px; margin: 2px 0 0">
                <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim); padding-top: 1px">%d</span>
                <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span class="mono" style="font-size: var(--fs-sm); line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">%s</span><span style="font-size: var(--fs-sm); color: %s">%s</span></span>
              </label>''' % ('border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent)' if n not in (1, 4) else '',
                             ' checked="checked"' if checked else '', n, 'var(--danger)' if danger else 'var(--accent)', n, sql,
                             'var(--danger)' if danger else 'var(--text-dim)', why)


KW = lambda t: '<span style="color: var(--syntax-keyword)">%s</span>' % t
safe_group = ''.join([
    stmt(1, [KW('DROP VIEW') + ' "ventas_por_ciudad";'], 'Vista distinta: se quita para recrearla (no guarda datos)', True),
    stmt(2, [KW('CREATE VIEW') + ' "ventas_por_ciudad" ' + KW('AS'), '&nbsp;&nbsp;' + KW('SELECT') + ' c.ciudad, COUNT(p.id) ' + KW('AS') + ' pedidos, SUM(p.total) …'], 'Definición del origen', True),
    stmt(3, [KW('CREATE INDEX') + ' "ix_clientes_ciudad" ' + KW('ON') + ' "clientes" ("ciudad");'], 'Índice que solo está en el origen', True)])
danger_group = stmt(4, [KW('ALTER TABLE') + ' "clientes" ' + KW('DROP COLUMN') + ' "telefono";'], 'Borra la columna y sus 9 valores en Ventas copia. No se puede deshacer.', False, danger=True)
right = '''          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px">
            <div style="display: flex; align-items: center; gap: 8px"><h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">Script para Ventas copia</h2><span class="help">3 de 4 sentencias marcadas · en una transacción</span><span style="flex: 1"></span><a href="#" class="btn btn-ghost" style="height: 26px">%sCopiar</a></div>
            <section aria-label="Sin pérdida de datos" style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">
              <div style="height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: var(--surface); border-bottom: 1px solid var(--border); font-size: var(--fs-sm); font-weight: 600"><span style="display: flex; color: var(--ok)">%s</span>Sin pérdida de datos (3)</div>
              %s
            </section>
            <section aria-label="Elimina datos" style="border: 1px solid color-mix(in srgb, var(--danger) 45%%, var(--border)); border-radius: var(--r-md); overflow: hidden">
              <div style="height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: var(--danger-soft); border-bottom: 1px solid color-mix(in srgb, var(--danger) 30%%, var(--border)); font-size: var(--fs-sm); font-weight: 600; color: var(--danger)">%sElimina datos (1)<span style="font-weight: 400; color: var(--text-dim)">· desmarcada por defecto</span></div>
              %s
            </section>
            <div class="help">La sentencia 4 no se aplicará mientras esté desmarcada. Ventas copia no está protegida; en una conexión protegida se pide escribir su nombre.</div>
          </div>''' % (ic('copy', 14), ic('check', 14), safe_group, ic('warning', 14), danger_group)
main = '\n'.join([stepper('Sincronizar estructura', 'Ventas → Ventas copia · main', SS_STEPS, 2),
                  body('        <div style="display: flex; gap: 24px; min-height: 0">\n' + left + '\n' + right + '\n        </div>', pad='20px 24px'),
                  footer('Aplicar 3 sentencias en Ventas copia', 'SchemaSyncApply.dc.html', back_href='SchemaSync.dc.html', primary_cls='btn btn-danger',
                         helpers='<a href="EditorResult.dc.html" class="btn btn-ghost">%sAbrir en el editor</a><a href="#" class="btn btn-ghost">%sGuardar .sql</a>' % (ic('query', 15), ic('save', 15)))])
write('SchemaSyncResult', 'Sincronizar estructura · revisar', shell(main, SS_TITLE, status='conn="Ventas" db="main" info="3 diferencias · 3 de 4 sentencias marcadas"'), {'tabs': tabs('Sincronizar estructura')})


# apply (NEW, R-15 step 3, R-01)
def apply_row(n, sql, state, detail):
    icon = {'ok': ('check', 'var(--ok)', 'var(--ok-soft)', 'Aplicada'), 'run': ('spin', 'var(--accent)', 'var(--accent-soft)', 'Ejecutando'),
            'wait': ('info', 'var(--text-dim)', 'transparent', 'En espera'), 'skip': ('close', 'var(--text-dim)', 'var(--surface)', 'Excluida')}[state]
    return '''<li style="display: grid; grid-template-columns: 26px 22px 1fr 150px; gap: 0 10px; align-items: center; min-height: 40px; padding: 4px 12px; %s%s">
              <span role="img" aria-label="%s" style="width: 22px; height: 22px; border-radius: 50%%; display: flex; align-items: center; justify-content: center; background: %s; color: %s">%s</span>
              <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">%d</span>
              <span class="mono" style="font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; %s">%s</span>
              <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim); text-align: right">%s</span>
            </li>''' % ('border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);' if n > 1 else '', ' color: var(--text-dim);' if state == 'skip' else '',
                       icon[3], icon[2], icon[1], ic(icon[0], 14), n, 'text-decoration: line-through;' if state == 'skip' else '', sql, detail)


S1, S2, S3, S4 = ('DROP VIEW "ventas_por_ciudad";', 'CREATE VIEW "ventas_por_ciudad" AS SELECT c.ciudad, …', 'CREATE INDEX "ix_clientes_ciudad" ON "clientes" ("ciudad");',
                  'ALTER TABLE "clientes" DROP COLUMN "telefono";')
run_list = apply_row(1, S1, 'ok', 'Aplicada · 4 ms') + apply_row(2, S2, 'ok', 'Aplicada · 6 ms') + apply_row(3, S3, 'run', 'Ejecutando · 00:02') + apply_row(4, S4, 'skip', 'Excluida · elimina datos')
done_list = apply_row(1, S1, 'ok', 'Aplicada · 4 ms') + apply_row(2, S2, 'ok', 'Aplicada · 6 ms') + apply_row(3, S3, 'ok', 'Aplicada · 2.1 s') + apply_row(4, S4, 'skip', 'Excluida · elimina datos')
apply_body = '''        <sc-if value="{{running}}" hint-placeholder-val="{{ true }}">
        <section style="display: flex; flex-direction: column; gap: 16px; max-width: 820px">
          <div style="display: flex; align-items: center; gap: 10px"><span style="display: flex; color: var(--accent)">%s</span><span style="font-size: var(--fs-lg); font-weight: 600">Aplicando en Ventas copia · main</span></div>
          %s
        </section>
        </sc-if>
        <sc-if value="{{done}}" hint-placeholder-val="{{ false }}">
        <section style="display: flex; flex-direction: column; gap: 12px; max-width: 820px">
          <div style="display: flex; align-items: center; gap: 10px"><span style="width: 26px; height: 26px; border-radius: 50%%; display: flex; align-items: center; justify-content: center; background: var(--ok-soft); color: var(--ok)">%s</span><span style="font-size: var(--fs-lg); font-weight: 600">3 sentencias aplicadas en Ventas copia</span><span class="help">· 2.1 s · transacción confirmada</span></div>
          <div class="help">La estructura de Ventas copia › main coincide con Ventas, salvo la columna clientes.telefono, que se conservó.</div>
        </section>
        </sc-if>
        <section style="display: flex; flex-direction: column; gap: 8px; max-width: 820px">
          <h2 class="lbl" style="margin: 0; font-size: var(--fs-sm)">Sentencias</h2>
          <sc-if value="{{running}}" hint-placeholder-val="{{ true }}"><ol aria-label="Progreso por sentencia" style="list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">%s</ol></sc-if>
          <sc-if value="{{done}}" hint-placeholder-val="{{ false }}"><ol aria-label="Resultado por sentencia" style="list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">%s</ol></sc-if>
        </section>
        <sc-if value="{{running}}" hint-placeholder-val="{{ true }}"><div style="max-width: 820px">%s</div></sc-if>''' % (
    ic('spin', 18), progress(66, 'Sentencia 3 de 3 · 2 aplicadas', '00:02 transcurrido', 'Sentencias aplicadas'), ic('check', 15), run_list, done_list,
    note('Todo va en una transacción: si cancelas o una sentencia falla, se revierte todo y Ventas copia queda como estaba.'))
apply_footer = '''      <footer style="height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 24px; border-top: 1px solid var(--border); background: var(--surface)">
        <sc-if value="{{running}}" hint-placeholder-val="{{ true }}">%s<span class="help">Puedes seguir trabajando en otras pestañas.</span>%s<span class="dlg-actions"><a href="SchemaSyncResult.dc.html" class="btn">%sCancelar</a></span></sc-if>
        <sc-if value="{{done}}" hint-placeholder-val="{{ false }}"><a href="#" class="btn btn-ghost">%sCopiar registro</a>%s<span class="dlg-actions"><a href="SchemaSync.dc.html" class="btn">Comparar de nuevo</a><a href="DataGrid.dc.html" class="btn">Cerrar</a></span></sc-if>
      </footer>''' % (btn_disabled('Atrás'), FLEX, ic('stop', 14), ic('copy', 15), FLEX)
main = '\n'.join([stepper('Sincronizar estructura', 'Ventas → Ventas copia · main', SS_STEPS, 3),
                  body(apply_body, gap='20px'), apply_footer])
write('SchemaSyncApply', 'Sincronizar estructura · aplicar', shell(main, SS_TITLE, status='conn="Ventas" db="main" info="{{statusInfo}}"'), {
    'tabs': "JS:[{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html', dirty: true }, { label: 'clientes', kind: 'table', href: 'DataGrid.dc.html' }, { label: 'Sincronizar estructura', kind: 'tool', active: true, color: '#2f7dd6', running: (this.props.state ?? 'running') === 'running' }]",
    'running': "JS:(this.props.state ?? 'running') === 'running'",
    'done': "JS:(this.props.state ?? 'running') === 'done'",
    'statusInfo': "JS:(this.props.state ?? 'running') === 'running' ? 'Aplicando · sentencia 3 de 3' : '3 sentencias aplicadas · 2.1 s'"},
    extra_props='"state":{"editor":"enum","options":["running","done"],"default":"running"}')


# ---------- data diff (A-01) ----------
DD_STEPS = ['Comparar', 'Revisar', 'Aplicar']
DD_TITLE = 'Sincronizar datos · clientes — Ventas — Squaero'
dd_rows = [row('Origen', static('%s<span style="display: flex; color: var(--obj-table)">%s</span><span style="font-weight: 600">clientes</span><span style="color: var(--text-dim)">· Ventas · main · 12 filas</span>' % (dot('Ventas'), ic('table', 15)))),
           row('Conexión destino', select('ddst', ['Ventas copia', 'Producción (PostgreSQL) · solo lectura'], cls='field is-focus'), '', 'ddst'),
           row('Base de datos', select('dddb', ['main']), '', 'dddb'),
           row('Tabla destino', select('ddtbl', ['clientes']), 'Mismo nombre que el origen.', 'ddtbl'),
           row('Clave de comparación', static(ic('key', 13, 'color: var(--warn)') + mono('id') + '<span style="color: var(--text-dim); font-size: var(--fs-sm)">· clave primaria</span>'))]
main = '\n'.join([stepper('Sincronizar datos · clientes', 'Iguala las filas del destino a las del origen', DD_STEPS, 1),
                  body(note('Se compara la <b>tabla completa</b> por clave primaria, en bloques de 1000 filas, no solo la página cargada. Los valores se comparan por tipo (980.50 y 980.5 son iguales).') + '\n' +
                       group('Qué comparar', dd_rows) + '\n' +
                       group('Operaciones', [row('Generar', '<div>' + check('INSERT · filas que faltan en el destino') + check('UPDATE · filas distintas') + check('DELETE · filas que sobran en el destino', False) + '</div>',
                                                 'DELETE está desmarcado por defecto: borraría filas del destino.')]), gap='20px'),
                  footer('Comparar', 'DataDiffResult.dc.html')])
write('DataDiff', 'Sincronizar datos', shell(main, DD_TITLE, status='conn="Ventas" db="main" info="Sincronizar datos · clientes"'), {'tabs': tabs('Sincronizar datos')})

ops = '''        %s
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span style="font-size: var(--fs-lg); font-weight: 600">3 cambios</span><span style="color: var(--text-dim)">para igualar</span>%s<span style="font-weight: 600">Ventas copia › main.clientes</span><span style="flex: 1"></span>
          <span class="chip" style="background: var(--ok-soft); color: var(--ok)">1 INSERT</span><span class="chip" style="background: var(--warn-soft); color: var(--warn)">2 UPDATE</span><span class="chip" style="background: var(--surface); color: var(--text-dim); border: 1px solid var(--border)">0 DELETE · desactivado</span></div>
        <div class="help">Tabla completa comparada por id: 12 filas en el origen, 11 en el destino, 9 iguales.</div>
        %s
        %s''' % (route('clientes · 12 filas', 'Ventas copia', 'clientes · 11 filas'), dot('Ventas copia'),
                 gridbox('ocols', 'orows', 'Cambios por fila', '132px', 'row-state="{{ostate}}" '),
                 sqlbox('ddsql', '186px', '<span style="color: var(--text); font-weight: 600">SQL</span><span>· 3 sentencias · literales según el tipo de cada columna · en una transacción</span>', '<a href="#" class="btn btn-ghost" style="height: 26px">%sCopiar</a>' % ic('copy', 14)))
main = '\n'.join([stepper('Sincronizar datos · clientes', 'Ventas → Ventas copia · main', DD_STEPS, 2),
                  body(ops, pad='18px 24px', gap='12px'),
                  footer('Aplicar 3 cambios en Ventas copia…', 'DataDiffConfirm.dc.html', back_href='DataDiff.dc.html',
                         helpers='<a href="EditorResult.dc.html" class="btn btn-ghost">%sAbrir en el editor</a>' % ic('query', 15))])
DD_VALS = {
    'tabs': tabs('Sincronizar datos'),
    'ocols': [{'name': 'operación', 'type': 'text', 'kind': 'text', 'w': '110px'}, {'name': 'id', 'type': 'integer', 'kind': 'num', 'w': '56px', 'key': True},
              {'name': 'columna', 'type': 'text', 'kind': 'text', 'w': '110px'}, {'name': 'en el destino', 'type': 'valor actual', 'kind': 'text', 'w': '170px'},
              {'name': 'pasa a', 'type': 'valor del origen', 'kind': 'text', 'w': '1fr'}],
    'orows': [['INSERT', 12, '(fila nueva)', None, 'Andrés Solís · asolis@correo.mx · Puerto Peñasco · 315.75'], ['UPDATE', 2, 'saldo', '900.00', '980.50'], ['UPDATE', 5, 'ciudad', 'Navojoa', 'Hermosillo']],
    'ostate': "JS:{ 0: 'added', 1: 'changed', 2: 'changed' }",
    'ddsql': 'INSERT INTO "main"."clientes" ("id", "nombre", "email", "ciudad", "saldo", "activo", "alta")\n  VALUES (12, \'Andrés Solís\', \'asolis@correo.mx\', \'Puerto Peñasco\', 315.75, TRUE, \'2025-06-19\');\nUPDATE "main"."clientes" SET "saldo" = 980.50 WHERE "id" = 2;\nUPDATE "main"."clientes" SET "ciudad" = \'Hermosillo\' WHERE "id" = 5;'}
write('DataDiffResult', 'Sincronizar datos · revisar', shell(main, DD_TITLE, status='conn="Ventas" db="main" info="3 cambios · 1 INSERT · 2 UPDATE · 0 DELETE"'), DD_VALS)

# confirm (NEW, A-01)
ddc = '''<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden">
  <div style="position: absolute; left: 0; top: 0; width: 1280px; height: 800px">
    <dc-import name="DataDiffResult" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <div class="dlg-scrim">
    <div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="ddcTitle" aria-describedby="ddcDesc" style="width: 540px">
      <div class="dlg-h">
        <span style="width: 28px; height: 28px; flex: none; border-radius: 50%%; display: flex; align-items: center; justify-content: center; background: var(--danger-soft); color: var(--danger)">%s</span>
        <span id="ddcTitle" style="flex: 1">¿Aplicar 3 cambios en Ventas copia?</span>
        <a href="DataDiffResult.dc.html" class="btn btn-icon" aria-label="Cancelar (Esc)">%s</a>
      </div>
      <div class="dlg-b">
        <div id="ddcDesc" style="display: flex; flex-direction: column; gap: 10px; line-height: 1.5">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">Vas a modificar %s<b>Ventas copia › main.clientes</b></div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap"><span class="chip" style="background: var(--ok-soft); color: var(--ok)">1 INSERT</span><span class="chip" style="background: var(--warn-soft); color: var(--warn)">2 UPDATE</span><span class="chip" style="background: var(--surface); color: var(--text-dim); border: 1px solid var(--border)">0 DELETE</span></div>
          <div style="font-size: var(--fs-sm); color: var(--text-dim)">Se comparó la tabla completa por id (12 filas en Ventas, 11 en Ventas copia). Las 3 sentencias van en una transacción: si una falla, no se aplica ninguna.</div>
        </div>
        %s
      </div>
      <div class="dlg-f">
        <a href="#" class="btn btn-ghost">%sCopiar SQL</a>
        <span class="help">Esc cancela</span>
        <span style="flex: 1"></span>
        <span class="dlg-actions"><a href="DataGrid.dc.html" class="btn btn-danger">Aplicar 3 cambios</a><a href="DataDiffResult.dc.html" class="btn focus">Cancelar</a></span>
      </div>
    </div>
  </div>
</div>''' % (ic('warning', 15), ic('close', 16), dot('Ventas copia'),
             note('Ventas copia no está protegida. En una conexión protegida (como Producción) tendrías que escribir su nombre para confirmar.'), ic('copy', 15))
write('DataDiffConfirm', 'Sincronizar datos · confirmar', ddc, {})


# ---------- object list ----------
ol_bar = '''      <div role="toolbar" aria-label="Acciones de la lista de objetos" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <a href="NewTableDesigner.dc.html" class="btn btn-primary">%sNueva tabla</a>
        %s
        <span class="seg" role="tablist" aria-label="Tipo de objeto"><a href="#" role="tab" aria-selected="true" class="on">Todos <span class="num" style="margin-left: 6px">6</span></a><a href="#" role="tab" aria-selected="false"><span aria-hidden="true" style="width: 6px; height: 6px; border-radius: 2px; background: var(--obj-table); margin-right: 6px"></span>Tablas <span class="num" style="margin-left: 6px">4</span></a><a href="#" role="tab" aria-selected="false"><span aria-hidden="true" style="width: 6px; height: 6px; border-radius: 2px; background: var(--obj-view); margin-right: 6px"></span>Vistas <span class="num" style="margin-left: 6px">1</span></a><a href="#" role="tab" aria-selected="false"><span aria-hidden="true" style="width: 6px; height: 6px; border-radius: 2px; background: var(--obj-trigger); margin-right: 6px"></span>Triggers <span class="num" style="margin-left: 6px">1</span></a></span>
        <label style="position: relative; margin-left: 6px"><span style="position: absolute; left: -9999px">Filtrar por nombre</span>%s<input class="field" placeholder="Filtrar por nombre" style="width: 200px; padding-left: 28px; font-size: var(--fs-sm)"></label>
        %s
        <a href="#" class="btn btn-icon" aria-label="Refrescar (F5)" title="Refrescar (F5)">%s</a>
        <a href="TreeContextMenu.dc.html" class="btn btn-icon" aria-label="Más acciones" aria-haspopup="menu" title="Más acciones">%s</a>
      </div>''' % (ic('plus', 15), SEP, ic('search', 14, 'position: absolute; left: 9px; top: 7px; color: var(--text-dim)'), FLEX, ic('refresh', 16), ic('more', 16))
main = ol_bar + '''
      <div style="flex: 1; min-height: 0">
        <dc-import name="Grid" theme="{{theme}}" columns="{{cols}}" rows="{{rows}}" selected="{{sel}}" label="Objetos de main" height="100%" hint-size="100%,100%"></dc-import>
      </div>
      <div style="height: 34px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">
        <span>6 objetos · 4 tablas · 1 vista · 1 trigger</span><span style="flex: 1"></span><span class="help">Intro o doble clic abre los datos · <span class="kbd">F12</span> abre la estructura</span>
      </div>'''
write('ObjectList', 'Objetos · main', shell(main, 'Objetos · main — Ventas — Squaero', explorer='state="connected" tree="tables" selected="main"', status='conn="Ventas" db="main" info="6 objetos"'), {
    'tabs': [{'label': 'Consulta 1', 'kind': 'query', 'href': 'EditorResult.dc.html', 'dirty': True}, {'label': 'Objetos · main', 'kind': 'tool', 'active': True, 'color': CONN['Ventas']}],
    'cols': [{'name': 'nombre', 'type': 'text', 'kind': 'text', 'w': '200px', 'sort': '↑'}, {'name': 'tipo', 'type': 'text', 'kind': 'text', 'w': '90px'},
             {'name': 'filas', 'type': 'integer', 'kind': 'num', 'w': '80px'}, {'name': 'columnas', 'type': 'integer', 'kind': 'num', 'w': '90px'},
             {'name': 'índices', 'type': 'integer', 'kind': 'num', 'w': '80px'}, {'name': 'definición', 'type': 'text', 'kind': 'text', 'w': '1fr'}],
    'rows': [['clientes', 'Tabla', 12, 7, 2, 'id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, …'], ['detalle_pedido', 'Tabla', 20, 5, 1, 'pedido_id → pedidos, producto_id → productos'],
             ['pedidos', 'Tabla', 8, 5, 1, 'cliente_id → clientes'], ['productos', 'Tabla', 8, 4, 1, 'id INTEGER PRIMARY KEY, nombre TEXT, precio …'],
             ['trg_pedidos_total', 'Trigger', None, None, None, 'AFTER INSERT ON detalle_pedido'],
             ['ventas_por_ciudad', 'Vista', None, 3, None, 'SELECT c.ciudad, COUNT(p.id) AS pedidos, SUM(p.total) …']],
    'sel': {'r': 0, 'c': 0}})


# ---------- table object views: switcher identical to DataGrid (R-12) ----------
def obj_toolbar(on, label, actions):
    views = [('Datos', 'DataGrid.dc.html'), ('Estructura', 'StructureView.dc.html'), ('Índices', 'IndexManager.dc.html'), ('DDL', 'DdlView.dc.html')]
    seg = '\n'.join('          <a href="%s" role="tab" aria-selected="%s"%s>%s</a>' % (h, 'true' if t == on else 'false', ' class="on"' if t == on else '', t) for t, h in views)
    return '''      <div role="toolbar" aria-label="%s" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <span class="seg" role="tablist" aria-label="Vista del objeto">
%s
        </span>
        %s
        %s
        <span style="flex: 1"></span>
        <a href="#" class="btn btn-icon" aria-label="Refrescar (F5)" title="Refrescar (F5)">%s</a>
        <a href="TreeContextMenu.dc.html" class="btn btn-icon" aria-label="Más acciones: eliminar tabla, vaciar, renombrar" aria-haspopup="menu" title="Más acciones">%s</a>
      </div>''' % (label, seg, SEP, actions, ic('refresh', 16), ic('more', 16))


OBJ_TABS = [{'label': 'Consulta 1', 'kind': 'query', 'href': 'EditorResult.dc.html', 'dirty': True}, {'label': 'clientes', 'kind': 'table', 'active': True, 'href': 'StructureView.dc.html'}]
OBJ_TITLE = 'clientes — Ventas — Squaero'

# Structure (A-28): sections Columnas, Índices, Claves foráneas, Referenciada por, Triggers
st_actions = ('<a href="TableDesigner.dc.html" class="btn btn-ghost">%sModificar tabla</a>\n        <a href="TableDesigner.dc.html" class="btn btn-ghost">%sColumna</a>\n'
              '        <a href="DdlView.dc.html" class="btn btn-ghost">%sCopiar DDL</a>') % (ic('edit', 15), ic('plus', 15), ic('copy', 15))
YES = '<span role="img" aria-label="sí" style="display: flex; color: var(--text)">%s</span>' % ic('check', 14)
NO = '<span aria-label="no" style="color: var(--text-dim)">—</span>'
KEY = lambda t: '<span style="display: inline-flex; align-items: center; gap: 4px">%s%s</span>' % (ic('key', 12, 'color: var(--warn)'), t)
col_rows = [
    [mono('1', 'color: var(--text-dim)'), mono('id', 'font-weight: 600'), mono('INTEGER'), NO, NO, KEY('Clave primaria · autoincremental')],
    [mono('2', 'color: var(--text-dim)'), mono('nombre', 'font-weight: 600'), mono('TEXT'), NO, NO, ''],
    [mono('3', 'color: var(--text-dim)'), mono('email', 'font-weight: 600'), mono('TEXT'), YES, NO, 'Única · ux_clientes_email'],
    [mono('4', 'color: var(--text-dim)'), mono('ciudad', 'font-weight: 600'), mono('TEXT'), YES, NO, 'Índice · ix_clientes_ciudad'],
    [mono('5', 'color: var(--text-dim)'), mono('saldo', 'font-weight: 600'), mono('NUMERIC(10,2)'), YES, mono('0'), ''],
    [mono('6', 'color: var(--text-dim)'), mono('activo', 'font-weight: 600'), mono('BOOLEAN'), NO, mono('TRUE'), ''],
    [mono('7', 'color: var(--text-dim)'), mono('alta', 'font-weight: 600'), mono('DATE'), YES, mono("date('now')"), '']]
col_tbl = table('Columnas de clientes', ['#', 'Columna', 'Tipo', 'Admite NULL', 'Por defecto', 'Clave / índice'], col_rows, '28px 150px 140px 96px 130px 1fr', 28)
ix_tbl = table('Índices de clientes', ['Nombre', 'Columnas', 'Único'], [[mono('ux_clientes_email'), mono('email'), YES], [mono('ix_clientes_ciudad'), mono('ciudad'), NO]], '1fr 110px 50px', 28)
ref_tbl = table('Tablas que referencian clientes', ['Desde', 'Hacia', 'Al borrar'], [['<a href="DataGrid.dc.html" class="mono" style="font-size: var(--fs-sm)">pedidos.cliente_id</a>', mono('clientes.id'), '<span style="color: var(--text-dim)">Sin acción</span>']], '1fr 90px 80px', 28)


def sec(title, count, inner, right=''):
    return '''          <details open="open" style="display: flex; flex-direction: column">
            <summary style="height: 28px; display: flex; align-items: center; gap: 8px; cursor: default; list-style: none"><span style="display: flex; color: var(--text-dim)">%s</span><h2 style="margin: 0; font-size: var(--fs-md); font-weight: 600">%s</h2><span class="num help">%s</span><span style="flex: 1"></span>%s</summary>
            <div style="margin-top: 6px">%s</div>
          </details>''' % (ic('chev-d', 14), title, count, right, inner)


empty = lambda t, link='': '<div style="min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px dashed var(--border); border-radius: var(--r-md); font-size: var(--fs-sm); color: var(--text-dim)">%s%s</div>' % (t, link)
st_body = '''      <div style="flex: 1; min-height: 0; overflow: auto; padding: 14px 20px 20px; display: flex; flex-direction: column; gap: 14px">
        <div class="help">Tabla · Ventas › main · 7 columnas · 12 filas · 2 índices · referenciada por 1 tabla</div>
%s
        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px 20px; align-items: start">
%s
%s
%s
%s
        </div>
      </div>''' % (sec('Columnas', '7', col_tbl),
                   sec('Índices', '2', ix_tbl, '<a href="IndexManager.dc.html" style="font-size: var(--fs-sm)">Gestionar índices</a>'),
                   sec('Referenciada por', '1', ref_tbl),
                   sec('Claves foráneas', '0', empty('Ninguna: clientes no referencia otras tablas.')),
                   sec('Triggers', '0', empty('Ninguno en esta tabla.', '<span style="flex: 1"></span><a href="Triggers.dc.html">Nuevo trigger…</a>')))
main = obj_toolbar('Estructura', 'Acciones de la estructura', st_actions) + '\n' + st_body
write('StructureView', 'Estructura · clientes', shell(main, OBJ_TITLE, status='conn="Ventas" db="main" info="clientes · 7 columnas · 2 índices"'), {'tabs': OBJ_TABS})

# DDL
DDL = 'CREATE TABLE "clientes" (\n  "id"     INTEGER PRIMARY KEY AUTOINCREMENT,\n  "nombre" TEXT NOT NULL,\n  "email"  TEXT,\n  "ciudad" TEXT,\n  "saldo"  NUMERIC(10,2) DEFAULT 0,\n  "activo" BOOLEAN NOT NULL DEFAULT TRUE,\n  "alta"   DATE DEFAULT (date(\'now\'))\n);\n\nCREATE UNIQUE INDEX "ux_clientes_email" ON "clientes" ("email");\nCREATE INDEX "ix_clientes_ciudad" ON "clientes" ("ciudad");'
ddl_actions = '<a href="#" class="btn btn-ghost">%sCopiar DDL</a>\n        <a href="EditorResult.dc.html" class="btn btn-ghost">%sAbrir en el editor</a>\n        <a href="#" class="btn btn-ghost">%sGuardar .sql</a>' % (ic('copy', 15), ic('query', 15), ic('save', 15))
main = obj_toolbar('DDL', 'Acciones del DDL', ddl_actions) + '''
      <div style="flex: 1; min-height: 0; position: relative">
        <dc-import name="SqlEditor" theme="{{theme}}" sql="{{ddl}}" current="{{noLine}}" height="100%" hint-size="100%,100%"></dc-import>
        <span class="chip" style="position: absolute; right: 14px; top: 10px; background: var(--surface); color: var(--text-dim); border: 1px solid var(--border)">''' + ic('lock', 12) + '''Solo lectura · generado por el motor</span>
      </div>'''
write('DdlView', 'DDL · clientes', shell(main, OBJ_TITLE, status='conn="Ventas" db="main" info="clientes · DDL · 12 líneas"'), {'tabs': OBJ_TABS, 'ddl': DDL})

# Indexes (A-24, A-26)
ix_actions = ('<a href="#ixname" class="btn btn-ghost" aria-pressed="true" style="background: var(--hover)">%sNuevo índice</a>\n'
              '        <a href="#" class="btn btn-ghost" style="color: var(--danger)">%sEliminar ix_clientes_ciudad…</a>') % (ic('plus', 15), ic('trash', 15))
ix_rows = ''.join('''<div role="row" style="display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) 52px minmax(0, 1.3fr) 32px; gap: 0 12px; align-items: center; height: 36px; padding: 0 8px 0 14px; %s">
              <span role="cell">%s</span><span role="cell">%s</span><span role="cell">%s</span><span role="cell" style="color: var(--text-dim)">%s</span>
              <a href="#" role="cell" class="btn btn-icon" aria-label="Eliminar el índice %s" title="Eliminar índice" style="width: 28px; height: 28px">%s</a>
            </div>''' % ('border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);' + (' background: var(--sel); box-shadow: inset 3px 0 0 var(--accent);' if sel_ else ''),
                         mono(n, 'font-weight: 500'), mono(c), YES if u else NO, o, n, ic('trash', 15)) for n, c, u, o, sel_ in [
    ('ux_clientes_email', 'email', True, 'Índice único', False), ('ix_clientes_ciudad', 'ciudad', False, 'Índice', True)])
ix_list = '''          <section style="flex: none; display: flex; flex-direction: column; gap: 8px; padding: 16px 16px 8px">
            <div style="display: flex; align-items: baseline; gap: 8px"><h2 style="margin: 0; font-size: var(--fs-md); font-weight: 600">Índices</h2><span class="help num">2</span></div>
            <div role="table" aria-label="Índices de clientes" style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">
              <div role="row" style="display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) 52px minmax(0, 1.3fr) 32px; gap: 0 12px; align-items: center; height: 30px; padding: 0 8px 0 14px; background: var(--surface); font-size: var(--fs-sm); font-weight: 600"><span role="columnheader">Nombre</span><span role="columnheader">Columnas</span><span role="columnheader">Único</span><span role="columnheader">Origen</span><span></span></div>
              %s
            </div>
            <div class="help">La clave primaria id es el rowid de SQLite: no necesita un índice aparte.</div>
          </section>''' % ix_rows
constraints = '''          <section style="flex: none; display: flex; flex-direction: column; gap: 8px; padding: 8px 16px 16px">
            <div style="display: flex; align-items: center; gap: 8px"><h2 style="margin: 0; font-size: var(--fs-md); font-weight: 600">Restricciones</h2><span style="flex: 1"></span>%s</div>
            %s
          </section>''' % (btn_disabled('Nueva restricción', icon=ic('plus', 14)),
                           note('SQLite no permite añadir restricciones a una tabla existente: se definen en el CREATE TABLE. <a href="DdlView.dc.html">Ver el DDL</a>'))
ix_form = '''        <aside aria-label="Nuevo índice" style="width: 340px; flex: none; display: flex; flex-direction: column; gap: 14px; padding: 16px; border-left: 1px solid var(--border); background: var(--surface)">
          <h2 style="margin: 0; font-size: var(--fs-lg); font-weight: 600">Nuevo índice</h2>
          <div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px 12px; align-items: center">
            <label for="ixname" style="color: var(--text-dim)">Nombre</label>%s
            <span style="color: var(--text-dim); align-self: start; padding-top: 4px">Columnas</span>
            <div style="display: flex; flex-wrap: wrap; gap: 6px"><span class="chip" style="height: 26px; padding-right: 2px; background: var(--accent-soft); color: var(--accent-text)"><span class="mono">ciudad</span><a href="#" class="btn btn-icon" aria-label="Quitar ciudad" style="width: 24px; height: 24px; color: inherit">%s</a></span><span class="chip" style="height: 26px; padding-right: 2px; background: var(--accent-soft); color: var(--accent-text)"><span class="mono">alta</span><a href="#" class="btn btn-icon" aria-label="Quitar alta" style="width: 24px; height: 24px; color: inherit">%s</a></span><a href="#" class="btn" style="height: 26px; border-style: dashed; font-size: var(--fs-sm)">%sColumna</a></div>
            <span></span>%s
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px"><span class="lbl">Vista previa</span>%s</div>
          <div style="display: flex; gap: 8px"><span class="dlg-actions"><a href="#" class="btn btn-primary">Crear índice</a><a href="#" class="btn">Cancelar</a></span></div>
        </aside>''' % (inp('ixname', 'ix_clientes_ciudad_alta', cls='field is-focus', mono=True), ic('close', 12), ic('close', 12), ic('plus', 13), check('Único', False), sqlbox('ixsql', '92px'))
main = obj_toolbar('Índices', 'Acciones de los índices', ix_actions) + '''
      <div style="flex: 1; min-height: 0; display: flex">
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: auto">
''' + ix_list + '\n' + constraints + '''
        </div>
''' + ix_form + '''
      </div>'''
write('IndexManager', 'Índices · clientes', shell(main, OBJ_TITLE, status='conn="Ventas" db="main" info="clientes · 2 índices"'), {
    'tabs': OBJ_TABS, 'ixsql': 'CREATE INDEX\n  "ix_clientes_ciudad_alta"\n  ON "clientes" ("ciudad", "alta");'})


# ---------- table designer ----------
DES_MARKUP = '''      <div style="flex: 1; min-height: 0; display: flex">
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px; padding: 16px 20px; overflow: hidden">
          <div style="display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 0 16px; align-items: center">
            <label for="tname" style="color: var(--text-dim)">Nombre de la tabla</label>
            <input id="tname" class="{{nameClass}}" value="{{tname}}" style="width: 280px; font-family: var(--font-mono); font-size: var(--fs-sm)">
          </div>
          <div role="table" aria-label="Columnas" style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; font-size: var(--fs-md)">
            <div role="row" style="display: grid; grid-template-columns: 32px 1fr 1.25fr 48px 40px 44px 1.15fr 36px; align-items: center; height: 30px; padding: 0 6px; gap: 6px; border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); font-weight: 600">
              <span></span><span role="columnheader">Columna</span><span role="columnheader">Tipo</span><span role="columnheader" style="text-align: center" title="Admite NULL">NULL</span><span role="columnheader" style="text-align: center" title="Clave primaria">PK</span><span role="columnheader" style="text-align: center" title="Autoincremental">Auto</span><span role="columnheader">Por defecto</span><span></span>
            </div>
            <sc-for list="{{cols}}" as="c" hint-placeholder-count="6">
              <div role="row" style="{{c.style}}">
                <span style="font-size: var(--fs-xs); color: var(--text-dim); text-align: center" class="num">{{c.n}}</span>
                <input class="{{c.cls}}" value="{{c.name}}" aria-label="Nombre de la columna {{c.n}}" style="width: 100%; height: 26px; font-family: var(--font-mono); font-size: var(--fs-sm)">
                <input class="field" list="tipos" value="{{c.type}}" aria-label="Tipo de la columna {{c.n}}" style="width: 100%; height: 26px; font-family: var(--font-mono); font-size: var(--fs-sm)">
                <span style="display: flex; justify-content: center"><input type="checkbox" checked="{{c.nul}}" aria-label="Admite NULL la columna {{c.n}}" style="accent-color: var(--accent); width: 16px; height: 16px; margin: 0"></span>
                <span style="display: flex; justify-content: center"><input type="checkbox" checked="{{c.pk}}" aria-label="Clave primaria en la columna {{c.n}}" style="accent-color: var(--accent); width: 16px; height: 16px; margin: 0"></span>
                <span style="display: flex; justify-content: center"><input type="checkbox" checked="{{c.ai}}" aria-label="Autoincremental en la columna {{c.n}}" style="accent-color: var(--accent); width: 16px; height: 16px; margin: 0"></span>
                <input class="field" value="{{c.def}}" aria-label="Valor por defecto de la columna {{c.n}}" style="width: 100%; height: 26px; font-family: var(--font-mono); font-size: var(--fs-sm)">
                <a href="#" class="btn btn-icon" aria-label="Quitar la columna {{c.name}}" title="Quitar columna" style="width: 28px; height: 28px">''' + ic('trash', 14) + '''</a>
              </div>
            </sc-for>
            <a href="#" style="height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 12px; color: var(--accent-text); text-decoration: none; font-size: var(--fs-md)">''' + ic('plus', 15) + '''Añadir columna<span class="kbd" style="margin-left: 4px">{{kAdd}}</span></a>
          </div>
          <datalist id="tipos"><option value="INTEGER"></option><option value="TEXT"></option><option value="REAL"></option><option value="NUMERIC(10,2)"></option><option value="BOOLEAN"></option><option value="DATE"></option><option value="BLOB"></option></datalist>
          <div class="help">{{hint}}</div>
        </div>
        <aside aria-label="Vista previa SQL" style="width: 370px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--surface)">
          <div style="height: 40px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--border)">
            <span style="font-weight: 600">Vista previa SQL</span><span class="help">{{previewInfo}}</span><span style="flex: 1"></span>
            <a href="#" class="btn btn-icon" aria-label="Copiar SQL" title="Copiar SQL">''' + ic('copy', 15) + '''</a>
            <a href="EditorResult.dc.html" class="btn btn-icon" aria-label="Abrir en el editor" title="Abrir en el editor">''' + ic('query', 15) + '''</a>
          </div>
          <div style="flex: 1; min-height: 0">
            <dc-import name="SqlEditor" theme="{{theme}}" sql="{{sql}}" current="{{noLine}}" height="100%" hint-size="100%,100%"></dc-import>
          </div>
          <div style="flex: none; display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">''' + ic('info', 14, 'flex: none; margin-top: 1px') + '''<span>{{note}}</span></div>
        </aside>
      </div>'''

DES_JS = '''class Component extends DCLogic {
  renderVals() {
    const added = %s;
    const focus = %s;
    const os = this.props.os ?? 'windows';
    const cols = %s.map((c, i) => ({ n: i + 1, name: c[0], type: c[1], nul: c[2], pk: c[3], ai: c[4], def: c[5] ?? '',
      cls: i === focus ? 'field is-focus' : 'field',
      style: `display: grid; grid-template-columns: 32px 1fr 1.25fr 48px 40px 44px 1.15fr 36px; align-items: center; height: 36px; padding: 0 6px; gap: 6px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%%, transparent); background: ${added.includes(i) ? 'var(--ok-soft)' : (i %% 2 ? 'var(--zebra)' : 'transparent')}; ${added.includes(i) ? 'box-shadow: inset 2px 0 0 var(--ok);' : ''}` }));
    return {
      theme: this.props.theme ?? 'b', os, noLine: 0, tabs: %s, cols, kAdd: os === 'macos' ? '⌘↩' : 'Ctrl+Intro',
      tname: %s, nameClass: %s, hint: %s, previewInfo: %s, note: %s,
      sql: %s
    };
  }
}
'''


def designer(name, title, tab_label, actions, sql, cols, added, focus, tname, name_focus, hint, pinfo, note_, status, tab_href, sub):
    bar = '''      <div role="toolbar" aria-label="Acciones del diseñador" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <span style="display: flex; align-items: center; gap: 8px; padding: 0 6px"><span style="display: flex; color: var(--obj-table)">%s</span><b style="font-weight: 600">%s</b><span class="help">%s</span></span>
        %s
        %s
      </div>''' % (ic('table', 16), title, sub, FLEX, actions)
    main = bar + '\n' + DES_MARKUP
    tabs_v = [{'label': 'Consulta 1', 'kind': 'query', 'href': 'EditorResult.dc.html', 'dirty': True}, {'label': tab_label, 'kind': 'tool', 'active': True, 'dirty': True, 'href': tab_href, 'color': CONN['Ventas']}]
    jsrc = DES_JS % (J(added), J(focus), J(cols), J(tabs_v), J(tname), J('field is-focus' if name_focus else 'field'), J(hint), J(pinfo), J(note_), J(sql))
    src = '%s\n%s\n---PROPS---\n%s\n---JS---\n%s' % (title, shell(main, title + ' — Ventas — Squaero', status=status), props(), jsrc)
    io.open(os.path.join(BODIES, name + '.body'), 'w', encoding='utf-8', newline='\n').write(src)


designer('TableDesigner', 'Modificar · clientes', 'Modificar · clientes',
         '<span class="dlg-actions"><a href="StructureView.dc.html" class="btn btn-primary">Aplicar 1 cambio</a><a href="StructureView.dc.html" class="btn">Descartar</a></span>',
         'ALTER TABLE "clientes"\n  ADD COLUMN "telefono" TEXT;',
         [['id', 'INTEGER', False, True, True, None], ['nombre', 'TEXT', False, False, False, None], ['email', 'TEXT', True, False, False, None],
          ['ciudad', 'TEXT', True, False, False, None], ['saldo', 'NUMERIC(10,2)', True, False, False, '0'], ['activo', 'BOOLEAN', False, False, False, 'TRUE'],
          ['alta', 'DATE', True, False, False, "date('now')"], ['telefono', 'TEXT', True, False, False, None]],
         [7], 7, 'clientes', False, '1 columna nueva (en verde) · los cambios se aplican en una transacción.', '· 1 sentencia',
         'SQLite solo admite añadir y renombrar columnas con ALTER TABLE; cambiar un tipo recrea la tabla.',
         'conn="Ventas" db="main" info="clientes · 1 cambio sin aplicar"', 'TableDesigner.dc.html', 'Ventas · main')

designer('NewTableDesigner', 'Nueva tabla', 'Nueva tabla',
         '<span class="dlg-actions"><a href="StructureView.dc.html" class="btn btn-primary">Crear tabla proveedores</a><a href="ObjectList.dc.html" class="btn">Cancelar</a></span>',
         'CREATE TABLE "proveedores" (\n  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,\n  "nombre"   TEXT NOT NULL,\n  "contacto" TEXT,\n  "ciudad"   TEXT DEFAULT \'Hermosillo\',\n  "alta"     DATE DEFAULT (date(\'now\'))\n);',
         [['id', 'INTEGER', False, True, True, None], ['nombre', 'TEXT', False, False, False, None], ['contacto', 'TEXT', True, False, False, None],
          ['ciudad', 'TEXT', True, False, False, "'Hermosillo'"], ['alta', 'DATE', True, False, False, "date('now')"], ['', '', True, False, False, None]],
         [], 5, 'proveedores', False, '5 columnas · la fila vacía del final es para la siguiente y se ignora.', '· 1 sentencia',
         'La vista previa se actualiza mientras escribes.',
         'conn="Ventas" db="main" info="Nueva tabla · 5 columnas"', 'NewTableDesigner.dc.html', 'Ventas · main')


# ---------- confirm drop (R-08, A-25) ----------
overlay = '''  <div class="dlg-scrim">
    <div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dropTitle" aria-describedby="dropDesc" style="width: 520px">
      <div class="dlg-h">
        <span style="width: 28px; height: 28px; flex: none; border-radius: 50%%; display: flex; align-items: center; justify-content: center; background: var(--danger-soft); color: var(--danger)">%s</span>
        <span id="dropTitle" style="flex: 1">¿Eliminar la tabla clientes?</span>
        <a href="DataGrid.dc.html" class="btn btn-icon" aria-label="Cancelar (Esc)">%s</a>
      </div>
      <div class="dlg-b">
        <p id="dropDesc" style="margin: 0; line-height: 1.5">Se borrarán la tabla, sus <b>12 filas</b> y sus <b>2 índices</b> de <b>Ventas › main</b>. No se puede deshacer.</p>
        %s
        <div style="display: flex; flex-direction: column; gap: 6px"><span class="lbl">Se ejecutará</span>%s</div>
        <div style="display: flex; flex-direction: column; gap: 6px">
          <label for="confirmName">Escribe <b class="mono" style="font-size: var(--fs-sm)">clientes</b> para confirmar</label>
          <div style="position: relative"><input id="confirmName" class="field is-focus" value="{{typedValue}}" autocomplete="off" spellcheck="false" aria-describedby="confirmHelp" style="width: 100%%; font-family: var(--font-mono); font-size: var(--fs-sm)">
          <sc-if value="{{typed}}" hint-placeholder-val="{{ false }}"><span style="position: absolute; right: 10px; top: 6px; display: flex; align-items: center; gap: 4px; font-size: var(--fs-sm); color: var(--ok)">%sCoincide</span></sc-if></div>
          <div id="confirmHelp" class="help">Intro no elimina: pulsa el botón. Esc cancela.</div>
        </div>
      </div>
      <div class="dlg-f">
        <a href="#" class="btn btn-ghost">%sCopiar SQL</a>
        <span style="flex: 1"></span>
        <span class="dlg-actions">
          <sc-if value="{{typed}}" hint-placeholder-val="{{ false }}"><a href="ObjectList.dc.html" class="btn btn-danger">Eliminar tabla</a></sc-if>
          <sc-if value="{{notTyped}}" hint-placeholder-val="{{ true }}"><button type="button" class="btn btn-danger" disabled="disabled" title="Escribe el nombre de la tabla para activarlo" style="opacity: .45">Eliminar tabla</button></sc-if>
          <a href="DataGrid.dc.html" class="btn">Cancelar</a>
        </span>
      </div>
    </div>
  </div>
''' % (ic('trash', 15), ic('close', 16),
       note('<span class="mono">pedidos.cliente_id</span> referencia esta tabla: sus 8 pedidos quedarán apuntando a clientes que ya no existen.', 'warn', 'warning'),
       sqlbox('drop', '40px'), ic('check', 13), ic('copy', 15))
cd = '''<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden">
  <div style="position: absolute; left: 0; top: 0; width: 1280px; height: 800px">
    <dc-import name="DataGrid" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
%s</div>''' % overlay
write('ConfirmDrop', 'Eliminar tabla', cd, {'drop': 'DROP TABLE "main"."clientes";', 'typed': 'JS:!!this.props.typed', 'notTyped': 'JS:!this.props.typed',
                                            'typedValue': "JS:this.props.typed ? 'clientes' : ''"},
      extra_props='"typed":{"editor":"boolean","default":false}')

print('bodies written')
