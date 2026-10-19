# Generates the [data] group bodies. Run: python gen_data.py  (then build.py)
import io, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
P = {
    'database': '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path>',
    'table': '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 10v10"></path>',
    'view': '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
    'plus': '<path d="M12 5v14M5 12h14"></path>',
    'close': '<path d="M18 6 6 18M6 6l12 12"></path>',
    'down': '<path d="m6 9 6 6 6-6"></path>',
    'right': '<path d="m9 6 6 6-6 6"></path>',
    'left': '<path d="m15 6-6 6 6 6"></path>',
    'more': '<circle cx="5" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="19" cy="12" r="1.2"></circle>',
    'refresh': '<path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path>',
    'edit': '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
    'filter': '<path d="M3 5h18l-7 8v6l-4 2v-8z"></path>',
    'sort': '<path d="M7 4v16"></path><path d="m3 8 4-4 4 4"></path><path d="M17 20V4"></path><path d="m13 16 4 4 4-4"></path>',
    'import': '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
    'export': '<path d="M12 15V3"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14"></path>',
    'sync': '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"></path><path d="M20 4v5h-5"></path><path d="M20 12a8 8 0 0 1-14 5.3L4 15"></path><path d="M4 20v-5h5"></path>',
    'transfer': '<path d="M4 8h14l-4-4"></path><path d="M20 16H6l4 4"></path>',
    'pin': '<path d="M12 17v5"></path><path d="M9 3h6l-1 6 4 4H6l4-4z"></path>',
    'chart': '<path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M22 20H2"></path>',
    'transpose': '<path d="M4 4h7v7H4z"></path><path d="M13 13h7v7h-7z"></path><path d="M15 4h5v5"></path><path d="M9 20H4v-5"></path>',
    'compare': '<path d="M8 3v18"></path><path d="M16 3v18"></path><path d="M3 8h5"></path><path d="M16 16h5"></path>',
    'lock': '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
    'key': '<circle cx="7.5" cy="15.5" r="4.5"></circle><path d="m10.7 12.3 9.3-9.3"></path><path d="m16 7 3 3"></path>',
    'check': '<path d="M20 6 9 17l-5-5"></path>',
    'warning': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    'info': '<circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
    'trash': '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path>',
    'copy': '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    'save': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
    'search': '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
    'query': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="m9 13-2 2 2 2"></path><path d="m13 13 2 2-2 2"></path>',
    'builder': '<rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect>',
    'plan': '<rect x="9" y="2" width="6" height="5" rx="1"></rect><rect x="3" y="17" width="6" height="5" rx="1"></rect><rect x="15" y="17" width="6" height="5" rx="1"></rect><path d="M12 7v5"></path><path d="M6 17v-3h12v3"></path>',
}


P.update({
    'stop': '<rect x="6" y="6" width="12" height="12" rx="1"></rect>',
    'clipboard': '<rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>',
})


def ic(name, size=15, style=''):
    st = f' style="{style}"' if style else ''
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{st}>{P[name]}</svg>')


SPIN = ('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2.5" aria-hidden="true">'
        '<circle cx="12" cy="12" r="9" style="stroke: var(--border)"></circle><path d="M21 12a9 9 0 0 0-9-9" style="stroke: var(--accent)" stroke-linecap="round"></path></svg>')
SEP = '<span style="width: 1px; height: 20px; background: var(--border); margin: 0 4px"></span>'
FLEX = '<span style="flex: 1"></span>'
PRESSED = 'background: var(--accent-soft); color: var(--accent-text)'
KBD_ON = '<span class="kbd" style="background: transparent; color: inherit; border-color: currentColor">{}</span>'


def a(href, cls, inner, style='', extra=''):
    st = f' style="{style}"' if style else ''
    return f'<a href="{href}" class="{cls}"{st}{extra}>{inner}</a>'


def toolbar(label, items):
    return (f'<div role="toolbar" aria-label="{label}" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; '
            f'padding: 0 10px; border-bottom: 1px solid var(--border)">\n        ' + '\n        '.join(items) + '\n      </div>')


def obj_seg(view=False):
    tabs = [('Datos', 'ViewData.dc.html' if view else 'DataGrid.dc.html'), ('Estructura', 'StructureView.dc.html')]
    if not view:
        tabs.append(('Índices', 'IndexManager.dc.html'))
    tabs.append(('DDL', 'DdlView.dc.html'))
    return ('<span class="seg" role="tablist" aria-label="Vista del objeto" style="flex: none">' + ''.join(
        f'<a href="{h}" role="tab" aria-selected="{"true" if i == 0 else "false"}"{" class=\"on\"" if i == 0 else ""}>{t}</a>' for i, (t, h) in enumerate(tabs)) + '</span>')


def table_toolbar(name='clientes', on=None, filt_count=0, view=False, changes=0):
    """The DataGrid toolbar. on = filter|search|transpose|pin|compare|chart|export|more (pressed)."""
    def pr(k):
        return PRESSED if k == on else ''

    def ap(k):
        return f' aria-pressed="{"true" if k == on else "false"}"'
    items = [obj_seg(view), SEP]
    if changes:
        items += [a('DataGrid.dc.html', 'btn btn-primary', ic('save', 14) + f'Guardar ({changes})', extra=' title="Guardar los cambios en una transacción (Ctrl+S)"'),
                  a('DataGrid.dc.html', 'btn', 'Descartar'), SEP]
    if view:
        items += [f'<span class="chip" title="Una vista no tiene clave primaria: sus filas no se pueden editar ni eliminar." style="background: var(--hover); color: var(--text-dim); white-space: nowrap">{ic("lock", 12)}Solo lectura · vista</span>', SEP]
    chip = f'<span class="chip" style="height: 18px; padding: 0 6px; background: var(--accent-soft); color: var(--accent-text)">{filt_count}</span>' if filt_count else ''
    if changes:  # compact: icon-only so Guardar/Descartar fit in the same 44px band
        items += [a('DataFilterCondition.dc.html', 'btn btn-icon', ic('filter', 16), '', ' aria-label="Filtrar (Ctrl+Mayús+L)" title="Filtrar (Ctrl+Mayús+L)"'),
                  a('DataFilterCondition.dc.html', 'btn btn-icon', ic('sort', 16), '', ' aria-label="Ordenar (Ctrl+Mayús+O)" title="Ordenar (Ctrl+Mayús+O)"'),
                  a('GridColumnFilter.dc.html', 'btn btn-icon', ic('search', 16), '', ' aria-label="Buscar en la página (Ctrl+F)" title="Buscar en la página (Ctrl+F)"')]
    else:
      items += [a('DataFilterCondition.dc.html', 'btn btn-ghost', ic('filter') + 'Filtrar' + chip, pr('filter'), ' title="Filtrar la tabla en el servidor (Ctrl+Mayús+L)"'),
              a('DataFilterCondition.dc.html', 'btn btn-ghost', ic('sort') + 'Ordenar', '', ' title="Ordenar (Ctrl+Mayús+O)"'),
              a('DataGrid.dc.html' if on == 'search' else 'GridColumnFilter.dc.html', 'btn btn-ghost', ic('search') + 'Buscar en la página', pr('search'), ap('search') + ' title="Buscar en las filas cargadas (Ctrl+F)"')]
    if not view and not changes:
        items.append(a('GridPendingChanges.dc.html', 'btn btn-ghost', ic('plus') + 'Fila', '', ' title="Añadir fila (Ctrl+Intro en la última fila)"'))
    items.append(FLEX)
    for k, icon, lbl, href in [('transpose', 'transpose', 'Transponer', 'GridTransposed.dc.html'), ('pin', 'pin', 'Fijar resultado', 'PinnedResult.dc.html'),
                               ('compare', 'compare', 'Comparar con…', 'CompareMenu.dc.html'), ('chart', 'chart', 'Graficar', 'Chart.dc.html')]:
        st = PRESSED if k == on else ''
        items.append(a('DataGrid.dc.html' if k == on else href, 'btn btn-icon', ic(icon, 16), st, f' aria-label="{lbl}" title="{lbl}"' + (ap(k) if k in ('transpose', 'pin') else '')))
    items.append(a('DataGrid.dc.html' if on == 'export' else 'ExportMenu.dc.html', 'btn btn-ghost', ic('export') + 'Exportar' + ic('down', 12), pr('export'),
                   f' aria-haspopup="menu" aria-expanded="{"true" if on == "export" else "false"}"'))
    items.append(a('DataGrid.dc.html' if on == 'more' else 'SyncMenu.dc.html', 'btn btn-icon', ic('more', 16), pr('more'),
                   f' aria-label="Más acciones: importar, generar, transferir, sincronizar" aria-haspopup="menu" aria-expanded="{"true" if on == "more" else "false"}" title="Más acciones"'))
    return toolbar(f'Acciones de {name}', items)


