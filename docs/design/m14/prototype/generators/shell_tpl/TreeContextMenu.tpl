Menú de tabla
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="DataGrid" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="DataGrid.dc.html" aria-label="Cerrar el menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>

  <div class="menu" role="menu" aria-label="Acciones de clientes" style="left: 206px; top: 226px; width: 280px">
    <div style="height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: var(--fs-xs); color: var(--text-dim)">
      [[table:13:color: var(--obj-table)]]<span class="mono">clientes</span><span>· tabla de Ventas</span>
    </div>
    <a href="DataGrid.dc.html" role="menuitem" class="mi">[[table]]Abrir datos<span class="k">{{k.open}}</span></a>
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">[[query]]Nueva consulta sobre clientes</a>
    <a href="StructureView.dc.html" role="menuitem" class="mi">[[format]]Ver estructura</a>
    <a href="TableDesigner.dc.html" role="menuitem" class="mi">[[edit]]Modificar tabla…<span class="k">{{k.alter}}</span></a>
    <a href="IndexManager.dc.html" role="menuitem" class="mi">[[key]]Índices y restricciones</a>
    <div class="msep" role="separator"></div>
    <a href="#" role="menuitem" aria-haspopup="menu" aria-expanded="true" class="mi on focus-in">[[code]]Generar SQL<span class="k" style="display: flex">[[chevron-right:14]]</span></a>
    <a href="#" role="menuitem" class="mi">[[copy]]Copiar nombre<span class="k">{{k.copy}}</span></a>
    <a href="DdlView.dc.html" role="menuitem" class="mi">[[copy]]Copiar DDL<span class="k">{{k.ddl}}</span></a>
    <div class="msep" role="separator"></div>
    <a href="ImportWizard.dc.html" role="menuitem" class="mi">[[import]]Importar datos…</a>
    <a href="ExportMenu.dc.html" role="menuitem" class="mi">[[export]]Exportar…<span class="k">{{k.export}}</span></a>
    <a href="DataGenerator.dc.html" role="menuitem" class="mi">[[plus]]Generar datos de prueba…</a>
    <a href="ErDiagram.dc.html" role="menuitem" class="mi">[[er]]Diagrama ER de esta tabla</a>
    <a href="#" role="menuitem" class="mi">[[refresh]]Refrescar<span class="k">{{k.refresh}}</span></a>
    <div class="msep" role="separator"></div>
    <div class="lbl" role="presentation" style="padding: 4px 10px 2px">Zona de peligro</div>
    <a href="ConfirmDrop.dc.html" role="menuitem" class="mi danger">[[eraser]]Vaciar tabla…<span class="k" style="color: var(--text-dim)">TRUNCATE</span></a>
    <a href="ConfirmDrop.dc.html" role="menuitem" class="mi danger">[[trash]]Eliminar tabla…<span class="k">{{k.del}}</span></a>
  </div>

  <div class="menu" role="menu" aria-label="Generar SQL" style="left: 490px; top: 410px; width: 250px">
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">SELECT<span class="k">en una consulta nueva</span></a>
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">INSERT</a>
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">UPDATE</a>
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">DELETE</a>
    <div class="msep" role="separator"></div>
    <a href="DdlView.dc.html" role="menuitem" class="mi">CREATE TABLE (DDL)</a>
    <div class="msep" role="separator"></div>
    <div class="help" style="padding: 4px 10px 6px; line-height: 1.4">Se abre en una pestaña nueva sobre Ventas; no se ejecuta nada.</div>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    return { theme: this.props.theme ?? 'b', os, k };
  }
}
