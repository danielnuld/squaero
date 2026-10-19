Buscar una conexión
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="Welcome" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="Welcome.dc.html" aria-label="Cerrar (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>

  <div class="menu" role="dialog" aria-label="Conectar" style="left: 66px; top: 214px; width: 420px; padding: 0; display: flex; flex-direction: column; overflow: hidden">
    <label style="position: relative; display: block; padding: 10px 10px 6px">
      <span style="position: absolute; left: -9999px">Buscar una conexión guardada</span>
      [[search:15:position: absolute; left: 20px; top: 17px; color: var(--text-dim)]]
      <input class="field is-focus" role="combobox" aria-expanded="true" aria-controls="cs-list" value="" placeholder="Buscar por nombre, motor o servidor" style="width: 100%; padding-left: 32px">
    </label>
    <div id="cs-list" role="listbox" aria-label="Conexiones guardadas" style="padding: 0 4px 6px">
      <sc-for list="{{groups}}" as="g" hint-placeholder-count="2">
        <div class="lbl" role="presentation" style="padding: 8px 8px 4px">{{g.name}}</div>
        <sc-for list="{{g.items}}" as="c" hint-placeholder-count="2">
          <a href="{{c.href}}" role="option" aria-selected="{{c.selected}}" class="{{c.cls}}" style="{{c.style}}">
            <span style="{{c.bar}}"></span>
            <span style="{{c.badge}}">{{c.mono}}</span>
            <span style="flex: 1; min-width: 0">
              <span style="display: flex; align-items: center; gap: 6px; font-weight: 500">{{c.name}}<sc-if value="{{c.safe}}"><span class="chip" style="height: 18px; background: var(--hover); color: var(--text-dim)">[[lock:11]]Solo lectura</span></sc-if><sc-if value="{{c.open}}"><span class="chip" style="height: 18px; background: var(--ok-soft); color: var(--ok)">Conectada</span></sc-if></span>
              <span style="display: block; font-size: var(--fs-xs); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{c.sub}}</span>
            </span>
            <sc-if value="{{c.isSel}}"><span class="kbd">{{enter}}</span></sc-if>
          </a>
        </sc-for>
      </sc-for>
    </div>
    <div style="display: flex; align-items: center; gap: 2px; padding: 6px; border-top: 1px solid var(--border); background: var(--surface)">
      <a href="ConnectionForm.dc.html" class="btn btn-ghost" style="font-size: var(--fs-sm)">[[plus:14]]Nueva conexión…</a>
      <a href="ConnectionManager.dc.html" class="btn btn-ghost" style="font-size: var(--fs-sm)">[[import:14]]Importar…</a>
      <span style="flex: 1"></span>
      <a href="ConnectionManager.dc.html" class="btn btn-ghost" style="font-size: var(--fs-sm)">Gestionar conexiones</a>
    </div>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    const os = this.props.os ?? 'windows';
    const badge = (c) => `width: 28px; height: 28px; flex: none; border-radius: var(--r-sm); background: color-mix(in srgb, ${c} 16%, transparent); color: ${c}; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 11px; font-weight: 600`;
    let first = true;
    const item = ([name, sub, c, mono, safe]) => {
      const on = first; first = false;
      return { name, sub, mono, safe, open: false, badge: badge(c), href: 'ConnectedNoTab.dc.html', selected: on ? 'true' : 'false', isSel: on, cls: on ? 'focus-in' : '',
        bar: `width: 3px; align-self: stretch; margin: 8px 0; flex: none; border-radius: 2px; background: ${c}`,
        style: `height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 8px; border-radius: var(--r-sm); color: var(--text); text-decoration: none; background: ${on ? 'var(--sel)' : 'transparent'}` };
    };
    const groups = [
      { name: 'Local', items: [['Ventas', 'SQLite · C:\\datos\\ventas.db · Desarrollo', '#2f7dd6', 'SQ', false], ['Ventas copia', 'SQLite · C:\\datos\\ventas_copia.db · Pruebas', '#2e9e52', 'SQ', false]].map(item) },
      { name: 'Servidores', items: [['Producción', 'PostgreSQL · db.interno:5432/ventas · Producción', '#c4302b', 'PG', true], ['Producción (MySQL)', 'MySQL · db.interno:3306/ventas · Producción', '#c4302b', 'MY', false], ['Eventos', 'MongoDB · localhost:27017/eventos · Desarrollo', '#9b6ad6', 'MG', false]].map(item) }
    ];
    return { theme: this.props.theme ?? 'b', os, groups, enter: os === 'macos' ? '↩' : 'Intro' };
  }
}
