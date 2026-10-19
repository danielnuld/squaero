import os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'redesign'))
dg = open('bodies/DataGrid.body', encoding='utf8').read()
dg_main = dg[dg.index('    <main '):dg.index('</main>') + 7]
dg_js = dg[dg.index('---JS---\n') + 9:]
PROPS = '{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}'
SPIN = '<svg width="{0}" height="{0}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9"></path></svg>'
TABLE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--obj-table); flex: none"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 10v10"></path></svg>'


def side(q, mode):
    running = mode == 'running'
    dis = ' disabled="disabled"' if running else ''
    fieldcls = 'field is-focus' if mode == 'empty' else 'field'
    if running:
        action = '<a href="DataSearchResults.dc.html" class="btn btn-danger" style="width: 100%; justify-content: center" title="Detener la búsqueda (Esc); se conservan las coincidencias ya encontradas"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>Detener búsqueda</a>'
    else:
        action = '<a href="DataSearchRunning.dc.html" class="btn btn-primary" style="width: 100%; justify-content: center" title="Buscar (Intro)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>Buscar en 3 tablas</a>'
    rows = [('clientes', '7 columnas de texto', True), ('pedidos', '1 columna de texto', True), ('productos', '3 columnas de texto', True), ('detalle_pedido', 'Sin columnas de texto', False)]
    tl = ''
    for name, sub, ok in rows:
        chk = ' checked="checked"' if ok else ''
        d = '' if ok else ' disabled="disabled"'
        col = 'var(--text)' if ok else 'var(--text-dim)'
        tl += f'''
          <label style="min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 2px 8px; border-radius: var(--r-sm)"{' title="Activa «También columnas numéricas» para incluirla"' if not ok else ''}>
            <input type="checkbox"{chk}{d}{dis} style="accent-color: var(--accent); margin: 0; width: 16px; height: 16px">
            {TABLE_ICON}
            <span style="flex: 1; min-width: 0"><span style="display: block; color: {col}">{name}</span><span style="display: block; font-size: var(--fs-xs); color: var(--text-dim)">{sub}</span></span>
          </label>'''
    return f'''    <aside aria-label="Buscar en los datos" style="width: 248px; height: 738px; flex: none; box-sizing: border-box; display: flex; flex-direction: column; background: var(--chrome); overflow: hidden">
      <div style="height: 36px; flex: none; display: flex; align-items: center; padding: 0 6px 0 12px">
        <span style="flex: 1; font-size: var(--fs-md); font-weight: 600">Buscar en los datos</span>
        <button type="button" class="btn btn-icon" aria-label="Opciones de búsqueda" title="Opciones de búsqueda" aria-haspopup="menu"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="19" cy="12" r="1.2"></circle></svg></button>
      </div>
      <form role="search" aria-label="Buscar texto en las tablas" style="flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 0 10px 10px">
        <div style="display: flex; flex-direction: column; gap: 4px">
          <span class="lbl" id="ds-where">Dónde</span>
          <button type="button" class="field" aria-labelledby="ds-where" aria-haspopup="listbox"{dis} style="width: 100%; display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); text-align: left"><span style="width: 8px; height: 8px; flex: none; border-radius: 50%; background: #2f7dd6"></span><b style="font-weight: 600">Ventas</b><span style="flex: 1; color: var(--text-dim)">· main</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        </div>
        <label style="display: flex; flex-direction: column; gap: 4px">
          <span class="lbl">Texto</span>
          <span style="position: relative; display: block">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="position: absolute; left: 9px; top: 7px; color: var(--text-dim)"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
            <input class="{fieldcls}" value="{q}" placeholder="Texto a buscar"{dis} style="width: 100%; box-sizing: border-box; padding-left: 28px">
          </span>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm)"><span style="width: 84px; color: var(--text-dim)">Coincidencia</span><span class="field" role="combobox" aria-expanded="false" style="flex: 1; height: 28px; display: flex; align-items: center; font-size: var(--fs-sm)"><span style="flex: 1">Contiene</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></span></label>
        <label style="display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm)"><span style="width: 84px; color: var(--text-dim)">Filas por tabla</span><input class="field num" value="100"{dis} style="width: 64px; height: 28px; font-size: var(--fs-sm)"></label>
        <div style="display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-sm)">
          <label style="display: flex; align-items: center; gap: 8px"><input type="checkbox" checked="checked"{dis} style="accent-color: var(--accent); margin: 0; width: 16px; height: 16px">Ignorar mayúsculas y acentos</label>
          <label style="display: flex; align-items: center; gap: 8px"><input type="checkbox"{dis} style="accent-color: var(--accent); margin: 0; width: 16px; height: 16px">También columnas numéricas</label>
        </div>
        <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px">
          <div style="display: flex; align-items: center; padding: 0 2px 4px"><span class="lbl" style="flex: 1">Tablas · 3 de 4</span><button type="button"{dis} style="min-height: 24px; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--fs-sm)">Ninguna</button></div>{tl}
        </div>
        {action}
        <span class="help" style="text-align: center">Intro busca · los resultados se abren en una pestaña</span>
      </form>
    </aside>
'''