def pager(text='Filas 1–12 de 12', count=True, help='Doble clic, F2 o empieza a escribir para editar una celda', pages='1 / 1'):
    c = ' <a href="#" style="font-size: var(--fs-sm)">Contar total</a>' if count else ''
    h = f'\n        <span class="help">{help}</span>' if help else ''
    return ('<div style="height: 34px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">\n'
            f'        <span class="num" style="white-space: nowrap">{text}</span>{c}{h}\n        <span style="flex: 1"></span>\n'
            '        <label style="display: flex; align-items: center; gap: 6px; white-space: nowrap">Filas por página <span class="field" role="combobox" aria-expanded="false" style="height: 24px; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm)">1000' + ic('down', 11) + '</span></label>\n'
            f'        <span class="seg" aria-label="Paginación"><a href="#" aria-label="Primera página">|‹</a><a href="#" aria-label="Página anterior">‹</a><span class="on" aria-current="page">{pages}</span><a href="#" aria-label="Página siguiente">›</a><a href="#" aria-label="Última página">›|</a></span>\n      </div>')


def grid(label, cols='columns', rows='rows', extra=''):
    return (f'<div style="flex: 1; min-height: 0">\n        <dc-import name="Grid" theme="{{{{theme}}}}" columns="{{{{{cols}}}}}" rows="{{{{{rows}}}}}" {extra} '
            f'label="{label}" height="100%" hint-size="100%,100%"></dc-import>\n      </div>')


def mi(label, href='#', k='', cls='mi', icon=None, style='', sub=False):
    if sub:
        kk = f'<span class="k" style="display: flex">{ic("right", 13)}</span>'
    else:
        kk = f'<span class="k">{k}</span>' if k else ''
    i = ic(icon, 14, 'color: var(--text-dim); flex: none') if icon else '<span style="width: 14px; flex: none"></span>'
    st = f' style="{style}"' if style else ''
    hp = ' aria-haspopup="menu"' if sub else ''
    return f'<a href="{href}" class="{cls}" role="menuitem"{hp}{st}>{i}<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{label}</span>{kk}</a>'


MSEP = '<div class="msep" role="separator"></div>'


def mlbl(t, mono=False):
    if mono:
        return f'<div class="mono" style="padding: 6px 10px 2px; font-size: var(--fs-xs); color: var(--text-dim)">{t}</div>'
    return f'<div class="lbl" style="padding: 6px 10px 2px">{t}</div>'


def mhelp(t):
    return f'<div class="help" style="padding: 4px 10px 6px">{t}</div>'


def menu(items, style, label):
    return f'<div class="menu" role="menu" aria-label="{label}" style="{style}">\n    ' + '\n    '.join(items) + '\n  </div>'


def strip(inner, label):
    return (f'<div role="region" aria-label="{label}" style="height: 40px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 12px; '
            f'border-bottom: 1px solid var(--border); background: var(--surface); font-size: var(--fs-sm); white-space: nowrap">{inner}</div>')


def frame(title, tabs, tb, body, footer='', status='', explorer='tree="tables" selected="clientes"', overlay='', data=None,
          props_extra='', wtitle='clientes — Ventas — Squaero', js_extra=''):
    data = dict(data or {})
    data['tabs'] = tabs
    T = '{{theme}}'
    return f'''{title}
<div class="th th-{T}" data-os="{{{{os}}}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{T}" os="{{{{os}}}}" notif="1" window-title="{wtitle}" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{T}" active="explorer" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{T}" state="connected" {explorer} height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{T}" tabs="{{{{tabs}}}}" hint-size="100%,36px"></dc-import>
      {tb}
      {body}
      {footer}
    </main>
  </div>
  <dc-import name="StatusBar" theme="{T}" {status} hint-size="1280px,24px"></dc-import>
  {overlay}
</div>
---PROPS---
{{"theme":{{"editor":"enum","options":["b","a","c","rosa"],"default":"b"}},"os":{{"editor":"enum","options":["windows","macos","linux"],"default":"windows"}}{props_extra},"$preview":{{"width":1280,"height":800}}}}
---JS---
class Component extends DCLogic {{
  renderVals() {{
    return Object.assign({{ theme: this.props.theme ?? 'b', os: this.props.os ?? 'windows', yes: true, no: false{js_extra} }}, {json.dumps(data, ensure_ascii=False)});
  }}
}}
'''


def dlg(label_id, title, body, foot_left, actions, width=480, icon=''):
    return ('<div class="dlg-scrim">\n    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="' + label_id + f'" style="width: {width}px">\n'
            f'      <div class="dlg-h">{icon}<span id="{label_id}">{title}</span><span style="flex: 1"></span>' + actions[1] + '</div>\n'
            f'      <div class="dlg-b">{body}</div>\n'
            f'      <div class="dlg-f">{foot_left}<span style="flex: 1"></span><span class="dlg-actions">{actions[0]}</span></div>\n    </div>\n  </div>')


kw = lambda s: f'<span style="color: var(--syntax-keyword)">{s}</span>'
strg = lambda s: f'<span style="color: var(--syntax-string)">{s}</span>'
numc = lambda s: f'<span style="color: var(--syntax-number)">{s}</span>'

# ---------- fixtures (raw values: no thousand separators, booleans true/false) ----------
CLI_COLS = [{'name': 'id', 'type': 'integer', 'kind': 'num', 'w': '76px', 'key': True, 'sort': '↑'}, {'name': 'nombre', 'type': 'text', 'kind': 'text', 'w': '140px'},
            {'name': 'email', 'type': 'text', 'kind': 'text', 'w': '200px'}, {'name': 'ciudad', 'type': 'text', 'kind': 'text', 'w': '130px'},
            {'name': 'saldo', 'type': 'numeric(10,2)', 'kind': 'num', 'w': '112px'}, {'name': 'activo', 'type': 'boolean', 'kind': 'bool', 'w': '78px'}, {'name': 'alta', 'type': 'date', 'kind': 'date', 'w': '1fr'}]
CLI = [[1, 'María López', 'maria.lopez@correo.mx', 'Hermosillo', '1250.00', 'true', '2023-02-14'], [2, 'Juan Pérez', 'jperez@correo.mx', 'Nogales', '980.50', 'true', '2023-03-01'],
       [3, 'Ana Gómez', 'ana.gomez@correo.mx', 'Guaymas', None, 'false', '2023-05-22'], [4, 'Luis Ramírez', 'lramirez@correo.mx', 'Cd. Obregón', '4321.99', 'true', '2024-01-09'],
       [5, 'Sofía Torres', 'storres@correo.mx', 'Hermosillo', '12.00', 'true', '2024-04-18'], [6, 'Carlos Ruiz', 'cruiz@correo.mx', 'Navojoa', '777.77', 'false', '2024-06-30'],
       [7, 'Elena Díaz', 'ediaz@correo.mx', 'Caborca', '230.10', 'true', '2024-08-12'], [8, 'Miguel Ángel', '', 'Nogales', '5400.00', 'true', '2024-11-03'],
       [9, 'Paola Núñez', 'pnunez@correo.mx', 'Hermosillo', '88.25', 'true', '2025-01-27'], [10, 'Roberto Sil', 'rsil@correo.mx', 'Guaymas', '1590.40', 'false', '2025-03-15'],
       [11, 'Verónica Paz', 'vpaz@correo.mx', 'Agua Prieta', '640.00', 'true', '2025-05-02'], [12, 'Andrés Solís', 'asolis@correo.mx', 'Puerto Peñasco', '315.75', 'true', '2025-06-19']]
PED_COLS = [{'name': 'id', 'type': 'integer', 'kind': 'num', 'w': '76px', 'key': True, 'sort': '↑'}, {'name': 'cliente_id', 'type': 'integer', 'fk': 'clientes.id', 'kind': 'num', 'w': '180px'},
            {'name': 'fecha', 'type': 'date', 'kind': 'date', 'w': '120px'}, {'name': 'estado', 'type': 'text', 'kind': 'text', 'w': '120px'},
            {'name': 'total', 'type': 'numeric(10,2)', 'kind': 'num', 'w': '110px'}, {'name': 'notas', 'type': 'text', 'kind': 'text', 'w': '1fr'}]
PED = [[1, 4, '2024-02-10', 'entregado', '1250.00', None], [2, 1, '2024-03-02', 'entregado', '349.50', 'Envío express'], [3, 5, '2024-05-19', 'enviado', '89.90', None],
       [4, 8, '2024-07-07', 'entregado', '5400.00', None], [5, 2, '2024-09-21', 'pendiente', '980.50', 'Factura a nombre de empresa'], [6, 4, '2024-12-01', 'entregado', '3071.99', None],
       [7, 9, '2025-02-14', 'cancelado', '88.25', 'Sin existencias'], [8, 11, '2025-05-30', 'enviado', '640.00', '']]
