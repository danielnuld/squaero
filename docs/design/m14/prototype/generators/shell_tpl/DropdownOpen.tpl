Conexión de la pestaña
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--chrome)">
  <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" window-title="Consulta 1 • — Ventas — Squaero" hint-size="1280px,38px"></dc-import>
  <div style="flex: 1; min-height: 0; display: flex">
    <dc-import name="Rail" theme="{{theme}}" active="explorer" height="738px" hint-size="56px,738px"></dc-import>
    <dc-import name="Explorer" theme="{{theme}}" state="connected" tree="tables" selected="" height="738px" hint-size="248px,738px"></dc-import>
    <main style="flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--content); border-radius: var(--content-radius); border-top: var(--content-edge); border-left: var(--content-edge); overflow: hidden">
      <dc-import name="DocTabs" theme="{{theme}}" tabs="{{tabs}}" hint-size="100%,36px"></dc-import>
[[@runtb]]
      <div style="flex: 1; min-height: 0">
        <dc-import name="SqlEditor" theme="{{theme}}" sql="{{sql}}" current="4" caret-line="4" run-range="1-4" height="100%" hint-size="100%,100%"></dc-import>
      </div>
    </main>
  </div>
  <dc-import name="StatusBar" theme="{{theme}}" conn="Ventas" db="main" color="#2f7dd6" info="Línea 4, columna 15 · SQL" hint-size="1280px,24px"></dc-import>

  <a href="EditorEmpty.dc.html" aria-label="Cerrar la lista (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>
  <div class="menu" style="left: 314px; top: 114px; width: 330px; padding: 0; display: flex; flex-direction: column">
    <div class="lbl" id="dd-label" style="padding: 10px 12px 4px">Ejecutar esta pestaña en</div>
    <div role="listbox" aria-labelledby="dd-label" style="padding: 0 4px 4px">
      <sc-for list="{{conns}}" as="c" hint-placeholder-count="3">
        <div role="group" aria-label="{{c.name}}" style="padding: 2px 0">
          <div style="height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-weight: 600">
            <span style="{{c.dot}}"></span>{{c.name}}
            <sc-if value="{{c.safe}}">[[lock:12:color: var(--text-dim)]]</sc-if>
            <span style="flex: 1"></span>
            <span style="font-size: var(--fs-xs); font-weight: 400; color: var(--text-dim)">{{c.engine}}</span>
          </div>
          <sc-for list="{{c.dbs}}" as="d" hint-placeholder-count="2">
            <a href="EditorEmpty.dc.html" role="option" aria-selected="{{d.selected}}" class="{{d.cls}}" style="height: 30px; padding-left: 26px">
              <span style="width: 14px; display: flex; color: var(--accent-text)"><sc-if value="{{d.on}}">[[check:14]]</sc-if></span>
              <span class="mono" style="flex: 1">{{d.name}}</span>
              <span style="font-size: var(--fs-xs); color: var(--text-dim)">{{d.sub}}</span>
            </a>
          </sc-for>
        </div>
      </sc-for>
      <div class="msep" role="separator"></div>
      <a href="ConnectionSearch.dc.html" class="mi" role="option" aria-selected="false">[[plug]]Conectar a otra…</a>
    </div>
    <div class="help" style="padding: 8px 12px; border-top: 1px solid var(--border); background: var(--surface); line-height: 1.4">Cambia solo esta pestaña. El color de la pestaña y la barra de estado siguen a la conexión.</div>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    const dot = (c) => `width: 8px; height: 8px; border-radius: 50%; background: ${c}`;
    const db = (name, sub, on) => ({ name, sub, on, selected: on ? 'true' : 'false', cls: on ? 'mi on focus-in' : 'mi' });
    const conns = [
      { name: 'Ventas', engine: 'SQLite', safe: false, dot: dot('#2f7dd6'), dbs: [db('main', '4 tablas', true), db('temp', 'objetos temporales', false)] },
      { name: 'Producción', engine: 'PostgreSQL', safe: true, dot: dot('#c4302b'), dbs: [db('ventas · public', '6 tablas', false), db('ventas · auditoria', '2 tablas', false)] }
    ];
    return {
      theme: this.props.theme ?? 'b', os, k, act, conns,
      rc: { name: 'Ventas', db: 'main', safe: false, cls: 'field is-focus', open: 'true', dot: dot('#2f7dd6') },
      sql: 'SELECT c.nombre, c.ciudad, p.fecha, p.total\nFROM clientes c\nJOIN pedidos p ON p.cliente_id = c.id\nORDER BY p.fecha;',
      tabs: [{ label: 'Consulta 1', kind: 'query', active: true, dirty: true, color: '#2f7dd6', conn: 'Ventas', href: 'DropdownOpen.dc.html' },
        { label: 'Consulta 2', kind: 'query', safe: true, color: '#c4302b', conn: 'Producción', href: 'SafeModeReadonly.dc.html' }]
    };
  }
}
