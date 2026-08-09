## 1. Modelo: nombre propuesto y nombres repetidos

- [x] 1.1 `proposedSnippetName(sql, engine)` en `utils/snippets.ts`: la tabla que
      lee la consulta (`queryEditTarget`), o un nombre neutro cuando no hay una
      identificable
- [x] 1.2 `uniqueSnippetName(list, name)`: devuelve el nombre tal cual si está
      libre, o su variante numerada — nunca pisa un snippet existente
- [x] 1.3 El id creado sale de `nextSnippetId` antes de añadir, para que el aviso
      pueda deshacerlo — sin cambiar la firma de `addSnippet` ni sus llamadores
- [x] 1.4 Pruebas: `SELECT` de una tabla, con `db`/`schema`, join sin tabla
      identificable, DDL, nombre libre, nombre repetido una y varias veces

## 2. Guardar desde el editor

- [x] 2.1 `SqlEditor`: tick de guardado que resuelve el trozo con `pickRunTarget`
      y lo devuelve con su alcance, calcado del tick de ejecutar
- [x] 2.2 Campo de nombre en la barra del editor: aparece enfocado con el nombre
      propuesto, `Enter` acepta, `Esc` cancela, y desaparece al terminar
- [x] 2.3 Botón **Guardar** en la barra, junto a Ejecutar / Formatear / Historial
- [x] 2.4 Atajo `Mod+Shift+S` en `utils/shortcuts.ts` (libre en `matchShortcut`),
      visible en `F1`
- [x] 2.5 Aviso de confirmación con el alcance guardado y **Deshacer**
- [x] 2.6 Texto vacío: no se crea nada y se dice por qué
- [x] 2.7 Pruebas de componente: guardar documento, guardar selección, cancelar
      con `Esc`, nombre repetido, deshacer

## 3. Paleta de snippets

- [x] 3.1 `paletteMode` acepta `"snippets"`; `Mod+J` lo abre (atajo nuevo,
      visible en `F1`)
- [x] 3.2 Vista previa del cuerpo del elemento resaltado en la paleta
- [x] 3.3 Acciones con modificador: `Enter` insertar, `Shift+Enter` ejecutar,
      `Mod+Enter` abrir en pestaña nueva
- [x] 3.4 Estados honestos: sin snippets guardados, y sin coincidencias
- [x] 3.5 Ejecutar sin conexión utilizable falla como falla ejecutar una consulta
- [x] 3.6 Pruebas: filtrado, vista previa al mover el resaltado, las tres
      acciones, y los dos estados vacíos

## 4. Idioma

- [x] 4.1 Todo el texto nuevo por `t()`, con su espejo en `messages/en.ts`
- [x] 4.2 Las pruebas se fijan al español, como el resto de la suite

## 5. Cierre

- [x] 5.1 `pnpm test` verde
- [ ] 5.2 Probar a mano el ciclo completo en la app (escribir, guardar, `Mod+J`,
      insertar). Cubierto por pruebas de componente sobre el `App` real con
      CodeMirror, pero no ejecutado en la ventana nativa
- [x] 5.3 Commits en Conventional Commits referenciando #320