TAB_Q = {'label': 'Consulta 1', 'kind': 'query', 'href': 'EditorResult.dc.html', 'dirty': True}
TABS_CLI = [TAB_Q, {'label': 'clientes', 'kind': 'table', 'active': True, 'href': 'DataGrid.dc.html'}]
TABS_PED = [TAB_Q, {'label': 'pedidos', 'kind': 'table', 'active': True, 'href': 'GridContextMenuFk.dc.html'}]
ST_CLI = 'conn="Ventas" db="main" info="clientes · 12 filas · 7 columnas · 20 ms"'
ST_PED = 'conn="Ventas" db="main" info="pedidos · 8 filas · 6 columnas · 13 ms"'
D_CLI = {'columns': CLI_COLS, 'rows': CLI}
D_PED = {'columns': PED_COLS, 'rows': PED}
CLI_TB = table_toolbar()
PED_TB = table_toolbar('pedidos')
EXP_PED = 'tree="tables" selected="pedidos"'
W_PED = 'pedidos — Ventas — Squaero'
P_PED = dict(text='Filas 1–8 de 8')

# Grid geometry in the 1280×800 frame (style B): main x=305, grid rows start y=160, 29px per row, gutter 48px.
GX, GY, RH = 353, 160, 29


def col_x(cols, j):
    return GX + sum(int(c['w'][:-2]) for c in cols[:j])


out = {}

# ---------------- ViewData
VIEW_COLS = [{'name': 'ciudad', 'type': 'text', 'kind': 'text', 'w': '200px', 'sort': '↑'}, {'name': 'pedidos', 'type': 'integer', 'kind': 'num', 'w': '110px'},
             {'name': 'importe', 'type': 'numeric', 'kind': 'num', 'w': '1fr'}]
VIEW = [['Agua Prieta', 1, '640.00'], ['Caborca', 0, None], ['Cd. Obregón', 2, '4321.99'], ['Guaymas', 0, None], ['Hermosillo', 2, '439.40'], ['Navojoa', 0, None],
        ['Nogales', 2, '6380.50'], ['Puerto Peñasco', 0, None]]
out['ViewData'] = frame('Datos de la vista', [TAB_Q, {'label': 'clientes', 'kind': 'table', 'href': 'DataGrid.dc.html'}, {'label': 'ventas_por_ciudad', 'kind': 'view', 'active': True, 'href': 'ViewData.dc.html'}],
                        table_toolbar('ventas_por_ciudad', view=True), grid('Filas de ventas_por_ciudad'),
                        pager('Filas 1–8 de 8', help='Vista de solo lectura: no tiene clave primaria'), 'conn="Ventas" db="main" info="ventas_por_ciudad · 8 filas · 3 columnas · 4 ms"',
                        'tree="expanded" selected="ventas_por_ciudad"', data={'columns': VIEW_COLS, 'rows': VIEW}, wtitle='ventas_por_ciudad — Ventas — Squaero')

# ---------------- GridColumnFilter = "Buscar en la página" (local)
cf_cols = [dict(c) for c in CLI_COLS]
cf_cols[3]['filter'] = 'Hermo'
cf_rows = [r for r in CLI if r[3] == 'Hermosillo']
cf_strip = strip(f'{ic("search", 15, "color: var(--accent-text)")}<span style="font-weight: 600">Buscar en la página</span>'
                 '<span class="num">3 de 12 filas cargadas coinciden</span>' + SEP +
                 f'<span style="display: flex; align-items: center; gap: 6px; color: var(--warn)">{ic("info", 14)}solo en las 12 filas cargadas</span><span style="color: var(--text-dim)">·</span>'
                 + a('DataFilterCondition.dc.html', 'btn btn-ghost', ic('filter', 14) + 'Filtrar en la tabla', 'height: 26px; color: var(--accent-text)', ' title="Convertir en un filtro WHERE sobre toda la tabla"')
                 + FLEX + a('DataGrid.dc.html', 'btn', 'Quitar búsqueda' + '<span class="kbd">Esc</span>', 'height: 26px'), 'Buscar en la página')
out['GridColumnFilter'] = frame('Buscar en la página', TABS_CLI, table_toolbar(on='search'), cf_strip + '\n      ' + grid('Filas de clientes', extra='filters="{{yes}}"'),
                                pager('3 de 12 filas cargadas', help='La búsqueda es local: no consulta la base'),
                                'conn="Ventas" db="main" info="clientes · 3 de 12 filas cargadas · búsqueda local"', data={'columns': cf_cols, 'rows': cf_rows})


# ---------------- Filter popover (server: WHERE / ORDER BY)
def cond_row(on, col, op, val, join=None):
    j = ('<span class="seg" role="radiogroup" aria-label="Unión" style="margin-left: 26px; align-self: flex-start"><a href="#" role="radio" aria-checked="true" class="on">y</a><a href="#" role="radio" aria-checked="false">o</a></span>' if join else '')
    chk = ' checked="checked"' if on else ''
    return (f'{j}<div style="display: flex; align-items: center; gap: 6px">'
            f'<input type="checkbox"{chk} aria-label="Usar la condición sobre {col}" style="accent-color: var(--accent); margin: 0 4px; width: 16px; height: 16px">'
            f'<select class="field" aria-label="Columna" style="width: 130px"><option>{col}</option><option>nombre</option><option>email</option></select>'
            f'<select class="field" aria-label="Operador" style="width: 120px"><option>{op}</option><option>≠</option><option>contiene</option><option>es nulo</option></select>'
            f'<input class="field mono" value="{val}" aria-label="Valor" style="flex: 1; min-width: 0; font-size: var(--fs-sm)">'
            f'<a href="#" class="btn btn-icon" aria-label="Quitar la condición">{ic("close", 14)}</a></div>')


def filter_pop(mode):
    head = ('<div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border)">'
            '<span style="font-weight: 600">Filtro y orden</span><span style="font-size: var(--fs-sm); color: var(--text-dim)">2 condiciones · 1 orden</span>' + FLEX +
            '<span class="seg" role="tablist" aria-label="Modo">'
            f'<a href="DataFilterCondition.dc.html" role="tab" aria-selected="{"true" if mode == "cond" else "false"}" class="{"on" if mode == "cond" else ""}">Condiciones</a>'
            f'<a href="DataFilterSql.dc.html" role="tab" aria-selected="{"true" if mode == "sql" else "false"}" class="{"on" if mode == "sql" else ""}">SQL</a></span>'
            f'<a href="DataGrid.dc.html" class="btn btn-icon" aria-label="Cerrar sin aplicar (Esc)">{ic("close", 14)}</a></div>')
    scope = (f'<div class="help" style="display: flex; align-items: center; gap: 6px">{ic("info", 13)}Se aplica en el servidor a toda la tabla (12 filas), no solo a la página cargada.</div>')
    if mode == 'cond':
        body = ('<div style="padding: 12px; display: flex; flex-direction: column; gap: 8px">'
                '<div class="lbl">Mostrar filas donde</div>'
                + cond_row(True, 'ciudad', '=', 'Hermosillo') + cond_row(True, 'saldo', '&gt;', '50', join=True) +
                f'<div><a href="#" class="btn btn-ghost" style="color: var(--accent-text)">{ic("plus", 14)}Condición</a></div>'
                '<div class="lbl" style="margin-top: 8px">Ordenar por</div>'
                '<div style="display: flex; align-items: center; gap: 6px"><span style="width: 26px"></span>'
                '<select class="field" aria-label="Columna de orden" style="width: 130px"><option>saldo</option><option>nombre</option></select>'
                '<span class="seg" role="radiogroup" aria-label="Sentido"><a href="#" role="radio" aria-checked="false">↑ Ascendente</a><a href="#" role="radio" aria-checked="true" class="on">↓ Descendente</a></span>' + FLEX +
                f'<a href="#" class="btn btn-icon" aria-label="Quitar la ordenación">{ic("close", 14)}</a></div>'
                f'<div><a href="#" class="btn btn-ghost" style="color: var(--accent-text)">{ic("plus", 14)}Orden</a></div>' + scope + '</div>')
        apply_k = 'Intro'
    else:
        body = ('<div style="padding: 12px; display: flex; flex-direction: column; gap: 8px">'
                '<label class="mono" for="where" style="font-size: var(--fs-sm); font-weight: 600; color: var(--text-dim)">WHERE</label>'
                '<textarea id="where" class="field is-focus mono" style="height: 64px; padding: 8px 10px; resize: none; font-size: var(--fs-sm); line-height: 1.6">"ciudad" = \'Hermosillo\'\nAND "saldo" &gt; 50</textarea>'
                '<label class="mono" for="orderby" style="font-size: var(--fs-sm); font-weight: 600; color: var(--text-dim)">ORDER BY</label>'
                '<input id="orderby" class="field mono" value="&quot;saldo&quot; DESC" style="font-size: var(--fs-sm)">'
                '<div class="help">Cualquier expresión válida para SQLite. Intro añade una línea; Ctrl+Intro aplica. Mientras haya SQL escrito aquí, la vista de condiciones queda en solo lectura.</div>'
                '<div class="lbl" style="margin-top: 4px">Consulta que se enviará</div>'
                '<div class="mono" style="padding: 10px; border-radius: var(--r-sm); background: var(--surface); border: 1px solid var(--border); font-size: var(--fs-sm); line-height: 1.6">'
                f'<div>{kw("SELECT")} * {kw("FROM")} "main"."clientes"</div>'
                f'<div>{kw("WHERE")} "ciudad" = {strg("&#39;Hermosillo&#39;")} {kw("AND")} "saldo" &gt; {numc("50")}</div>'
                f'<div>{kw("ORDER BY")} "saldo" {kw("DESC")} {kw("LIMIT")} {numc("1000")};</div></div>' + scope + '</div>')
        apply_k = 'Ctrl+Intro'
    sqlbtn = (a('EditorResult.dc.html', 'btn btn-ghost', ic('query', 14) + 'Abrir en consulta') if mode == 'sql'
              else a('DataFilterSql.dc.html', 'btn btn-ghost', ic('query', 14) + 'Ver SQL'))
    foot = ('<div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border); background: var(--surface)">'
            + sqlbtn + a('DataGrid.dc.html', 'btn btn-ghost', 'Limpiar') + FLEX +
            '<span class="dlg-actions">' + a('DataGrid.dc.html', 'btn btn-primary', 'Aplicar' + KBD_ON.format(apply_k)) + a('DataGrid.dc.html', 'btn', 'Cancelar') + '</span></div>')
    return (f'<div class="menu" role="dialog" aria-label="Filtro y orden de clientes" style="left: 400px; top: 116px; width: 600px; padding: 0">\n    '
            + head + '\n    ' + body + '\n    ' + foot + '\n  </div>')


