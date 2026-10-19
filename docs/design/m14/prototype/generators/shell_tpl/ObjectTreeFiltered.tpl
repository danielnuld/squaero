Árbol filtrado
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" window-title="pedidos — Ventas — Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="explorer" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="connected" tree="expanded" filter="ped" selected="pedidos" height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
[[@tabletb]]
      <div style="flex: 1; min-height: 0">
        <dc-import name="Grid" theme="{{theme}}" columns="{{columns}}" rows="{{rows}}" label="Filas de pedidos" height="100%" hint-size="100%,100%"></dc-import>
      </div>
      <div style="height: 34px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">
        <span class="num">Filas 1–8 de 8</span>
        <span class="help">Doble clic, F2 o empieza a escribir para editar una celda</span>
        <span style="flex: 1"></span>
        <span class="seg" aria-label="Paginación"><a href="#" aria-label="Primera página">|‹</a><a href="#" aria-label="Página anterior">‹</a><span class="on" aria-current="page">1 / 1</span><a href="#" aria-label="Página siguiente">›</a><a href="#" aria-label="Última página">›|</a></span>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="pedidos · 8 filas · 5 columnas · 9 ms" hint-size="1280px,24px"></dc-import>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    return {
      theme: this.props.theme ?? 'b', os, k, obj: 'pedidos',
      tabs: [{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html', dirty: true }, { label: 'pedidos', kind: 'table', active: true, href: 'ObjectTreeFiltered.dc.html' }],
      columns: [
        { name: 'id', type: 'integer', kind: 'num', w: '72px', key: true, sort: '↑' }, { name: 'cliente_id', type: 'integer', kind: 'num', w: '190px', fk: 'clientes.id' },
        { name: 'fecha', type: 'date', kind: 'date', w: '130px' }, { name: 'total', type: 'real', kind: 'num', w: '110px' }, { name: 'estado', type: 'text', kind: 'text', w: '1fr' }],
      rows: [[1, 1, '2025-01-12', '1480.00', 'entregado'], [2, 4, '2025-02-03', '312.50', 'entregado'], [3, 2, '2025-02-20', '89.90', 'cancelado'], [4, 5, '2025-03-14', '2105.75', 'entregado'],
        [5, 8, '2025-04-01', '640.00', 'enviado'], [6, 1, '2025-05-09', null, 'pendiente'], [7, 11, '2025-06-22', '415.20', 'enviado'], [8, 9, '2025-07-30', '1020.00', 'pendiente']]
    };
  }
}