def frame(title, wtitle, sidebar, main, status):
    return f'''{title}
<div class="th th-{{{{theme}}}}" data-os="{{{{os}}}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{{{theme}}}}" os="{{{{os}}}}" window-title="{wtitle}" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{{{theme}}}}" active="search" height="738px" hint-size="56px,738px"></dc-import>
{sidebar}{main}
  </div>
  {status}
</div>
---PROPS---
{PROPS}
---JS---
'''

# 1. DataSearch: side column switched to the search form; the open document is untouched.
st = '<dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="clientes · 12 filas · 7 columnas · 20 ms" hint-size="1280px,24px"></dc-import>'
open('bodies/DataSearch.body', 'w', encoding='utf8', newline='\n').write(
    frame('Buscar en los datos', 'clientes — Ventas — Squaero', side('', 'empty'), dg_main, st) + dg_js)


def results_main(running):
    if running:
        head = f'''<div role="status" style="flex: none; display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border)">
          <div style="display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm)">
            <span style="display: flex; color: var(--accent-text)">{SPIN.format(14)}</span>
            <span><b>Buscando en la tabla 2 de 3</b> · pedidos · 00:01 · 3 coincidencias hasta ahora</span>
            <span style="flex: 1"></span>
            <a href="DataSearchResults.dc.html" class="btn" style="height: 28px; font-size: var(--fs-sm)" title="Detener la búsqueda (Esc); se conservan las coincidencias ya encontradas">Cancelar</a>
          </div>
          <div role="progressbar" aria-label="Progreso de la búsqueda" aria-valuemin="0" aria-valuemax="3" aria-valuenow="1" aria-valuetext="Tabla 2 de 3" style="height: 6px; border-radius: 3px; background: var(--border); overflow: hidden"><span style="display: block; width: 50%; height: 100%; background: var(--accent)"></span></div>
        </div>'''
    else:
        head = '''<div style="height: 44px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 14px; border-bottom: 1px solid var(--border); font-size: var(--fs-sm)">
          <span><b>3 coincidencias</b> de «Hermosillo» en 1 de 3 tablas · 18 ms</span>
          <span class="help">· detalle_pedido omitida: sin columnas de texto</span>
          <span style="flex: 1"></span>
          <button type="button" class="btn btn-ghost" title="Repetir la búsqueda (F5)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path></svg>Refrescar</button>
          <button type="button" class="btn btn-ghost" aria-haspopup="menu"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"></path><path d="m7 8 5-5 5 5"></path><path d="M5 21h14"></path></svg>Exportar<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button>
        </div>'''
    return f'''    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{{{theme}}}}" tabs="{{{{tabs}}}}" hint-size="100%,36px"></dc-import>
      {head}
      <div style="flex: 1; min-height: 0; display: flex">
        <nav aria-label="Tablas buscadas" style="width: 240px; flex: none; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--border); background: var(--surface); padding: 6px">
          <sc-for list="{{{{tables}}}}" as="t" hint-placeholder-count="4">
            <a href="{{{{t.href}}}}" aria-current="{{{{t.current}}}}" style="{{{{t.style}}}}">
              <span style="{{{{t.iconStyle}}}}">
                <sc-if value="{{{{t.isRun}}}}">{SPIN.format(14)}</sc-if>
                <sc-if value="{{{{t.isIdle}}}}">{TABLE_ICON}</sc-if>
              </span>
              <span style="flex: 1; min-width: 0">
                <span style="{{{{t.nameStyle}}}}">{{{{t.name}}}}</span>
                <span style="display: block; font-size: var(--fs-xs); color: var(--text-dim)">{{{{t.sub}}}}</span>
              </span>
              <span class="chip num" style="{{{{t.chip}}}}">{{{{t.n}}}}</span>
            </a>
          </sc-for>
        </nav>
        <section aria-label="Coincidencias en clientes" style="flex: 1; min-width: 0; display: flex; flex-direction: column">
          <div role="toolbar" aria-label="Acciones de las coincidencias" style="height: 44px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 14px; border-bottom: 1px solid var(--border)">
            <span style="font-weight: 600">clientes</span>
            <span style="font-size: var(--fs-sm); color: var(--text-dim)">3 filas con «Hermosillo» en <span class="mono" style="color: var(--text)">ciudad</span></span>
            <span style="flex: 1"></span>
            <a href="DataGrid.dc.html" class="btn btn-primary" title="Abre clientes con el filtro ciudad LIKE '%Hermosillo%' aplicado en el servidor">{TABLE_ICON.replace('color: var(--obj-table); ', '')}Abrir clientes filtrada</a>
          </div>
          <div style="flex: 1; min-height: 0"><dc-import name="Grid" theme="{{{{theme}}}}" columns="{{{{columns}}}}" rows="{{{{rows}}}}" selected="{{{{sel}}}}" label="Coincidencias en clientes" height="100%" hint-size="100%,100%"></dc-import></div>
        </section>
      </div>
    </main>'''