fb = table_toolbar(on='filter', filt_count=2)
out['DataFilterCondition'] = frame('Filtro y orden', TABS_CLI, fb, grid('Filas de clientes'), pager(), ST_CLI, overlay=filter_pop('cond'), data=D_CLI)
out['DataFilterSql'] = frame('Filtro en SQL', TABS_CLI, fb, grid('Filas de clientes'), pager(), ST_CLI, overlay=filter_pop('sql'), data=D_CLI)


# ---------------- Cell context menus (ordered by frequency, submenus, visible shortcuts)
def copy_sub(left, top):
    return menu([mi('Con encabezados', k='Ctrl+Mayús+C'), mi('TSV (para hojas de cálculo)'), mi('CSV'), mi('Markdown'), MSEP,
                 mi('Sentencia INSERT', cls='mi on'), mi('Sentencia UPDATE'), mi('JSON')], f'left: {left}px; top: {top}px; width: 236px', 'Copiar como')


def ctx_items(col, val, fk=None, open_sub=None):
    items = [mi('Copiar', k='Ctrl+C', icon='copy'),
             mi('Copiar como', sub=True, cls='mi on' if open_sub == 'copy' else 'mi'),
             mi('Pegar', k='Ctrl+V', icon='clipboard'),
             mi('Poner NULL', k='Ctrl+Mayús+N'),
             mi('Ver detalle de fila', 'RowDetail.dc.html', 'Espacio', icon='view'), MSEP]
    if fk:
        items += [mlbl(f'{col} → {fk}', mono=True),
                  mi(f'Ir a la fila referenciada', 'RelatedData.dc.html', 'Ctrl+B', icon='right', cls='mi on' if open_sub == 'fk' else 'mi'),
                  mi('Elegir otro valor…', 'FkBrowser.dc.html', 'Alt+Abajo', icon='search'), MSEP]
    items += [mi('Filtrar por este valor', sub=True, icon='filter')]
    if not fk:
        items += [mi(f'Datos relacionados · nadie referencia {col}', cls='mi dis', icon='compare')]
    items += [MSEP, mi('Duplicar fila', 'GridPendingChanges.dc.html', 'Ctrl+D'),
              mi('Revertir celda', cls='mi dis'),
              mi('Eliminar fila', 'GridPendingChanges.dc.html', 'Supr', cls='mi danger', icon='trash'), MSEP,
              mi('Exportar', sub=True, icon='export')]
    return items


ctx_l, ctx_t = col_x(CLI_COLS, 3) - 8, GY + RH + 18
out['GridContextMenu'] = frame('Menú de celda', TABS_CLI, CLI_TB, grid('Filas de clientes', extra='selected="{{sel}}"'), pager(),
                               'conn="Ventas" db="main" info="clientes · 12 filas · 7 columnas · celda ciudad, fila 2"',
                               overlay=menu(ctx_items('ciudad', 'Nogales', open_sub='copy'), f'left: {ctx_l}px; top: {ctx_t}px; width: 270px', 'Celda ciudad de la fila 2')
                               + '\n  ' + copy_sub(ctx_l + 272, ctx_t + 32), data=dict(D_CLI, sel={'r': 1, 'c': 3}))

fk_l, fk_t = col_x(PED_COLS, 1) + 120, GY + 18
out['GridContextMenuFk'] = frame('Menú de celda con clave foránea', TABS_PED, PED_TB, grid('Filas de pedidos', extra='selected="{{sel}}"'), pager(**P_PED),
                                 'conn="Ventas" db="main" info="pedidos · 8 filas · 6 columnas · celda cliente_id, fila 1"', EXP_PED,
                                 overlay=menu(ctx_items('cliente_id', '4', fk='clientes.id', open_sub='fk'), f'left: {fk_l}px; top: {fk_t}px; width: 270px', 'Celda cliente_id de la fila 1'),
                                 data=dict(D_PED, sel={'r': 0, 'c': 1}), wtitle=W_PED)

# ---------------- GridEditMode: in-place editing, input inside the focused cell
ex, ey = col_x(CLI_COLS, 4), GY + 2 * RH
edit_ov = (f'<input class="field mono" value="150" aria-label="Editar saldo, fila 3 (valor actual NULL)" style="position: absolute; left: {ex}px; top: {ey}px; width: 112px; height: 28px; '
           'box-sizing: border-box; padding: 0 8px; border: 2px solid var(--accent); border-radius: 0; box-shadow: var(--shadow-sm); text-align: right; font-size: var(--fs-sm); z-index: 4">'
           f'<div role="tooltip" style="position: absolute; left: {ex - 160}px; top: {ey + 32}px; width: 272px; padding: 8px 10px; background: var(--overlay); border: 1px solid var(--border); border-radius: var(--r-md); '
           'box-shadow: var(--shadow-lg); font-size: var(--fs-sm); color: var(--text-dim); z-index: 4; display: flex; flex-direction: column; gap: 4px">'
           '<span>Antes: <span style="font-style: italic">NULL</span> · numeric(10,2)</span>'
           '<span><span class="kbd">Intro</span> confirma y baja · <span class="kbd">Tab</span> siguiente</span>'
           '<span><span class="kbd">Esc</span> revierte la celda · <span class="kbd">Ctrl+Mayús+N</span> NULL</span></div>')
out['GridEditMode'] = frame('Edición en la celda', TABS_CLI, CLI_TB, grid('Filas de clientes', extra='selected="{{sel}}"'),
                            pager(help='Editando saldo de la fila 3 · los cambios se guardan con Guardar (Ctrl+S)'),
                            'conn="Ventas" db="main" info="clientes · 12 filas · 7 columnas · celda saldo, fila 3"', overlay=edit_ov, data=dict(D_CLI, sel={'r': 2, 'c': 4}))

# ---------------- GridPendingChanges
pend_rows = [list(r) for r in CLI] + [['(auto)', 'Diana Flores', 'dflores@correo.mx', 'Hermosillo', '0.00', 'true', '2025-10-18']]
pend_rows[1][4] = '1020.50'


def diffline(sym, color, sql, label):
    return (f'<div style="display: flex; gap: 10px"><span aria-label="{label}" style="width: 14px; color: {color}; font-weight: 700">{sym}</span><span>{sql}</span></div>')


