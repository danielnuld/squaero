      <div role="toolbar" aria-label="Acciones de la consulta" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <a href="DropdownOpen.dc.html" class="{{rc.cls}}" role="button" aria-haspopup="listbox" aria-expanded="{{rc.open}}" title="Conexión y base de esta pestaña" style="height: var(--h-control); display: inline-flex; align-items: center; gap: 7px; padding: 0 8px; text-decoration: none; font-size: var(--fs-md)"><span style="{{rc.dot}}"></span><span style="font-weight: 600">{{rc.name}}</span><span style="color: var(--text-dim)">· {{rc.db}}</span>[[chevron-down:12:color: var(--text-dim)]]</a>
        <sc-if value="{{rc.safe}}"><span class="chip" title="Conexión de solo lectura" style="height: 22px; background: var(--hover); color: var(--text-dim)">[[lock:12]]Solo lectura</span></sc-if>
        <span style="display: inline-flex; margin-left: 4px">
          <a href="#" class="btn btn-primary" title="Ejecutar la sentencia del cursor ({{k.run}})" style="border-radius: var(--r-sm) 0 0 var(--r-sm)"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"></path></svg>Ejecutar sentencia</a>
          <a href="#" class="btn btn-primary" aria-haspopup="menu" aria-label="Alcance: sentencia actual, selección o script completo ({{k.script}})" style="border-radius: 0 var(--r-sm) var(--r-sm) 0; border-left: 1px solid color-mix(in srgb, var(--accent-fg) 40%, transparent); padding: 0 6px">[[chevron-down:12]]</a>
        </span>
        <button type="button" class="btn btn-icon" disabled aria-label="Detener (Esc) · no hay nada en curso" title="Detener (Esc) · no hay nada en curso" style="opacity: .45">[[stop:15]]</button>
        <span style="width: 1px; height: 20px; background: var(--border); margin: 0 4px"></span>
        <a href="#" class="btn btn-ghost" title="Formatear ({{k.fmt}})">[[format]]Formatear</a>
        <span class="seg" role="radiogroup" aria-label="Modo de transacción"><span role="radio" aria-checked="true" class="on">Auto</span><span role="radio" aria-checked="false">Manual</span></span>
        <span style="flex: 1"></span>
        <a href="TxControlsMenu.dc.html" class="btn btn-ghost" aria-haspopup="menu" title="Plan, historial, abrir y guardar .sql, snippet, variables">Más[[more:15]]</a>
      </div>
