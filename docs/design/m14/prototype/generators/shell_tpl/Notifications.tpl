Notificaciones
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="DataGrid" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="DataGrid.dc.html" aria-label="Cerrar notificaciones (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>

  <section class="menu" aria-labelledby="nt-title" style="right: 140px; top: 40px; width: 420px; padding: 0; display: flex; flex-direction: column; overflow: hidden">
    <div style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 16px; border-bottom: 1px solid var(--border)">
      <h2 id="nt-title" style="margin: 0; flex: 1; font-size: var(--fs-md); font-weight: 600">Notificaciones</h2>
      <button type="button" class="btn btn-ghost" style="height: 26px; font-size: var(--fs-sm)">[[check:14]]Marcar como leídas</button>
      <a href="SettingsGeneral.dc.html" class="btn btn-icon" aria-label="Ajustes de notificaciones" title="Ajustes de notificaciones">[[settings]]</a>
    </div>
    <div role="list" style="padding: 4px 0 8px">
      <sc-for list="{{days}}" as="d" hint-placeholder-count="2">
        <div class="lbl" style="padding: 10px 16px 4px">{{d.name}}</div>
        <sc-for list="{{d.items}}" as="n" hint-placeholder-count="3">
          <div role="listitem" style="{{n.style}}">
            <span style="{{n.iconBox}}">
              <sc-if value="{{n.k.ok}}">[[check:15]]</sc-if>
              <sc-if value="{{n.k.error}}">[[warning:15]]</sc-if>
              <sc-if value="{{n.k.warn}}">[[plug:15]]</sc-if>
              <sc-if value="{{n.k.info}}">[[info:15]]</sc-if>
            </span>
            <span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">
              <span style="display: flex; align-items: baseline; gap: 8px"><span style="{{n.titleStyle}}">{{n.title}}</span><span class="num" style="font-size: var(--fs-xs); color: var(--text-dim)">{{n.time}}</span></span>
              <span style="font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.4">{{n.detail}}</span>
              <sc-if value="{{n.hasAction}}"><a href="{{n.actionHref}}" class="btn" style="align-self: flex-start; margin-top: 4px; height: 26px; font-size: var(--fs-sm)">{{n.action}}</a></sc-if>
            </span>
            <sc-if value="{{n.unread}}"><span role="img" aria-label="Sin leer" style="width: 7px; height: 7px; margin-top: 6px; flex: none; border-radius: 50%; background: var(--accent)"></span></sc-if>
          </div>
        </sc-for>
      </sc-for>
    </div>
    <div style="min-height: 40px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 16px; border-top: 1px solid var(--border); background: var(--surface)">
      <span class="help" style="flex: 1">Solo tareas en segundo plano y avisos de otras pestañas. Los errores se quedan hasta que los cierras.</span>
      <button type="button" class="btn btn-ghost" title="Se puede deshacer" style="height: 26px; font-size: var(--fs-sm)">Borrar historial</button>
    </div>
  </section>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    const tone = { ok: ['var(--ok-soft)', 'var(--ok)'], error: ['var(--danger-soft)', 'var(--danger)'], warn: ['var(--warn-soft)', 'var(--warn)'], info: ['var(--accent-soft)', 'var(--accent-text)'] };
    const mk = ([kind, title, detail, time, unread, action, actionHref]) => {
      const k = {}; k[kind] = true;
      return { k, title, detail, time, unread: !!unread, action: action ?? '', actionHref: actionHref ?? '#', hasAction: !!action,
        iconBox: `width: 28px; height: 28px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${tone[kind][0]}; color: ${tone[kind][1]}`,
        titleStyle: `flex: 1; min-width: 0; font-weight: ${unread ? 600 : 500}; color: var(--text)`,
        style: `display: flex; align-items: flex-start; gap: 12px; padding: 10px 16px; ${unread ? 'background: var(--accent-soft);' : ''}` };
    };
    const days = [
      { name: 'Hoy', items: [
        ['error', 'No se pudo conectar a «Producción (MySQL)»', 'Tiempo de espera agotado tras 10 s (db.interno:3306).', '14:22', true, 'Reintentar', 'ConnectionSearch.dc.html'],
        ['ok', 'Consulta 2 terminó en Producción', '1204 filas · 38 s · mientras estabas en otra pestaña', '14:20', true, 'Ver resultado', 'SafeModeReadonly.dc.html'],
        ['ok', 'Exportación terminada', 'clientes → C:\\exportes\\clientes.csv · 12 filas', '14:18', false, 'Mostrar en la carpeta', '#'],
        ['warn', 'Se perdió la conexión con «Ventas copia»', 'Se reconectó sola a los 3 s; no se perdió nada.', '13:52', false]].map(mk) },
      { name: 'Ayer', items: [
        ['ok', 'Respaldo guardado', '6 objetos en ventas-2026-10-17.sql', '18:40', false]].map(mk) }
    ];
    return { theme: this.props.theme ?? 'b', os: this.props.os ?? 'windows', days };
  }
}
