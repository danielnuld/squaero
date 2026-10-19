Eliminar conexión
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="ConnectionManager" theme="{{theme}}" os="{{os}}" deleted="{{isToast}}" hint-size="1280px,800px"></dc-import>
  </div>
  <sc-if value="{{isDialog}}">
    <div class="dlg-scrim">
      <div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dc-title" aria-describedby="dc-desc" style="width: 460px">
        <div class="dlg-h">
          <span id="dc-title" style="flex: 1">¿Eliminar la conexión «Ventas copia»?</span>
          <a href="ConnectionManager.dc.html" class="btn btn-icon" aria-label="Cancelar (Esc)">[[close:16]]</a>
        </div>
        <div class="dlg-b">
          <p id="dc-desc" style="margin: 0; line-height: 1.5">Se quita de la lista con su contraseña guardada y su túnel SSH. <strong>La base de datos no se toca:</strong> <span class="mono" style="font-size: var(--fs-sm)">C:\datos\ventas_copia.db</span> sigue en su sitio.</p>
          <p class="help" style="margin: 0; line-height: 1.5">No está conectada, así que no se cierra ninguna sesión. Podrás deshacerlo durante 10 s.</p>
        </div>
        <div class="dlg-f">
          <span class="help"><span class="kbd">Esc</span> cancela</span>
          <span style="flex: 1"></span>
          <span class="dlg-actions" style="{{act}}">
            <a href="ConnectionManager.dc.html" class="btn btn-danger">Eliminar conexión</a>
            <a href="ConnectionManager.dc.html" class="btn focus">Cancelar</a>
          </span>
        </div>
      </div>
    </div>
  </sc-if>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"variant":{"editor":"enum","options":["dialog","toast"],"default":"dialog"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    const os = this.props.os ?? 'windows';
    const v = this.props.variant ?? 'dialog';
    return { theme: this.props.theme ?? 'b', os, isDialog: v === 'dialog', isToast: v === 'toast', act: os === 'windows' ? '' : 'flex-direction: row-reverse' };
  }
}
