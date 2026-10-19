Conexión de solo lectura
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" window-title="Consulta 2 • — Producción — Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="explorer" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="connected" tree="tables" selected="" conn-name="Producción" conn-color="#c4302b" safe="true" height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
[[@runtb]]
      <div style="flex: none">
        <dc-import name="SqlEditor" theme="{{theme}}" sql="{{sql}}" current="3" caret-line="3" run-range="3-3" height="250px" hint-size="100%,250px"></dc-import>
      </div>
      <div aria-hidden="true" style="height: 5px; flex: none; border-top: 1px solid var(--border); background: var(--surface)"></div>

      <div role="tablist" aria-label="Paneles de resultado" style="height: 36px; flex: none; display: flex; align-items: flex-end; gap: 2px; padding: 0 8px; background: var(--surface); border-bottom: 1px solid var(--border)">
        <span role="tab" aria-selected="false" style="height: 32px; display: flex; align-items: center; padding: 0 12px; color: var(--text-dim)">Resultado</span>
        <span role="tab" aria-selected="true" style="position: relative; height: 32px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--border); border-bottom: 0; border-radius: var(--r-md) var(--r-md) 0 0; background: var(--content); margin-bottom: -1px; font-weight: 600">Mensajes<span class="chip" style="height: 18px; background: var(--hover); color: var(--text-dim)">1</span></span>
        <span role="tab" aria-selected="false" style="height: 32px; display: flex; align-items: center; padding: 0 12px; color: var(--text-dim)">Plan</span>
      </div>
      <div style="flex: 1; min-height: 0; padding: 16px; display: flex; flex-direction: column; gap: 12px">
        <div role="status" style="max-width: 720px; display: flex; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-left: 3px solid var(--border-strong); border-radius: var(--r-md); background: var(--surface)">
          [[lock:18:color: var(--text-dim); flex: none]]
          <div style="display: flex; flex-direction: column; gap: 6px; min-width: 0">
            <span style="font-weight: 600">Bloqueada: Producción es de solo lectura</span>
            <span style="color: var(--text-dim); line-height: 1.5">La sentencia escribe (DELETE), así que no se ha enviado nada al servidor. 14:16:36</span>
            <span class="mono" style="font-size: var(--fs-sm); color: var(--text)">DELETE FROM clientes WHERE id = 1;</span>
            <span style="display: flex; gap: 8px; margin-top: 4px">
              <a href="DropdownOpen.dc.html" class="btn" style="font-size: var(--fs-sm)">Ejecutar en otra conexión…</a>
              <a href="ConnectionForm.dc.html" class="btn btn-ghost" style="font-size: var(--fs-sm)">Cambiar la protección…</a>
            </span>
          </div>
        </div>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="Producción" db="ventas" color="#c4302b" safe="true" info="Sentencia 3 · bloqueada · 2 ms" hint-size="1280px,24px"></dc-import>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    return {
      theme: this.props.theme ?? 'b', os, k, act,
      rc: { name: 'Producción', db: 'ventas', safe: true, cls: 'field', open: 'false', dot: 'width: 8px; height: 8px; border-radius: 50%; background: #c4302b' },
      sql: 'SELECT * FROM clientes WHERE id = 1;\n\nDELETE FROM clientes WHERE id = 1;',
      tabs: [{ label: 'Consulta 1', kind: 'query', href: 'EditorResult.dc.html', color: '#2f7dd6', conn: 'Ventas' },
        { label: 'Consulta 2', kind: 'query', active: true, dirty: true, safe: true, color: '#c4302b', conn: 'Producción', href: 'SafeModeReadonly.dc.html' }]
    };
  }
}
