Cargando
<div class="th th-{{theme}}" data-os="{{os}}" aria-busy="true" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" window-title="clientes — Ventas — Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="explorer" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="loading" height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
[[@tabletb]]
      <div style="flex: 1; min-height: 0">
        <dc-import name="Grid" theme="{{theme}}" columns="{{columns}}" rows="{{rows}}" loading="true" label="Filas de clientes" height="100%" hint-size="100%,100%"></dc-import>
      </div>
      <div role="status" style="height: 34px; flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-top: 1px solid var(--border); font-size: var(--fs-sm); color: var(--text-dim)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="color: var(--accent-text)"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>
        <span class="num">Conectando a Ventas y leyendo clientes · 00:02</span>
        <button type="button" class="btn" style="height: 24px; font-size: var(--fs-sm)">Cancelar</button>
        <span style="flex: 1"></span>
        <span class="help">Las pestañas y el explorador se rellenan en cuanto responde la base</span>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="Conectando…" hint-size="1280px,24px"></dc-import>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    return {
      theme: this.props.theme ?? 'b', os, k, obj: 'clientes',
      tabs: [{ label: 'clientes', kind: 'table', active: true, running: true, href: 'TreeLoading.dc.html' }],
      columns: [
        { name: 'id', type: 'integer', kind: 'num', w: '76px', key: true }, { name: 'nombre', type: 'text', kind: 'text', w: '140px' },
        { name: 'email', type: 'text', kind: 'text', w: '200px' }, { name: 'ciudad', type: 'text', kind: 'text', w: '130px' },
        { name: 'saldo', type: 'numeric(10,2)', kind: 'num', w: '112px' }, { name: 'activo', type: 'boolean', kind: 'bool', w: '78px' }, { name: 'alta', type: 'date', kind: 'date', w: '1fr' }],
      rows: []
    };
  }
}
