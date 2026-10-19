Ventana en Linux
<div class="th th-{{theme}}" data-os="linux" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="DataGrid" theme="{{theme}}" os="linux" hint-size="1280px,800px"></dc-import>
  </div>
  <a href="DataGrid.dc.html" aria-label="Cerrar el menú (Esc)" style="position: absolute; inset: 0; z-index: 4"></a>
  <span aria-hidden="true" class="focus" style="position: absolute; right: 44px; top: 5px; width: 32px; height: 28px; border-radius: var(--r-sm); background: var(--hover); z-index: 5"></span>

  <div class="menu" role="menu" aria-label="Menú principal" style="right: 16px; top: 38px; width: 280px">
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">[[query]]Nueva consulta<span class="k">Ctrl+T</span></a>
    <a href="ConnectionForm.dc.html" role="menuitem" class="mi">[[plug]]Nueva conexión…</a>
    <a href="EditorEmpty.dc.html" role="menuitem" class="mi">[[open]]Abrir .sql…<span class="k">Ctrl+O</span></a>
    <a href="#" role="menuitem" class="mi">[[save]]Guardar<span class="k">Ctrl+S</span></a>
    <div class="msep" role="separator"></div>
    <a href="ToolsMenu.dc.html" role="menuitem" aria-haspopup="menu" class="mi">[[tools]]Herramientas<span class="k" style="display: flex">[[chevron-right:14]]</span></a>
    <a href="#" role="menuitem" aria-haspopup="menu" class="mi">[[view]]Ver<span class="k" style="display: flex">[[chevron-right:14]]</span></a>
    <div class="msep" role="separator"></div>
    <a href="SettingsGeneral.dc.html" role="menuitem" class="mi">[[settings]]Preferencias<span class="k">Ctrl+,</span></a>
    <a href="ShortcutsHelp.dc.html" role="menuitem" class="mi">[[help]]Atajos de teclado<span class="k">Ctrl+?</span></a>
    <a href="SettingsAbout.dc.html" role="menuitem" class="mi">[[info]]Acerca de Squaero</a>
    <div class="msep" role="separator"></div>
    <a href="#" role="menuitem" class="mi"><span style="width: 15px"></span>Salir<span class="k">Ctrl+Q</span></a>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'b' };
  }
}