def results_js(running):
    T = ("[['clientes', 'en ciudad', '3', 'done', true], ['pedidos', 'buscando… 4 de 8 filas', '…', 'run'], ['productos', 'pendiente', '—', 'wait'], ['detalle_pedido', 'omitida: sin columnas de texto', '—', 'skip']]"
         if running else
         "[['clientes', 'en ciudad', '3', 'done', true], ['pedidos', 'sin coincidencias', '0', 'done'], ['productos', 'sin coincidencias', '0', 'done'], ['detalle_pedido', 'omitida: sin columnas de texto', '—', 'skip']]")
    href = 'DataSearchRunning.dc.html' if running else 'DataSearchResults.dc.html'
    return f'''class Component extends DCLogic {{
  renderVals() {{
    const T = {T};
    const tables = T.map(([name, sub, n, st, on]) => {{
      const hit = st === 'done' && n !== '0';
      return {{ name, sub, n, current: on ? 'true' : 'false', href: '{href}', isRun: st === 'run', isIdle: st !== 'run',
        iconStyle: `display: flex; flex: none; color: ${{st === 'run' ? 'var(--accent-text)' : 'var(--obj-table)'}}`,
        nameStyle: `display: block; font-weight: ${{hit || st === 'run' ? 600 : 400}}; color: ${{hit || st === 'run' ? 'var(--text)' : 'var(--text-dim)'}}`,
        chip: `background: ${{hit ? 'var(--accent-soft)' : 'transparent'}}; color: ${{hit ? 'var(--accent-text)' : 'var(--text-dim)'}}`,
        style: `min-height: 44px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 4px 8px 4px 10px; border-radius: var(--r-sm); text-decoration: none; color: var(--text); background: ${{on ? 'var(--sel)' : 'transparent'}}; ${{on ? 'box-shadow: inset 2px 0 0 var(--accent);' : ''}}` }};
    }});
    return {{
      theme: this.props.theme ?? 'b', os: this.props.os ?? 'windows', tables, sel: {{ r: 0, c: 3 }},
      tabs: [{{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html', color: '#2f7dd6', dirty: true }}, {{ label: 'clientes', kind: 'table', href: 'DataGrid.dc.html', color: '#2f7dd6' }}, {{ label: 'Búsqueda: Hermosillo', kind: 'tool', active: true, {'running: true, ' if running else ''}href: '{href}', color: '#2f7dd6' }}],
      columns: [{{ name: 'id', type: 'integer', kind: 'num', w: '64px', key: true }}, {{ name: 'nombre', type: 'text', kind: 'text', w: '140px' }},
        {{ name: 'email', type: 'text', kind: 'text', w: '200px' }}, {{ name: 'ciudad', type: 'text', kind: 'text', w: '130px' }}, {{ name: 'saldo', type: 'numeric(10,2)', kind: 'num', w: '1fr' }}],
      rows: [[1, 'María López', 'maria.lopez@correo.mx', 'Hermosillo', '1250.00'], [5, 'Sofía Torres', 'storres@correo.mx', 'Hermosillo', '12.00'], [9, 'Paola Núñez', 'pnunez@correo.mx', 'Hermosillo', '88.25']]
    }};
  }}
}}
'''

st2 = '<dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="3 coincidencias · 1 de 3 tablas · 18 ms" hint-size="1280px,24px"></dc-import>'
open('bodies/DataSearchResults.body', 'w', encoding='utf8', newline='\n').write(
    frame('Resultados de la búsqueda', 'Búsqueda: Hermosillo — Ventas — Squaero', side('Hermosillo', 'done'), results_main(False), st2) + results_js(False))
st3 = '<dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="Buscando · tabla 2 de 3 · 3 coincidencias hasta ahora" hint-size="1280px,24px"></dc-import>'
open('bodies/DataSearchRunning.body', 'w', encoding='utf8', newline='\n').write(
    frame('Buscando en los datos', 'Buscando… — Ventas — Squaero', side('Hermosillo', 'running'), results_main(True), st3) + results_js(True))
print('ok')
