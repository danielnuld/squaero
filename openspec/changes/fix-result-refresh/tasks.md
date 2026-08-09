## 1. Refresco con la consulta que llenó la rejilla (#314)

- [x] 1.1 `reloadCurrent(id)`: re-ejecutar `results[id].pageSql` en su `offset`,
      no `tabs().tabs.find(...).sql`; sin `pageSql` (y sin `preview`) no ejecutar
      nada
- [x] 1.2 Dar a `run()` un `tabId` explícito (como `runPreviewPage`) para que el
      refresco no dependa de la pestaña enfocada
- [x] 1.3 Extraer el módulo puro que decide qué refrescar a partir del estado del
      resultado (`preview` → vista previa, `pageSql` → re-ejecución, nada → no-op)
- [x] 1.4 Pruebas de `refreshAction`: editor modificado tras correr, refresco en
      página N, vista previa de tabla y pestaña sin consulta
- [ ] 1.5 Pendiente: prueba de extremo a extremo del refresco pedido desde una
      pestaña de herramienta (necesita montar `App` con puente simulado); hoy solo
      queda cubierto el `tabId` explícito por lectura del código

## 2. La rejilla arranca arriba con un resultado nuevo (#313)

- [x] 2.1 Reiniciar la posición de scroll (señal y elemento) en el efecto que ya
      reinicia orden, filtros, selección y anchos al cambiar el resultado
- [x] 2.2 Sincronizar la señal con el elemento en `attachScroller`, que es por
      donde pasa toda remonta del scroller (el caso del error de sintaxis)
- [x] 2.3 Prueba de la ventana virtualizada: con `scrollTop` reiniciado, el rango
      visible de un resultado nuevo empieza en la fila 0

## 3. Informix: tipo de objeto sin relleno (#315)

- [x] 3.1 `ifx_list_tables` (`drivers/informix/src/metadata.c`): `TRIM()` sobre el
      `CASE` del tipo
- [x] 3.2 `objectListFor` (`frontend/src/utils/objectList.ts`): lo mismo en el SQL
      de Informix del alias `tipo`
- [x] 3.3 `parseTreeRows`: normalizar el valor recibido antes de clasificar
- [x] 3.4 Pruebas: `view`, `view ` (con relleno), `table`, valor desconocido; y el
      SQL de Informix generado por `objectListFor`
- [ ] 3.5 Verificar contra un servidor Informix real que las vistas caen en la
      carpeta Vistas y que el filtro de la lista de objetos las cuenta (el
      relleno `CHAR` está deducido del catálogo, no observado)

## 4. Cierre

- [x] 4.1 `ctest` verde (core, 51/51) y `pnpm test` verde (frontend, 1141
      pruebas; `tests/tools/packIcons.test.ts` ya fallaba antes de este cambio)
- [x] 4.2 Un commit por issue, en Conventional Commits, referenciando #313, #314
      y #315