pend_bar = ('<section aria-label="Cambios sin guardar" style="flex: none; border-top: 1px solid var(--border); background: var(--surface)">\n'
            '        <div style="height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px">'
            '<span style="font-weight: 600">3 cambios sin guardar</span>'
            '<span class="chip" style="background: var(--warn-soft); color: var(--warn)">~ 1 modificada</span>'
            '<span class="chip" style="background: var(--ok-soft); color: var(--ok)">+ 1 nueva</span>'
            '<span class="chip" style="background: var(--danger-soft); color: var(--danger)">− 1 eliminada</span>' + FLEX +
            '<label class="help" style="display: flex; align-items: center; gap: 6px"><input type="checkbox" checked="checked" style="accent-color: var(--accent); margin: 0">Mostrar valores anteriores</label>'
            f'<a href="#" class="btn btn-ghost" aria-expanded="true">Ocultar SQL{ic("down", 12, "transform: rotate(180deg)")}</a></div>\n'
            '        <div class="mono" style="margin: 0 12px 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--content); font-size: var(--fs-sm); line-height: 1.7">'
            + diffline('~', 'var(--warn)', f'{kw("UPDATE")} "clientes" {kw("SET")} "saldo" = {numc("1020.50")} {kw("WHERE")} "id" = {numc("2")};', 'Modificada')
            + diffline('−', 'var(--danger)', f'{kw("DELETE FROM")} "clientes" {kw("WHERE")} "id" = {numc("4")};', 'Eliminada')
            + diffline('+', 'var(--ok)', f'{kw("INSERT INTO")} "clientes" ("nombre", "email", "ciudad", "saldo", "activo", "alta") {kw("VALUES")} ({strg("&#39;Diana Flores&#39;")}, {strg("&#39;dflores@correo.mx&#39;")}, …);', 'Nueva')
            + '<div class="help" style="font-family: var(--font-ui); margin-top: 4px">Guardar ejecuta las 3 sentencias en una sola transacción: si una falla, no se guarda ninguna. Esc no descarta nada.</div></div>\n      </section>')
WIDE = [dict(c) for c in CLI_COLS]
for c, w in zip(WIDE, ['64px', '130px', '180px', '170px', '170px', '72px', '1fr']):
    c['w'] = w
out['GridPendingChanges'] = frame('Cambios pendientes', TABS_CLI, table_toolbar(changes=3),
                                  grid('Filas de clientes', extra='edited="{{edited}}" row-state="{{rowState}}" show-old="{{yes}}"'),
                                  pend_bar + '\n      ' + pager('Filas 1–13 de 13', count=False, help='La paginación se reanuda al guardar o descartar'),
                                  'conn="Ventas" db="main" tx="3 cambios sin guardar" info="clientes · 13 filas · 7 columnas"',
                                  data={'columns': WIDE, 'rows': pend_rows, 'edited': [{'r': 1, 'c': 4, 'old': '980.50'}], 'rowState': {'3': 'removed', '12': 'added'}})

# ---------------- GridRowActionBar
rab = ('<div role="toolbar" aria-label="Acciones sobre las filas marcadas" style="position: absolute; left: 330px; bottom: 72px; height: 44px; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 14px; '
       'background: var(--overlay); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-lg); z-index: 5; white-space: nowrap">'
       '<span style="font-weight: 600; margin-right: 6px">3 filas marcadas</span>' + SEP +
       a('#', 'btn btn-ghost', ic('copy', 14) + 'Copiar<span class="kbd">Ctrl+C</span>') + a('#', 'btn btn-ghost', 'Copiar como' + ic('down', 12), extra=' aria-haspopup="menu"') +
       a('GridPendingChanges.dc.html', 'btn btn-ghost', 'Duplicar<span class="kbd">Ctrl+D</span>') + a('ExportMenu.dc.html', 'btn btn-ghost', ic('export', 14) + 'Exportar') + SEP +
       a('ConfirmDeleteRows.dc.html', 'btn btn-ghost', ic('trash', 14) + 'Eliminar 3 filas…<span class="kbd">Supr</span>', 'color: var(--danger)') + SEP +
       a('DataGrid.dc.html', 'btn btn-icon', ic('close', 15), extra=' aria-label="Desmarcar (Esc)" title="Desmarcar (Esc)"') + '</div>')
RAB_ST = 'conn="Ventas" db="main" info="3 filas marcadas · saldo: Suma 5314.49 · Media 1771.50"'
out['GridRowActionBar'] = frame('Filas marcadas', TABS_CLI, CLI_TB, grid('Filas de clientes', extra='marked="{{marked}}"'), pager(), RAB_ST, overlay=rab,
                                data=dict(D_CLI, marked=[1, 3, 4]))

# ---------------- ConfirmDeleteRows (NEW)
cd_body = ('<div>Se borrarán de forma permanente <b>3 filas</b> de <b class="mono">clientes</b> en <b>Ventas · main</b>:</div>'
           '<div style="border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--content)">'
           + ''.join(f'<div style="display: flex; gap: 12px; padding: 6px 10px; {"border-top: 1px solid var(--border);" if i else ""} font-size: var(--fs-sm)"><span class="mono num" style="width: 40px; text-align: right; color: var(--text-dim)">id {r[0]}</span><span>{r[1]}</span><span style="color: var(--text-dim)">{r[3]}</span></div>'
                     for i, r in enumerate([CLI[1], CLI[3], CLI[4]])) + '</div>'
           f'<div style="display: flex; gap: 8px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--warn-soft); color: var(--text); font-size: var(--fs-sm)">{ic("warning", 15, "color: var(--warn); flex: none; margin-top: 1px")}'
           '<span>4 pedidos apuntan a estas filas (<span class="mono">pedidos.cliente_id</span>). La clave foránea no tiene ON DELETE CASCADE: si la base lo impide, no se borra ninguna fila.</span></div>'
           f'<pre class="mono" style="margin: 0; padding: 8px 10px; border-radius: var(--r-sm); background: var(--surface); border: 1px solid var(--border); font-size: var(--fs-sm)">{kw("DELETE FROM")} "clientes" {kw("WHERE")} "id" {kw("IN")} ({numc("2")}, {numc("4")}, {numc("5")});</pre>'
           '<div class="help">Se ejecuta en una transacción y no se puede deshacer desde Squaero.</div>')
cd_dlg = dlg('del-t', 'Eliminar 3 filas de clientes', cd_body,
             '<span class="help"><span class="kbd">Intro</span> y <span class="kbd">Esc</span> cancelan</span>',
             (a('GridRowActionBar.dc.html', 'btn btn-danger', ic('trash', 14) + 'Eliminar 3 filas') + a('GridRowActionBar.dc.html', 'btn focus', 'Cancelar', extra=' aria-describedby="del-t"'),
              a('GridRowActionBar.dc.html', 'btn btn-icon', ic('close', 16), extra=' aria-label="Cancelar (Esc)"')), 520,
             f'<span style="display: flex; color: var(--danger)">{ic("trash", 18)}</span>')
out['ConfirmDeleteRows'] = frame('Eliminar filas', TABS_CLI, CLI_TB, grid('Filas de clientes', extra='marked="{{marked}}"'), pager(), RAB_ST,
                                 overlay=cd_dlg.replace('role="dialog"', 'role="alertdialog"'), data=dict(D_CLI, marked=[1, 3, 4]))

# ---------------- RowDetail (read view = plain selectable text, Editar primary)
fields = [('id', 'integer · clave primaria', '4', True), ('nombre', 'text', 'Luis Ramírez', False), ('email', 'text', 'lramirez@correo.mx', False), ('ciudad', 'text', 'Cd. Obregón', False),
          ('saldo', 'numeric(10,2)', '4321.99', True), ('activo', 'boolean', 'true', True), ('alta', 'date', '2024-01-09', True)]
fhtml = ''.join(
    f'<div style="display: grid; grid-template-columns: 112px 1fr; gap: 2px 10px; padding: 7px 0; border-bottom: 1px solid var(--border)">'
    f'<span style="font-weight: 600; font-size: var(--fs-sm)">{n}</span>'
    f'<span class="{"mono num" if m else ""}" style="font-size: {"var(--fs-sm)" if m else "var(--fs-md)"}; user-select: text; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{v}</span>'
    f'<span style="font-size: var(--fs-xs); color: var(--text-dim)">{t}</span></div>' for n, t, v, m in fields)
aside = ('<aside aria-label="Detalle de la fila 4" style="width: 320px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--content)">'
         '<div style="height: 44px; flex: none; display: flex; align-items: center; gap: 4px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--border); white-space: nowrap">'
         '<span style="font-weight: 600">Fila 4</span><span style="font-size: var(--fs-sm); color: var(--text-dim)">de 12</span>' + FLEX +
         a('#', 'btn btn-icon', ic('left', 15), extra=' aria-label="Fila anterior (Alt+Arriba)" title="Fila anterior (Alt+Arriba)"') + a('#', 'btn btn-icon', ic('right', 15), extra=' aria-label="Fila siguiente (Alt+Abajo)" title="Fila siguiente (Alt+Abajo)"') +
         a('DataGrid.dc.html', 'btn btn-icon', ic('close', 15), extra=' aria-label="Cerrar detalle (Esc)"') + '</div>'
         f'<div style="flex: 1; min-height: 0; overflow: hidden; padding: 4px 14px">{fhtml}'
         '<div class="lbl" style="margin-top: 14px">Referenciada por</div>'
         f'<a href="RelatedData.dc.html" style="display: flex; align-items: center; gap: 8px; height: 28px; text-decoration: none">{ic("table", 14, "color: var(--obj-table)")}<span class="mono" style="font-size: var(--fs-sm)">pedidos.cliente_id</span><span style="flex: 1"></span><span class="chip" style="background: var(--accent-soft); color: var(--accent-text)">2 pedidos</span></a></div>'
         '<div style="height: 52px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-top: 1px solid var(--border)">'
         + a('GridEditMode.dc.html', 'btn btn-primary', ic('edit', 14) + 'Editar' + KBD_ON.format('F2')) + a('#', 'btn btn-ghost', ic('copy', 14) + 'Copiar fila')
         + FLEX + a('GridPendingChanges.dc.html', 'btn btn-icon', ic('trash', 15), 'color: var(--danger)', ' aria-label="Eliminar fila (Supr)" title="Eliminar fila (Supr)"') + '</div></aside>')
