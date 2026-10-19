Nueva conexión · túnel SSH
<div class="th th-{{theme}}" data-os="{{os}}" style="width: 1280px; height: 800px; position: relative; overflow: hidden; background: var(--chrome)">
  <div style="position: absolute; inset: 0">
    <dc-import name="ConnectionForm" theme="{{theme}}" os="{{os}}" engine="postgres" ssh="true" hint-size="1280px,800px"></dc-import>
  </div>
</div>
---PROPS---
{"theme":{"editor":"enum","options":["b","a","c","rosa"],"default":"b"},"os":{"editor":"enum","options":["windows","macos","linux"],"default":"windows"},"$preview":{"width":1280,"height":800}}
---JS---
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'b', os: this.props.os ?? 'windows' };
  }
}
