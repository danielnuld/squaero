Menú de pestaña
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="DataGrid" theme="{{theme}}" os="{{os}}" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="DataGrid.dc.html" aria-label="Cerrar el menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>

  <div class="menu" role="menu" aria-label="Acciones de la pestaña clientes" style="left: 470px; top: 70px; width: 270px">
    <a href="ConnectedNoTab.dc.html" role="menuitem" class="mi on focus-in">[[close]]Cerrar<span class="k">{{k.close}}</span></a>
    <a href="DataGrid.dc.html" role="menuitem" class="mi"><span style="width: 15px"></span>Cerrar las demás</a>
    <a href="DataGrid.dc.html" role="menuitem" class="mi"><span style="width: 15px"></span>Cerrar las de la derecha</a>
    <a href="ConnectedNoTab.dc.html" role="menuitem" class="mi"><span style="width: 15px"></span>Cerrar todas<span class="k">{{k.closeAll}}</span></a>
    <div class="msep" role="separator"></div>
    <a href="#" role="menuitem" class="mi">[[pin]]Fijar pestaña</a>
    <a href="#" role="menuitem" class="mi">[[copy]]Duplicar</a>
    <span role="menuitem" aria-disabled="true" class="mi dis" title="Solo las pestañas de consulta se pueden renombrar" style="height: auto; min-height: 28px; padding-top: 3px; padding-bottom: 3px">[[edit]]<span style="display: flex; flex-direction: column"><span>Renombrar…</span><span style="font-size: var(--fs-xs)">Solo pestañas de consulta</span></span></span>
    <a href="#" role="menuitem" class="mi">[[table]]Mostrar en el explorador</a>
    <a href="#" role="menuitem" class="mi">[[copy]]Copiar nombre «clientes»</a>
    <div class="msep" role="separator"></div>
    <span role="menuitem" aria-disabled="true" class="mi dis" title="Solo para pestañas de consulta" style="height: auto; min-height: 28px; padding-top: 3px; padding-bottom: 3px">[[history]]<span style="display: flex; flex-direction: column"><span>Historial local…</span><span style="font-size: var(--fs-xs)">Solo pestañas de consulta</span></span></span>
    <div class="msep" role="separator"></div>
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">[[plus]]Nueva consulta<span class="k">{{k.newq}}</span></a>
    <a href="#" role="menuitem" class="mi">[[refresh]]Reabrir pestaña cerrada<span class="k">{{k.reopen}}</span></a>
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
