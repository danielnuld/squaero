Menú de conexión
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="DataGrid" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="DataGrid.dc.html" aria-label="Cerrar el menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>

  <div class="menu" role="menu" aria-label="Acciones de Ventas" style="left: 180px; top: 150px; width: 290px">
    <div style="height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: var(--fs-xs); color: var(--text-dim)">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #2f7dd6"></span><span style="color: var(--text); font-weight: 600">Ventas</span><span>· SQLite · main</span>
    </div>
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi on focus-in">[[query]]Nueva consulta<span class="k">{{k.newq}}</span></a>
    <a href="NewTableDesigner.dc.html" role="menuitem" class="mi">[[plus]]Nueva tabla…</a>
    <a href="ObjectList.dc.html" role="menuitem" class="mi">[[format]]Lista de objetos</a>
    <div class="msep" role="separator"></div>
    <a href="ErDiagram.dc.html" role="menuitem" class="mi">[[er]]Diagrama ER</a>
    <a href="DataSearch.dc.html" role="menuitem" class="mi">[[search]]Buscar en los datos…<span class="k">{{k.dsearch}}</span></a>
    <a href="ImportWizard.dc.html" role="menuitem" class="mi">[[import]]Importar…</a>
    <a href="BackupRestore.dc.html" role="menuitem" class="mi">[[backup]]Respaldar y restaurar…</a>
    <a href="ToolsMenu.dc.html" role="menuitem" class="mi">[[tools]]Más herramientas…</a>
    <div class="msep" role="separator"></div>
    <a href="#" role="menuitem" class="mi">[[copy]]Copiar nombre<span class="k">{{k.copy}}</span></a>
    <a href="#" role="menuitem" class="mi">[[refresh]]Refrescar<span class="k">{{k.refresh}}</span></a>
    <div class="msep" role="separator"></div>
    <a href="ConnectionForm.dc.html" role="menuitem" class="mi">[[edit]]Editar conexión…</a>
    <a href="Welcome.dc.html" role="menuitem" class="mi">[[unplug]]Desconectar</a>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
[[@keys]]
    k.dsearch = K('Ctrl+Mayús+F');
    return { theme: this.props.theme ?? 'b', os, k };
  }
}
