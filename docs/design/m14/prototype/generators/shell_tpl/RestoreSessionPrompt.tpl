Retomar la sesión
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="Welcome" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <div class="dlg-scrim">
    <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="rs-title" aria-describedby="rs-desc" style="width: 480px">
      <div class="dlg-h">
        <span id="rs-title" style="flex: 1">Retomar la sesión anterior</span>
        <a href="Welcome.dc.html" class="btn btn-icon" aria-label="Cerrar sin decidir (Esc)" title="Cerrar sin decidir (Esc): la sesión sigue disponible">[[close:16]]</a>
      </div>
      <div class="dlg-b">
        <p id="rs-desc" style="margin: 0; color: var(--text-dim); line-height: 1.5">Al cerrar quedaron 2 pestañas con SQL sin ejecutar.</p>
        <div role="list" style="border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden">
          <sc-for list="{{tabs}}" as="t" hint-placeholder-count="2">
            <div role="listitem" style="{{t.style}}">
              <span style="{{t.bar}}"></span>
              [[query:15:color: var(--accent-text); flex: none]]
              <span style="flex: 1; min-width: 0"><span style="display: block; font-weight: 500">{{t.title}}</span><span class="mono" style="display: block; font-size: var(--fs-xs); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{t.sql}}</span></span>
              <span style="display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-dim); white-space: nowrap"><span style="{{t.dot}}"></span>{{t.conn}}</span>
            </div>
          </sc-for>
        </div>
        <p class="help" style="margin: 0; line-height: 1.5">Retomar vuelve a abrir las pestañas y reconecta a Ventas y Producción. Si cierras este aviso, la sesión sigue disponible en Archivo › Retomar la sesión anterior.</p>
      </div>
      <div class="dlg-f">
        <span class="help"><span class="kbd">Esc</span> cierra sin descartar</span>
        <span style="flex: 1"></span>
        <span class="dlg-actions" style="{{act}}">
          <a href="EditorEmpty.dc.html" class="btn btn-primary focus">Retomar 2 pestañas</a>
          <a href="Welcome.dc.html" class="btn">Descartar pestañas</a>
        </span>
      </div>
    </div>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    const os = this.props.os ?? 'windows';
    const tabs = [['Consulta 1', 'SELECT c.nombre, c.ciudad, p.fecha, p.total FROM clientes c …', 'Ventas', '#2f7dd6'], ['Top clientes', 'SELECT nombre, SUM(total) AS total FROM pedidos …', 'Producción', '#c4302b']]
      .map(([title, sql, conn, c], i) => ({ title, sql, conn,
        bar: `width: 3px; align-self: stretch; flex: none; border-radius: 2px; background: ${c}`,
        dot: `width: 7px; height: 7px; border-radius: 50%; background: ${c}`,
        style: `display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; ${i ? 'border-top: 1px solid var(--border);' : ''}` }));
    return { theme: this.props.theme ?? 'b', os, tabs, act: os === 'windows' ? '' : 'flex-direction: row-reverse' };
  }
}