rd_body = ('<div style="flex: 1; min-height: 0; display: flex">\n        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column">\n        '
           + grid('Filas de clientes', extra='selected="{{sel}}"') + '\n        </div>\n        ' + aside + '\n      </div>')
out['RowDetail'] = frame('Detalle de fila', TABS_CLI, CLI_TB, rd_body, pager(), 'conn="Ventas" db="main" info="clientes · 12 filas · 7 columnas · fila 4"', data=dict(D_CLI, sel={'r': 3, 'c': 1}))

# ---------------- FkBrowser (row selection, Intro / double click, [Seleccionar] [Cancelar])
fk_cols = [{'name': 'id', 'type': 'integer', 'kind': 'num', 'w': '64px', 'key': True}, {'name': 'nombre', 'type': 'text', 'kind': 'text', 'w': '160px'},
           {'name': 'email', 'type': 'text', 'kind': 'text', 'w': '210px'}, {'name': 'ciudad', 'type': 'text', 'kind': 'text', 'w': '1fr'}]
fk_body = ('<div class="help" style="font-size: var(--fs-sm)">Se guardará el <span class="mono">id</span> de la fila elegida en <span class="mono">pedidos.cliente_id</span> (fila 1). Valor actual: <b class="mono" style="color: var(--text)">4</b>.</div>\n'
           f'        <label style="position: relative; display: block"><span style="position: absolute; left: 10px; top: 7px; color: var(--text-dim)">{ic("search", 14)}</span>'
           '<input class="field" aria-label="Buscar en cualquier columna" placeholder="Buscar en cualquier columna" style="width: 100%; box-sizing: border-box; padding-left: 32px"></label>\n'
           '        <div style="height: 300px; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; display: flex; flex-direction: column">\n        '
           + grid('Clientes: elige una fila', 'fkColumns', 'fkRows', 'marked="{{fkMarked}}" selected="{{fkSel}}" density="compacta"') + '\n        </div>')
fk_dlg = dlg('fk-t', 'Elegir cliente', fk_body,
             '<span class="help">12 filas · <span class="kbd">Intro</span> o doble clic selecciona</span>',
             (a('GridPendingChanges.dc.html', 'btn btn-primary', 'Seleccionar' + KBD_ON.format('Intro')) + a('GridContextMenuFk.dc.html', 'btn', 'Cancelar'),
              a('GridContextMenuFk.dc.html', 'btn btn-icon', ic('close', 16), extra=' aria-label="Cancelar (Esc)"')), 680,
             ic('table', 16, 'color: var(--obj-table)'))
out['FkBrowser'] = frame('Elegir fila referenciada', TABS_PED, PED_TB, grid('Filas de pedidos', extra='selected="{{sel}}"'),
                         pager(**P_PED), 'conn="Ventas" db="main" info="pedidos · 8 filas · 6 columnas · celda cliente_id, fila 1"', EXP_PED,
                         overlay=fk_dlg, data=dict(D_PED, sel={'r': 0, 'c': 1}, fkColumns=fk_cols, fkRows=[r[:4] for r in CLI], fkMarked=[3], fkSel={'r': 3, 'c': 0}), wtitle=W_PED)

# ---------------- RelatedData
rel_side = [('clientes', 'referencia', '1', True), ('detalle_pedido', '', '3', False)]
side_html = ''.join(
    f'<a href="#" aria-current="{"true" if on else "false"}" style="display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-radius: var(--r-sm); text-decoration: none; '
    f'color: var(--text); background: {"var(--sel)" if on else "transparent"}; font-weight: {600 if on else 400}">'
    f'{ic("table", 14, "color: var(--obj-table)")}<span style="flex: 1">{n}</span>'
    + (f'<span style="font-size: var(--fs-xs); color: var(--text-dim)">{tag}</span>' if tag else '') +
    f'<span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">{c}</span></a>' for n, tag, c, on in rel_side)
rel_cols = [{'name': 'id', 'type': 'integer', 'kind': 'num', 'w': '56px', 'key': True}, {'name': 'nombre', 'type': 'text', 'kind': 'text', 'w': '100px'},
            {'name': 'email', 'type': 'text', 'kind': 'text', 'w': '135px'}, {'name': 'ciudad', 'type': 'text', 'kind': 'text', 'w': '90px'},
            {'name': 'saldo', 'type': 'numeric(10,2)', 'kind': 'num', 'w': '96px'}, {'name': 'alta', 'type': 'date', 'kind': 'date', 'w': '1fr'}]
rel_rows = [[4, 'Luis Ramírez', 'lramirez@correo.mx', 'Cd. Obregón', '4321.99', '2024-01-09']]
rel_dlg = ('<div class="dlg-scrim">\n    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="rel-t" style="width: 880px; height: 520px">\n'
           f'      <div class="dlg-h"><span id="rel-t">Datos relacionados</span><span class="mono" style="font-size: var(--fs-md); font-weight: 400; color: var(--text-dim)">pedidos.cliente_id = 4</span><span style="flex: 1"></span>'
           + a('GridContextMenuFk.dc.html', 'btn btn-icon', ic('close', 16), extra=' aria-label="Cerrar (Esc)"') + '</div>\n'
           '      <div style="flex: 1; min-height: 0; display: flex; border-top: 1px solid var(--border)">\n'
           '        <nav aria-label="Tablas relacionadas" style="width: 210px; flex: none; padding: 10px 8px; border-right: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 2px">'
           '<div class="lbl" style="padding: 0 8px 6px">Relacionadas · 2 con datos</div>' + side_html +
           '<div class="help" style="padding: 10px 8px 0">«referencia» es la fila a la que apunta la clave; el resto son filas que apuntan a ella.</div></nav>\n'
           '        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px">'
           '<div style="display: flex; align-items: center; gap: 8px"><span style="font-weight: 600">clientes</span><span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">1 fila</span></div>'
           '<div style="flex: 1; min-height: 0; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; display: flex; flex-direction: column">'
           + grid('Filas relacionadas en clientes', 'relColumns', 'relRows') + '</div>'
           '<div class="mono" style="padding: 8px 10px; border-radius: var(--r-sm); background: var(--surface); border: 1px solid var(--border); font-size: var(--fs-sm)">'
           f'{kw("SELECT")} * {kw("FROM")} "main"."clientes" {kw("WHERE")} "id" = {numc("4")} {kw("LIMIT")} {numc("200")};</div></div>\n      </div>\n'
           '      <div class="dlg-f"><span class="help">Ctrl+B o Ctrl+clic en una celda con flecha abre esta vista</span><span style="flex: 1"></span><span class="dlg-actions">'
           + a('DataGrid.dc.html', 'btn btn-primary', 'Abrir clientes filtrada') + a('GridContextMenuFk.dc.html', 'btn', 'Cerrar') + '</span></div>\n    </div>\n  </div>')
out['RelatedData'] = frame('Datos relacionados', TABS_PED, PED_TB, grid('Filas de pedidos', extra='selected="{{sel}}"'), pager(**P_PED), ST_PED, EXP_PED,
                           overlay=rel_dlg, data=dict(D_PED, sel={'r': 0, 'c': 1}, relColumns=rel_cols, relRows=rel_rows), wtitle=W_PED)

# ---------------- GridTransposed
tr_cols = [{'name': 'columna', 'type': '', 'kind': 'text', 'w': '110px'}, {'name': 'tipo', 'type': '', 'kind': 'text', 'w': '120px'}] + \
          [{'name': f'fila {i}', 'type': '', 'kind': 'text', 'w': '150px' if i < 4 else '1fr'} for i in range(1, 5)]
tr_rows = [[c['name'], c['type']] + [CLI[i][j] if CLI[i][j] is None else str(CLI[i][j]) for i in range(4)] for j, c in enumerate(CLI_COLS)]
tr_strip = strip(f'{ic("transpose", 15, "color: var(--accent-text)")}<span style="font-weight: 600">Vista transpuesta</span>'
                 '<span style="color: var(--text-dim)">Cada columna es una fila; se muestran las filas 1–4 lado a lado.</span>' + FLEX +
                 a('DataGrid.dc.html', 'btn', 'Volver a la vista normal', 'height: 26px'), 'Vista transpuesta')
