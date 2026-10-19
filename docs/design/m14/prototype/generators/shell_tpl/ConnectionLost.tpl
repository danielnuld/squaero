Conexión perdida
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" notif="1" window-title="clientes • — Ventas — Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="explorer" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="lost" height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
      <div role="alert" style="height: 40px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 12px; background: var(--danger-soft); border-bottom: 1px solid var(--border); font-size: var(--fs-md)">
        [[wifi-off:16:color: var(--danger); flex: none]]
        <span style="font-weight: 600">Sin conexión con Ventas</span>
        <button type="button" class="btn focus" style="height: 26px">[[refresh:14]]Reconectar</button>
        <span style="color: var(--text-dim)">Los cambios pendientes se conservan.</span>
        <span style="flex: 1"></span>
        <span class="num" style="font-size: var(--fs-sm); color: var(--text-dim)">Reintento automático en 8 s</span>
      </div>
[[@tabletb]]
      <div style="flex: 1; min-height: 0">
        <dc-import name="Grid" theme="{{theme}}" columns="{{columns}}" rows="{{rows}}" selected="{{sel}}" edited="{{edited}}" row-state="{{rowState}}" label="Filas de clientes" height="100%" hint-size="100%,100%"></dc-import>
      </div>
      <div style="height: 44px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">
        <span class="num">Filas 1–12 de 12</span>
        <span style="flex: 1"></span>
        <span class="help">Guardar necesita la conexión</span>
        <button type="button" class="btn btn-primary" aria-disabled="true" title="Reconecta para guardar" style="opacity: .5">Guardar (1)</button>
        <button type="button" class="btn">Descartar</button>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" lost="true" info="1 cambio sin guardar · última respuesta 14:31:05" hint-size="1280px,24px"></dc-import>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    return {
      theme: this.props.theme ?? 'b', os, k, obj: 'clientes', sel: { r: 3, c: 4 }, edited: [{ r: 3, c: 4, old: '4321.99' }], rowState: { 3: 'changed' },
      tabs: [{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html', dirty: true }, { label: 'clientes', kind: 'table', active: true, dirty: true, href: 'ConnectionLost.dc.html' }],
      columns: [
        { name: 'id', type: 'integer', kind: 'num', w: '76px', key: true, sort: '↑' }, { name: 'nombre', type: 'text', kind: 'text', w: '140px' },
        { name: 'email', type: 'text', kind: 'text', w: '200px' }, { name: 'ciudad', type: 'text', kind: 'text', w: '130px' },
        { name: 'saldo', type: 'numeric(10,2)', kind: 'num', w: '112px' }, { name: 'activo', type: 'boolean', kind: 'bool', w: '78px' }, { name: 'alta', type: 'date', kind: 'date', w: '1fr' }],
      rows: [
        [1, 'María López', 'maria.lopez@correo.mx', 'Hermosillo', '1250.00', 'true', '2023-02-14'], [2, 'Juan Pérez', 'jperez@correo.mx', 'Nogales', '980.50', 'true', '2023-03-01'],
        [3, 'Ana Gómez', 'ana.gomez@correo.mx', 'Guaymas', null, 'false', '2023-05-22'], [4, 'Luis Ramírez', 'lramirez@correo.mx', 'Cd. Obregón', '4500.00', 'true', '2024-01-09'],
        [5, 'Sofía Torres', 'storres@correo.mx', 'Hermosillo', '12.00', 'true', '2024-04-18'], [6, 'Carlos Ruiz', 'cruiz@correo.mx', 'Navojoa', '777.77', 'false', '2024-06-30'],
        [7, 'Elena Díaz', 'ediaz@correo.mx', 'Caborca', '230.10', 'true', '2024-08-12'], [8, 'Miguel Ángel', '', 'Nogales', '5400.00', 'true', '2024-11-03'],
        [9, 'Paola Núñez', 'pnunez@correo.mx', 'Hermosillo', '88.25', 'true', '2025-01-27'], [10, 'Roberto Sil', 'rsil@correo.mx', 'Guaymas', '1590.40', 'false', '2025-03-15'],
        [11, 'Verónica Paz', 'vpaz@correo.mx', 'Agua Prieta', '640.00', 'true', '2025-05-02'], [12, 'Andrés Solís', 'asolis@correo.mx', 'Puerto Peñasco', '315.75', 'true', '2025-06-19']]
    };
  }
}
