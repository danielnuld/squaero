# Tareas

Una fase = un PR. Cada fase queda en verde (`pnpm test` + `pnpm e2e`) antes de
fusionarse y de empezar la siguiente. Plano: artboard «Prototipo · conexiones y
rejilla» del lienzo https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2 (pasos 2 a 4
de la nota).

## 1. Base pura y arreglo del reintento (fase A)

- [x] 1.1 `utils/rowPaste.ts`: `planPaste` (copia exacta por nombre, texto por
      cabecera o por posición, límite de 500, `wizard` con motivo, `pkMode`
      inicial según origen)
- [x] 1.2 `findConflicts`: clave conservada e índices únicos contra las filas
      cargadas y las demás pendientes; índices compuestos; NULL no choca
- [x] 1.3 `utils/editSession.ts`: `addInserts` por lote, `pkModes`, y que
      `buildPlan` omita la clave en los lotes «generar»
- [x] 1.4 `applyEdit`: al fallar, recordar la operación fallida, `txRollback` +
      `txBegin`, conservar lo pendiente; si `txBegin` falla, salir de edición
      con el mensaje (orquestación pura en `utils/editApply.ts`)
- [x] 1.5 Pruebas unitarias de 1.1–1.4 (mismas columnas, columnas de más y de
      menos, mayúsculas, texto con cabecera y sin ella, formas que van al
      asistente, NULL frente a cadena vacía, tabuladores dentro de valores
      en la copia exacta, clave compuesta)
- [x] 1.6 Prueba e2e contra MySQL real: tres inserciones, la segunda falla,
      corregir y reintentar deja exactamente tres filas (leer de la base con
      `readNombre`, no de la rejilla) — `e2e/edit-retry.spec.ts`, **verde en
      SQLite, PostgreSQL, MySQL e Informix**; comprobado en SQLite que falla con
      el `applyEdit` anterior

## 2. Copiar, marcar y duplicar (fase B)

- [x] 2.1 Señal `rowClipboard` en `App.tsx`; copiar filas (menú, barra y
      `Ctrl+C`) escribe el texto y guarda la copia exacta
- [ ] 2.2 `Ctrl+C` y `Ctrl+D` en el `onKeyDown` de `ResultGrid` (filas marcadas
      o fila de la celda seleccionada); comprobar en WebView2 que `Ctrl+D` llega
      — hecho y probado en jsdom y Chromium (e2e); **falta comprobarlo en la
      ventana nativa (WebView2)**
- [x] 2.3 `components/RowActionBar.tsx` en modo selección: contador, Copiar,
      Copiar como INSERT, Duplicar, Pegar N (desactivado si no hay copia) y
      Desmarcar; Escape desmarca. «Pegar N» pega la copia exacta de la app;
      el pegado desde el teclado y el texto de otros programas quedan para la
      fase C
- [x] 2.4 Menú contextual: copiar, copiar como INSERT y duplicar también con una
      sola fila marcada
- [x] 2.5 Pruebas de componente: barra con 1 y con N filas, atajos, duplicar no
      toca la copia exacta

## 3. Pegar como filas pendientes (fase C)

- [x] 3.1 `onPaste`: comparar con `rowClipboard.text`, `planPaste`, abrir la
      edición si hace falta, `addInserts`; si no es editable o
      `planPaste` devuelve `wizard`, el camino actual
- [x] 3.2 `RowActionBar` en modo pendientes: contador, conflictos, clave
      generar/conservar, «vacías como NULL» (solo con texto de fuera), Ver SQL,
      Descartar, Guardar e «Importar con el asistente…» — hecho como
      `components/PendingRowsBar.tsx`. **Ver SQL y Guardar son un solo botón,
      «Revisar y guardar»**: guardar ya pasa siempre por la vista previa del
      SQL, así que eran la misma acción. Más de 500 filas van al asistente sin
      aviso aparte (la spec lo recoge así)
- [x] 3.3 `ResultGrid`: `+` en la columna del número de fila de las pendientes
      (quita la fila), clave mostrada como `auto` en «generar», celdas en
      conflicto y fila fallida señaladas — la fila pendiente **conserva la ✕**
      que ya tenía para quitarla: un `+` que borra se lee al revés
- [x] 3.4 `loadUniqueIndexes` en segundo plano al entrar en edición (patrón de
      `loadFkLookups`), y `findConflicts` recalculado al editar una pendiente
- [x] 3.5 Aviso de columnas ignoradas al pegar entre tablas distintas
- [x] 3.6 Pruebas de componente: pegar crea pendientes, forma distinta abre el
      asistente, Guardar desactivado con conflicto y activado al corregir,
      cambiar la clave cambia el SQL de la vista previa, pegar dentro de un
      campo no se intercepta
- [x] 3.7 Repartir el e2e de pegado de #383 entre los dos caminos (filas
      pendientes y asistente) y añadir el e2e de copiar → pegar → corregir el
      email → guardar contra MySQL real — `paste-import.spec.ts` prueba ahora el
      asistente con una forma que no encaja, y `paste-rows.spec.ts` pega filas,
      las guarda y bloquea una clave repetida hasta corregirla: **verde en
      SQLite, PostgreSQL, MySQL e Informix**. `edit-retry.spec.ts` provoca el
      fallo con un id no numérico, porque la detección previa ya ataja el
      duplicado. Sigue sin probarse extremo a extremo un **índice único** real:
      la tabla de pruebas no tiene uno (lo cubren las pruebas unitarias)

## 4. Idioma

- [ ] 4.1 Todo el texto nuevo por `t()` con espejo en `messages/en.ts`, plurales
      incluidos («1 fila nueva», «2 filas nuevas»)
- [ ] 4.2 Recorrer el flujo con la app en inglés

## 5. Cierre

- [ ] 5.1 `pnpm test` y `pnpm typecheck` en verde en las tres fases
- [ ] 5.2 `pnpm e2e` **entero** en verde en las tres fases
- [ ] 5.3 Probado a mano en la ventana nativa (WebView2, build x86) contra el
      contenedor MySQL de pruebas y contra Informix: copiar y pegar en la misma
      tabla, entre dos tablas, desde una hoja de cálculo, duplicar, conflicto
      de único, fallo al guardar y reintento
- [ ] 5.4 Manual de usuario: sección de copiar, pegar y duplicar filas
- [ ] 5.5 Nota de la versión: qué pegados van ahora a filas y cuáles siguen al
      asistente
- [ ] 5.6 Commits en Conventional Commits referenciando el issue del cambio
