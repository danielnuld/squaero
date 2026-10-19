      <div role="toolbar" aria-label="Acciones de {{obj}}" style="height: 44px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; border-bottom: 1px solid var(--border)">
        <span class="seg" role="tablist" aria-label="Vista del objeto">
          <a href="DataGrid.dc.html" role="tab" aria-selected="true" class="on">Datos</a>
          <a href="StructureView.dc.html" role="tab" aria-selected="false">Estructura</a>
          <a href="IndexManager.dc.html" role="tab" aria-selected="false">Índices</a>
          <a href="DdlView.dc.html" role="tab" aria-selected="false">DDL</a>
        </span>
        <span style="width: 1px; height: 20px; background: var(--border); margin: 0 4px"></span>
        <a href="DataFilterCondition.dc.html" class="btn btn-ghost" title="Filtrar la tabla ({{k.filter}})">[[filter]]Filtrar</a>
        <a href="DataFilterCondition.dc.html" class="btn btn-ghost" title="Ordenar ({{k.sort}})">[[sort]]Ordenar</a>
        <a href="GridColumnFilter.dc.html" class="btn btn-ghost" title="Buscar en las filas cargadas ({{k.find}})">[[search]]Buscar en la página</a>
        <a href="GridEditMode.dc.html" class="btn btn-ghost" title="Añadir fila ({{k.row}} en la última fila)">[[plus]]Fila</a>
        <span style="flex: 1"></span>
        <a href="GridTransposed.dc.html" class="btn btn-icon" aria-label="Transponer" title="Transponer">[[transpose:16]]</a>
        <a href="PinnedResult.dc.html" class="btn btn-icon" aria-label="Fijar resultado" title="Fijar resultado">[[pin:16]]</a>
        <a href="CompareMenu.dc.html" class="btn btn-icon" aria-label="Comparar con…" title="Comparar con…">[[compare:16]]</a>
        <a href="Chart.dc.html" class="btn btn-icon" aria-label="Graficar" title="Graficar">[[chart:16]]</a>
        <a href="ExportMenu.dc.html" class="btn btn-ghost" aria-haspopup="menu" title="Exportar ({{k.export}})">[[export]]Exportar[[chevron-down:12]]</a>
        <a href="SyncMenu.dc.html" class="btn btn-icon" aria-label="Más acciones: importar, generar, transferir, sincronizar" aria-haspopup="menu" title="Más acciones">[[more:16]]</a>
      </div>
