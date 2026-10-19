Menú Herramientas
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="DataGrid" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="DataGrid.dc.html" aria-label="Cerrar el menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>
  <div style="position: absolute; left: 0; top: 0; width: 1280px; z-index: 5">
    <dc-import name="TitleBar" theme="{{theme}}" os="{{os}}" notif="1" menu-open="Herramientas" window-title="clientes — Ventas — Squaero" hint-size="1280px,38px"></dc-import>
  </div>

  <div class="menu" role="menu" aria-label="Herramientas" style="{{menuPos}}; width: 640px; padding: 4px 4px 0; display: flex; flex-direction: column">
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px">
      <sc-for list="{{cols}}" as="col" hint-placeholder-count="2">
        <div style="display: flex; flex-direction: column">
          <sc-for list="{{col}}" as="g" hint-placeholder-count="2">
            <div role="group" aria-label="{{g.name}}" style="display: flex; flex-direction: column; padding-bottom: 4px">
              <div class="lbl" role="presentation" style="padding: 6px 10px 2px">{{g.name}}</div>
              <sc-for list="{{g.items}}" as="t" hint-placeholder-count="3">
                <a href="{{t.href}}" role="menuitem" aria-disabled="{{t.disabled}}" title="{{t.title}}" class="{{t.cls}}" style="{{t.style}}">
                  <span style="display: flex; flex: none">
                    <sc-if value="{{t.i.er}}">[[er]]</sc-if><sc-if value="{{t.i.qb}}">[[builder]]</sc-if><sc-if value="{{t.i.routines}}">[[function]]</sc-if><sc-if value="{{t.i.triggers}}">[[trigger]]</sc-if>
                    <sc-if value="{{t.i.notebook}}">[[notebook]]</sc-if><sc-if value="{{t.i.snippets}}">[[bookmark]]</sc-if><sc-if value="{{t.i.history}}">[[history]]</sc-if>
                    <sc-if value="{{t.i.search}}">[[search]]</sc-if><sc-if value="{{t.i.import}}">[[import]]</sc-if><sc-if value="{{t.i.export}}">[[export]]</sc-if><sc-if value="{{t.i.gen}}">[[plus]]</sc-if>
                    <sc-if value="{{t.i.transfer}}">[[transfer]]</sc-if><sc-if value="{{t.i.schema}}">[[compare]]</sc-if><sc-if value="{{t.i.sync}}">[[sync]]</sc-if><sc-if value="{{t.i.backup}}">[[backup]]</sc-if>
                    <sc-if value="{{t.i.monitor}}">[[monitor]]</sc-if><sc-if value="{{t.i.slow}}">[[clock]]</sc-if><sc-if value="{{t.i.users}}">[[users]]</sc-if>
                  </span>
                  <span style="flex: 1; min-width: 0; display: flex; flex-direction: column">
                    <span>{{t.label}}</span>
                    <sc-if value="{{t.na}}"><span style="font-size: var(--fs-xs); color: var(--text-dim)">{{t.reason}}</span></sc-if>
                  </span>
                  <span class="k">{{t.key}}</span>
                </a>
              </sc-for>
            </div>
          </sc-for>
        </div>
      </sc-for>
    </div>
    <div style="display: flex; align-items: center; gap: 6px; margin: 0 -4px; padding: 8px 14px; border-top: 1px solid var(--border); background: var(--surface); border-radius: 0 0 var(--r-md) var(--r-md)" class="help">
      <span style="flex: 1">Herramientas de Ventas · SQLite. Las no disponibles se explican al lado.</span>
      <span>También con <span class="kbd">{{palette}}</span></span>
    </div>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    const mk = ([key, label, keys, href, reason]) => {
      const i = {}; i[key] = true; const na = !!reason;
      return { i, label, key: keys ? K(keys) : '', href: na ? '#' : href, na, reason: reason ?? '', disabled: na ? 'true' : 'false', title: na ? `${label}: ${reason}` : label,
        cls: `mi${na ? ' dis' : ''}${key === 'er' ? ' on focus-in' : ''}`,
        style: `height: auto; min-height: 30px; padding-top: 3px; padding-bottom: 3px; align-items: center` };
    };
    const G = (name, items) => ({ name, items: items.map(mk) });
    const cols = [
      [G('Esquema', [['er', 'Diagrama ER', 'Ctrl+Mayús+D', 'ErDiagram.dc.html'], ['qb', 'Constructor de consultas', 'Ctrl+Mayús+B', 'QueryBuilder.dc.html'],
        ['routines', 'Procedimientos y funciones', '', 'Routines.dc.html', 'SQLite no tiene rutinas almacenadas'], ['triggers', 'Triggers', '', 'Triggers.dc.html']]),
       G('Consultas', [['notebook', 'Notebook SQL', 'Ctrl+Mayús+N', 'Notebook.dc.html'], ['snippets', 'Snippets', 'Ctrl+Mayús+J', 'SnippetsTool.dc.html'], ['history', 'Historial de consultas', 'Ctrl+Mayús+H', 'HistoryPanel.dc.html']]),
       G('Servidor', [['monitor', 'Monitor de servidor', '', 'ServerMonitor.dc.html', 'SQLite es un archivo: no hay servidor'], ['slow', 'Consultas lentas', '', 'SlowQueries.dc.html', 'SQLite no registra consultas lentas'],
        ['users', 'Usuarios y permisos', '', 'UsersGrants.dc.html', 'SQLite no tiene cuentas de usuario']])],
      [G('Datos', [['search', 'Buscar en los datos…', 'Ctrl+Mayús+F', 'DataSearch.dc.html'], ['import', 'Importar datos…', 'Ctrl+Mayús+I', 'ImportWizard.dc.html'], ['export', 'Exportar…', 'Ctrl+Mayús+X', 'ExportMenu.dc.html'],
        ['gen', 'Generar datos de prueba…', '', 'DataGenerator.dc.html'], ['transfer', 'Transferir a otra conexión…', '', 'TransferWizard.dc.html']]),
       G('Comparar y respaldar', [['schema', 'Comparar estructura…', '', 'SchemaSync.dc.html'], ['sync', 'Comparar datos…', '', 'DataDiff.dc.html'], ['backup', 'Respaldo y restauración…', '', 'BackupRestore.dc.html']])]
    ];
    const menuPos = os === 'linux' ? 'right: 44px; top: 38px' : os === 'macos' ? 'left: 300px; top: 2px' : 'left: 268px; top: 34px';
    return { theme: this.props.theme ?? 'b', os, cols, menuPos, palette: K('Ctrl+K') };
  }
}