out['GridTransposed'] = frame('Vista transpuesta', TABS_CLI, table_toolbar(on='transpose'), tr_strip + '\n      ' + grid('clientes transpuesta', extra='show-types="{{no}}"'),
                              pager('Filas 1–4 de 12 (como columnas)', count=False, help='Marca filas en la vista normal para transponer otras'),
                              'conn="Ventas" db="main" info="clientes · 7 columnas × 4 filas · transpuesta"', data={'columns': tr_cols, 'rows': tr_rows})


# ---------------- Pinned results
def pin_tabs(active):
    def tab(lbl, cnt, on, href):
        return (f'<a href="{href}" role="tab" aria-selected="{"true" if on else "false"}" style="height: 28px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: var(--r-sm); text-decoration: none; '
                f'background: {"var(--content)" if on else "transparent"}; box-shadow: {"var(--shadow-sm)" if on else "none"}; color: {"var(--text)" if on else "var(--text-dim)"}; font-weight: {600 if on else 400}">'
                + (ic('pin', 13) if lbl != 'Actual' else '') + f'{lbl}<span class="num" style="color: var(--text-dim); font-weight: 400">{cnt} filas</span></a>')
    return ('<span role="tablist" aria-label="Resultados fijados" style="display: flex; align-items: center; gap: 2px">' + tab('Actual', '12', active == 'cur', 'DataGrid.dc.html')
            + tab('Fijado 14:17:46', '12', active == 'pin', 'PinnedResult.dc.html')
            + a('DataGrid.dc.html', 'btn btn-icon', ic('close', 13), 'width: 24px; height: 24px', ' aria-label="Quitar el resultado fijado 14:17:46" title="Quitar"') + '</span>')


pin_strip = strip(pin_tabs('pin') + SEP + '<span style="color: var(--text-dim)">Filas 1–12 tal como estaban al fijarlas; no se vuelve a ejecutar.</span>' + FLEX
                  + a('ResultCompare.dc.html', 'btn', ic('compare', 14) + 'Comparar con el actual', 'height: 26px'), 'Resultado fijado')
out['PinnedResult'] = frame('Resultado fijado', TABS_CLI, table_toolbar(on='pin'), pin_strip + '\n      ' + grid('Filas fijadas de clientes'), pager(help='Resultado fijado: solo lectura'),
                            'conn="Ventas" db="main" info="Fijado 14:17:46 · 12 filas · 7 columnas"', data=D_CLI)

# ---------------- CompareMenu (drop-down of the Comparar icon)
cmp_menu = menu([mlbl('Comparar el resultado actual con'),
                 mi('Fijado 14:17:46 · 12 filas', 'ResultCompare.dc.html', icon='pin', cls='mi on'),
                 mi('Fijado 13:52:03 · 11 filas', 'ResultCompare.dc.html', icon='pin'), MSEP,
                 mi('Fijar el resultado actual', 'PinnedResult.dc.html', 'Ctrl+Mayús+P', icon='pin'),
                 mhelp('Solo se compara con resultados fijados. Fija uno antes de volver a leer los datos.')],
                'left: 830px; top: 116px; width: 300px', 'Comparar con')
out['CompareMenu'] = frame('Comparar con…', TABS_CLI, table_toolbar(on='compare'),
                           strip(pin_tabs('cur') + SEP + '<span style="color: var(--text-dim)">2 resultados fijados</span>', 'Resultados fijados') + '\n      ' + grid('Filas de clientes'),
                           pager(), ST_CLI, overlay=cmp_menu, data=D_CLI)

# ---------------- SyncMenu (the Más ⋯ menu: only rare actions)
more = menu([mi('Importar…', 'ImportWizard.dc.html', icon='import'),
             mi('Generar datos…', 'DataGenerator.dc.html', icon='builder'),
             mi('Transferir…', 'TransferWizard.dc.html', icon='transfer'), MSEP,
             mlbl('Con otra conexión'),
             mi('Sincronizar estructura…', 'SchemaSync.dc.html', icon='sync', cls='mi on'),
             mi('Sincronizar datos…', 'DataDiff.dc.html', icon='sync')],
            'right: 10px; top: 116px; width: 250px', 'Más acciones')
out['SyncMenu'] = frame('Más acciones', TABS_CLI, table_toolbar(on='more'), grid('Filas de clientes'), pager(), ST_CLI, overlay=more, data=D_CLI)

# ---------------- ExportMenu
fmts = [('CSV', '.csv'), ('JSON', '.json'), ('Excel', '.xlsx'), ('SQL (INSERT)', '.sql'), ('Markdown', '.md'), ('XML', '.xml'), ('HTML', '.html')]


def radio(label, detail, on):
    return (f'<label style="display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px; border-radius: var(--r-sm); {"background: var(--accent-soft);" if on else ""}">'
            f'<input type="radio" name="scope"{" checked=\"checked\"" if on else ""} style="accent-color: var(--accent); margin: 0">'
            f'<span style="flex: 1; white-space: nowrap">{label}</span><span class="num" style="font-size: var(--fs-xs); color: var(--text-dim)">{detail}</span></label>')


exp = menu(['<div role="radiogroup" aria-label="Qué exportar" style="display: flex; flex-direction: column; gap: 2px; padding-bottom: 4px"><div class="lbl" style="padding: 6px 10px 2px">Qué exportar</div>'
            + radio('Toda la tabla', '12 filas', True) + radio('Página cargada', '12 filas', False) + radio('Marcadas', '3 filas', False) + '</div>', MSEP,
            mlbl('Formato')] + [mi(f, 'ExportProgress.dc.html', e, icon='export' if i == 0 else None, cls='mi on' if i == 0 else 'mi') for i, (f, e) in enumerate(fmts)] +
           [MSEP, mi('Opciones…', '#', 'separador, NULL, codificación'),
            mhelp('Se pide dónde guardar; el progreso aparece sobre la paginación con Cancelar.')],
           'right: 50px; top: 116px; width: 290px', 'Exportar')
out['ExportMenu'] = frame('Exportar', TABS_CLI, table_toolbar(on='export'), grid('Filas de clientes', extra='marked="{{marked}}"'), pager(), ST_CLI, overlay=exp,
                          data=dict(D_CLI, marked=[1, 3, 4]))

# ---------------- ExportProgress (NEW): determinate progress toast above the pagination
prog = ('<div class="toast" role="status" aria-live="polite" style="bottom: 64px; width: 360px; flex-direction: column; gap: 8px">'
        f'<div style="display: flex; align-items: center; gap: 10px">{ic("export", 16, "color: var(--accent-text); flex: none")}'
        '<div style="flex: 1; min-width: 0"><div style="font-weight: 600; font-size: var(--fs-md)">Exportando clientes a CSV</div>'
        '<div class="mono" style="color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">C:\\Users\\ana\\Documents\\clientes.csv</div></div>'
        + a('ExportMenu.dc.html', 'btn', 'Cancelar', 'height: 26px') + '</div>'
        '<div role="progressbar" aria-label="Progreso de la exportación" aria-valuemin="0" aria-valuemax="12" aria-valuenow="7" style="height: 6px; border-radius: 3px; background: var(--hover); overflow: hidden">'
        '<div style="width: 58%; height: 100%; background: var(--accent)"></div></div>'
        '<div class="num" style="display: flex; color: var(--text-dim)"><span>7 de 12 filas · 58 %</span><span style="flex: 1"></span><span>toda la tabla · quedan 2 s</span></div></div>')
out['ExportProgress'] = frame('Exportando', TABS_CLI, CLI_TB, grid('Filas de clientes'), pager(), 'conn="Ventas" db="main" info="Exportando clientes.csv · 7 de 12 filas"',
                              overlay=prog, data=D_CLI)

# ---------------- GridLoading (NEW): skeleton + Ejecutando… Cancelar
load_strip = strip(f'{SPIN}<span style="font-weight: 600">Ejecutando</span><span class="num" style="color: var(--text-dim)">00:02</span>' + SEP +
                   f'<span class="mono" style="color: var(--text-dim); overflow: hidden; text-overflow: ellipsis">{kw("SELECT")} * {kw("FROM")} "main"."clientes" {kw("LIMIT")} {numc("1000")}</span>' + FLEX +
                   a('DataGrid.dc.html', 'btn', ic('stop', 13) + 'Cancelar' + '<span class="kbd">Esc</span>', 'height: 26px'), 'Carga en curso')
out['GridLoading'] = frame('Cargando datos', [TAB_Q, {'label': 'clientes', 'kind': 'table', 'active': True, 'running': True, 'href': 'DataGrid.dc.html'}], CLI_TB,
                           load_strip + '\n      ' + grid('Filas de clientes (cargando)', extra='loading="{{yes}}" aria-busy="true"'),
                           pager('Cargando filas…', count=False, help='', pages='– / –'), 'conn="Ventas" db="main" info="clientes · ejecutando · 00:02"', data=D_CLI)

