Ventana en macOS
<div class="th th-{{theme}}" data-os="macos" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <nav aria-label="Barra de menús de macOS (del sistema)" style="height: 24px; flex: none; display: flex; align-items: center; gap: 2px; padding: 0 10px; background: var(--chrome-2); border-bottom: 1px solid var(--border); font-size: var(--fs-md)">
    <span aria-hidden="true" style="width: 26px; text-align: center; font-weight: 700"></span>
    <sc-for list="{{sysMenus}}" as="m" hint-placeholder-count="8"><span style="{{m.style}}">{{m.label}}</span></sc-for>
    <span style="flex: 1"></span>
    <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">sáb 18 oct 14:32</span>
  </nav>
  <dc-import name="TitleBar" theme="{{theme}}" os="macos" notif="1" window-title="clientes — Ventas — Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="explorer" height="714px" hint-size="56px,714px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="connected" tree="tables" selected="clientes" height="714px" hint-size="248px,714px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
[[@tabletb]]
      <div style="flex: 1; min-height: 0">
        <dc-import name="Grid" theme="{{theme}}" columns="{{columns}}" rows="{{rows}}" range="{{range}}" selected="{{sel}}" label="Filas de clientes" height="100%" hint-size="100%,100%"></dc-import>
      </div>
      <div style="height: 34px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">
        <span class="num">Filas 1–12 de 12</span>
        <span class="help">Doble clic, ↩ o empieza a escribir para editar una celda</span>
        <span style="flex: 1"></span>
        <span class="seg" aria-label="Paginación"><a href="#" aria-label="Primera página">|‹</a><a href="#" aria-label="Página anterior">‹</a><span class="on" aria-current="page">1 / 1</span><a href="#" aria-label="Página siguiente">›</a><a href="#" aria-label="Última página">›|</a></span>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="3 celdas · 1 NULL · Suma 2242.10 · Media 1121.05" hint-size="1280px,24px"></dc-import>

  <a href="DataGrid.dc.html" aria-label="Cerrar el menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>
  <div class="menu" role="menu" aria-label="Edición" style="left: 150px; top: 24px; width: 290px; border-radius: 0 0 var(--r-md) var(--r-md)">
    <span role="menuitem" aria-disabled="true" class="mi dis">Deshacer<span class="k">⌘Z</span></span>
    <span role="menuitem" aria-disabled="true" class="mi dis">Rehacer<span class="k">⇧⌘Z</span></span>
    <div class="msep" role="separator"></div>
    <a href="#" role="menuitem" class="mi">Cortar<span class="k">⌘X</span></a>
    <a href="#" role="menuitem" class="mi on focus-in">Copiar<span class="k">⌘C</span></a>
    <a href="#" role="menuitem" aria-haspopup="menu" class="mi">Copiar como<span class="k" style="display: flex">[[chevron-right:14]]</span></a>
    <a href="#" role="menuitem" class="mi">Pegar<span class="k">⌘V</span></a>
    <a href="#" role="menuitem" class="mi">Seleccionar todo<span class="k">⌘A</span></a>
    <div class="msep" role="separator"></div>
    <a href="GridColumnFilter.dc.html" role="menuitem" class="mi">Buscar en la página<span class="k">⌘F</span></a>
    <a href="DataFilterCondition.dc.html" role="menuitem" class="mi">Filtrar la tabla…<span class="k">⇧⌘L</span></a>
    <a href="#" role="menuitem" class="mi">Refrescar<span class="k">⌘R</span></a>
    <div class="msep" role="separator"></div>
    <a href="#" role="menuitem" class="mi">Emojis y símbolos<span class="k">fn E</span></a>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    const os = 'macos'; const mac = true;
    const K = (s) => { const p = s.split('+'); const key = p.pop(); const sym = { Alt: '⌥', 'Mayús': '⇧', Ctrl: '⌘' }; const km = { Intro: '↩', Supr: '⌫' }; return ['Alt', 'Mayús', 'Ctrl'].filter((m) => p.includes(m)).map((m) => sym[m]).join('') + (km[key] ?? key); };
    const k = { filter: K('Ctrl+Mayús+L'), sort: K('Ctrl+Mayús+O'), find: K('Ctrl+F'), row: K('Ctrl+Intro'), export: K('Ctrl+Mayús+X') };
    const sysMenus = ['Squaero', 'Archivo', 'Edición', 'Ver', 'Consulta', 'Herramientas', 'Ventana', 'Ayuda'].map((label, i) => ({ label,
      style: `height: 22px; display: flex; align-items: center; padding: 0 8px; border-radius: 4px; ${i === 0 ? 'font-weight: 700;' : ''} ${label === 'Edición' ? 'background: var(--accent); color: var(--accent-fg);' : ''}` }));
    return {
      theme: this.props.theme ?? 'b', os, mac, k, obj: 'clientes', sysMenus, sel: { r: 3, c: 4 }, range: { r1: 1, c1: 4, r2: 3, c2: 4 },
      tabs: [{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html', dirty: true }, { label: 'clientes', kind: 'table', active: true, href: 'DataGrid.dc.html' }],
      columns: [
        { name: 'id', type: 'integer', kind: 'num', w: '76px', key: true, sort: '↑' }, { name: 'nombre', type: 'text', kind: 'text', w: '140px' },
        { name: 'email', type: 'text', kind: 'text', w: '200px' }, { name: 'ciudad', type: 'text', kind: 'text', w: '130px' },
        { name: 'saldo', type: 'numeric(10,2)', kind: 'num', w: '112px' }, { name: 'activo', type: 'boolean', kind: 'bool', w: '78px' }, { name: 'alta', type: 'date', kind: 'date', w: '1fr' }],
      rows: [
        [1, 'María López', 'maria.lopez@correo.mx', 'Hermosillo', '1250.00', 'true', '2023-02-14'], [2, 'Juan Pérez', 'jperez@correo.mx', 'Nogales', '980.50', 'true', '2023-03-01'],
        [3, 'Ana Gómez', 'ana.gomez@correo.mx', 'Guaymas', null, 'false', '2023-05-22'], [4, 'Luis Ramírez', 'lramirez@correo.mx', 'Cd. Obregón', '1261.60', 'true', '2024-01-09'],
        [5, 'Sofía Torres', 'storres@correo.mx', 'Hermosillo', '12.00', 'true', '2024-04-18'], [6, 'Carlos Ruiz', 'cruiz@correo.mx', 'Navojoa', '777.77', 'false', '2024-06-30'],
        [7, 'Elena Díaz', 'ediaz@correo.mx', 'Caborca', '230.10', 'true', '2024-08-12'], [8, 'Miguel Ángel', '', 'Nogales', '5400.00', 'true', '2024-11-03'],
        [9, 'Paola Núñez', 'pnunez@correo.mx', 'Hermosillo', '88.25', 'true', '2025-01-27'], [10, 'Roberto Sil', 'rsil@correo.mx', 'Guaymas', '1590.40', 'false', '2025-03-15'],
        [11, 'Verónica Paz', 'vpaz@correo.mx', 'Agua Prieta', '640.00', 'true', '2025-05-02'], [12, 'Andrés Solís', 'asolis@correo.mx', 'Puerto Peñasco', '315.75', 'true', '2025-06-19']]
    };
  }
}