# ---------------- GridRangeSelection (NEW): 3×2 range with summary in the status bar
out['GridRangeSelection'] = frame('Selección de rango', TABS_CLI, CLI_TB, grid('Filas de clientes', extra='range="{{rg}}" selected="{{sel}}"'),
                                  pager(help='Ctrl+C copia el rango como TSV · Mayús+clic o Mayús+flechas lo amplía'),
                                  'conn="Ventas" db="main" info="6 celdas · 3 números · Suma 1019.87 · Media 339.96 · Mín 12.00 · Máx 777.77"',
                                  data=dict(D_CLI, rg={'r1': 4, 'c1': 3, 'r2': 6, 'c2': 4}, sel={'r': 6, 'c': 4}))

# ---------------- ResultCompare (old values visible, gutter glyphs, empty state when identical)
cmp_rows = [[2, 'Juan Pérez', 'jperez@correo.mx', 'Nogales', '1020.50', 'true', '2023-03-01'],
            [5, 'Sofía Torres', 'storres@correo.mx', 'Guaymas', '12.00', 'true', '2024-04-18'],
            [6, 'Carlos Ruiz', 'cruiz@correo.mx', 'Navojoa', '777.77', 'false', '2024-06-30'],
            [13, 'Diana Flores', 'dflores@correo.mx', 'Hermosillo', '0.00', 'true', '2025-10-18']]
cmp_strip = strip('<span style="font-weight: 600">Fijado 14:17:46</span><span style="color: var(--text-dim)">→</span><span style="font-weight: 600">Actual</span>' + SEP +
                  '<label style="display: flex; align-items: center; gap: 6px; color: var(--text-dim)">Emparejar por<select class="field" aria-label="Clave de emparejamiento" style="height: 26px"><option>id (clave primaria)</option><option>Por posición</option></select></label>' + SEP +
                  '<sc-if value="{{diff}}" hint-placeholder-val="{{ true }}"><span style="display: flex; gap: 6px"><span class="chip" style="background: var(--warn-soft); color: var(--warn)">~ 2 cambiadas</span>'
                  '<span class="chip" style="background: var(--ok-soft); color: var(--ok)">+ 1 añadida</span>'
                  '<span class="chip" style="background: var(--danger-soft); color: var(--danger)">− 1 eliminada</span></span></sc-if>'
                  '<sc-if value="{{same}}" hint-placeholder-val="{{ false }}"><span class="chip" style="background: var(--ok-soft); color: var(--ok)">Sin diferencias</span></sc-if>' + FLEX +
                  '<label style="display: flex; align-items: center; gap: 6px; color: var(--text-dim)"><input type="checkbox" style="accent-color: var(--accent); margin: 0">Mostrar iguales</label>'
                  + a('PinnedResult.dc.html', 'btn', 'Cerrar comparación', 'height: 26px'), 'Comparación de resultados')
cmp_body = ('<sc-if value="{{diff}}" hint-placeholder-val="{{ true }}">' + grid('Diferencias entre Fijado 14:17:46 y Actual', extra='edited="{{edited}}" row-state="{{rowState}}" show-old="{{yes}}"') + '</sc-if>'
            '<sc-if value="{{same}}" hint-placeholder-val="{{ false }}"><div role="status" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px">'
            f'<span style="display: flex; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 50%; background: var(--ok-soft); color: var(--ok)">{ic("check", 22)}</span>'
            '<div style="font-size: var(--fs-lg); font-weight: 600">Los dos resultados son idénticos</div>'
            '<div style="color: var(--text-dim)">12 filas emparejadas por id; ningún valor cambió.</div>'
            + a('#', 'btn btn-primary', 'Mostrar las 12 filas') + '</div></sc-if>')
out['ResultCompare'] = frame('Comparar resultados', TABS_CLI, table_toolbar(on='compare'), cmp_strip + '\n      ' + cmp_body,
                             pager('4 diferencias · 9 filas iguales ocultas', count=False, help='El valor anterior aparece tachado junto al nuevo'),
                             'conn="Ventas" db="main" info="Fijado 14:17:46: 12 filas · Actual: 12 filas · 4 diferencias"',
                             data={'columns': WIDE, 'rows': cmp_rows, 'edited': [{'r': 0, 'c': 4, 'old': '980.50'}, {'r': 1, 'c': 3, 'old': 'Hermosillo'}],
                                   'rowState': {'0': 'changed', '1': 'changed', '2': 'removed', '3': 'added'}},
                             props_extra=',"state":{"editor":"enum","options":["diferencias","identicos"],"default":"diferencias"}',
                             js_extra=", same: this.props.state === 'identicos', diff: this.props.state !== 'identicos'")

# ---------------- Chart (raw numbers on the axis and labels)
prods = [('SKU-1001', '129.00'), ('SKU-1002', '349.50'), ('SKU-1003', '89.90'), ('SKU-1004', '1299.00'), ('SKU-1005', '459.00'), ('SKU-1006', '59.90'), ('SKU-1007', '799.00'), ('SKU-1008', '219.00')]
W, H, L, B, T = 880, 470, 56, 40, 16
pw, ph = W - L - 16, H - B - T
svg = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Barras: precio por sku, 8 productos" style="display: block; font-family: var(--font-ui)">']
for v in (0, 400, 800, 1200):
    y = T + ph - v / 1400 * ph
    svg.append(f'<line x1="{L}" x2="{W - 16}" y1="{y:.1f}" y2="{y:.1f}" style="stroke: var(--border)"></line>')
    svg.append(f'<text x="{L - 8}" y="{y + 4:.1f}" text-anchor="end" style="fill: var(--text-dim); font-size: 11px; font-variant-numeric: tabular-nums">{v}</text>')
bw = pw / len(prods)
for i, (s, v) in enumerate(prods):
    h = float(v) / 1400 * ph
    x = L + i * bw + bw * 0.2
    svg.append(f'<rect x="{x:.1f}" y="{T + ph - h:.1f}" width="{bw * 0.6:.1f}" height="{h:.1f}" rx="3" style="fill: var(--accent)"><title>{s}: {v}</title></rect>')
    svg.append(f'<text x="{x + bw * 0.3:.1f}" y="{T + ph - h - 6:.1f}" text-anchor="middle" style="fill: var(--text-dim); font-size: 11px; font-variant-numeric: tabular-nums">{v}</text>')
    svg.append(f'<text x="{x + bw * 0.3:.1f}" y="{H - 16}" text-anchor="middle" style="fill: var(--text-dim); font-size: 11px">{s}</text>')
svg.append('</svg>')
chk = '<label style="display: flex; align-items: center; gap: 6px; white-space: nowrap"><input type="checkbox"{} style="accent-color: var(--accent); margin: 0">{}</label>'
chart_tb = toolbar('Opciones del gráfico', [
    '<span class="lbl">Tipo</span><span class="seg" role="radiogroup" aria-label="Tipo de gráfico"><a href="#" class="on" role="radio" aria-checked="true">Barras</a><a href="#" role="radio" aria-checked="false">Líneas</a><a href="#" role="radio" aria-checked="false">Pastel</a></span>', SEP,
    '<label class="lbl" for="eje">Eje</label><select id="eje" class="field" style="width: 120px"><option>sku</option><option>nombre</option></select>', SEP,
    '<span class="lbl">Valores</span>', chk.format(' checked="checked"', 'precio'), chk.format('', 'existencias'), FLEX,
    a('#', 'btn btn-ghost', ic('export', 14) + 'Guardar imagen'),
    a('DataGrid.dc.html', 'btn btn-ghost', ic('table', 14) + 'Ver datos')])
chart_body = ('<div style="flex: 1; min-height: 0; padding: 20px 24px; display: flex; flex-direction: column; gap: 10px">'
              '<div style="display: flex; align-items: baseline; gap: 10px"><span style="font-size: var(--fs-lg); font-weight: 600">precio por sku</span><span style="font-size: var(--fs-sm); color: var(--text-dim)">productos · 8 filas · toda la tabla</span></div>'
              + ''.join(svg) +
              '<div class="help">El pastel usa solo la primera columna de valores seleccionada. «id» no se ofrece como valor: es la clave primaria.</div></div>')
out['Chart'] = frame('Gráfico', [TAB_Q, {'label': 'productos', 'kind': 'table', 'href': 'DataGrid.dc.html'}, {'label': 'Gráfico · productos', 'kind': 'tool', 'active': True, 'href': 'Chart.dc.html'}],
                     chart_tb, chart_body, '', 'conn="Ventas" db="main" info="productos · 8 filas · 1 serie"', 'tree="tables" selected="productos"', wtitle='Gráfico · productos — Ventas — Squaero')

assert 'DataGrid' not in out
for name, src in out.items():
    io.open(os.path.join(HERE, 'bodies', name + '.body'), 'w', encoding='utf-8', newline='\n').write(src)
print(' '.join(out))
