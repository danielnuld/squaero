# Tareas

Una fase = un PR. Cada fase queda verde (`pnpm test` + `pnpm e2e`) antes de
fusionarse y de empezar la siguiente.

## 1. Abrir en pestaña propia (fase A)

- [x] 1.1 `QueryTab` gana `snippetId?`, y `openSnippetTab` crea la pestaña con el
      nombre y el cuerpo del snippet, o **reenfoca** la que ya existe
- [x] 1.2 Abrir es la acción por defecto: en la paleta (`Enter`) y en el panel
- [x] 1.3 Insertar en el cursor pasa a secundaria (`Mod+Enter` y botón propio), y
      su salto a la última consulta comprueba que la pestaña siga viva
- [x] 1.4 La barra de pestañas es un `tablist` real: `role="tab"`,
      `aria-selected`, tabindex móvil y flechas
- [x] 1.5 Pruebas unitarias: dedup por `snippetId`, título, cuerpo y foco
- [x] 1.6 Prueba e2e: abrir un snippet no toca el texto de la pestaña en la que
      se estaba, y abrirlo dos veces no duplica la pestaña
- [x] 1.7 El panel ya no se cierra a sí mismo al abrir o insertar: hacerlo
      desmontaba el componente que aún estaba ejecutando el manejador
- [x] 1.8 Arreglado el arranque del puente e2e, que contaba los plugins cargados
      tras 250 ms fijos: `sqlite` carga el último de los cinco, así que en una
      máquina lenta su motor entero se saltaba y la corrida seguía en verde

## 2. Editar y guardar de vuelta (fase B)

- [x] 2.1 `updateSnippetBody` puro, con sus casos borde
- [x] 2.2 En una pestaña ligada, el campo «Guardar como» se precarga con el
      nombre del snippet
- [x] 2.3 `Enter` con el nombre intacto actualiza ese snippet; cambiarlo guarda
      uno nuevo sin tocar el original
- [x] 2.4 **Deshacer** restaura el cuerpo anterior tras una actualización (no
      borra el snippet, que es lo que hace tras una creación)
- [x] 2.5 La pestaña indica que tiene cambios sin guardar, y lo dice también en
      su nombre accesible
- [x] 2.6 Pruebas: unitarias del helper, y sobre el `App` real para los dos
      caminos (actualizar vs. guardar como nuevo)
- [x] 2.7 Prueba e2e: editar, guardar, recargar y reabrir conserva el cuerpo
      nuevo y no crea un segundo snippet

## 3. Biblioteca buscable (fase C)

- [x] 3.1 `searchSnippets` puro: nombre **y** cuerpo, insensible a mayúsculas,
      consulta vacía devuelve todo
- [x] 3.2 Panel maestro-detalle: lista filtrable a la izquierda, cuerpo completo
      a la derecha
- [x] 3.3 Una acción visible (**Abrir**); renombrar, duplicar, insertar y borrar
      en el menú `⋯`, que también abre con clic derecho sobre la fila
- [x] 3.4 Estados vacíos honestos y distintos: sin snippets guardados vs. sin
      coincidencias
- [x] 3.5 Navegación con ↑/↓ y `Enter`; importar/exportar al pie
- [x] 3.6 Pruebas: filtrado puro, y de componente para filtro, estados vacíos,
      detalle y acciones
- [x] 3.7 Retirado el «Guardar consulta actual» del panel: guardaba el documento
      entero bajo un nombre escrito a mano, sin alcance, sin aviso de colisión y
      sin deshacer — todo lo que la barra del editor sí hace desde #320

## 4. Idioma

- [x] 4.1 Todo el texto nuevo por `t()`, con espejo en `messages/en.ts`
- [x] 4.2 Las pruebas se fijan al español, como el resto de la suite

## 5. Cierre

- [x] 5.1 `pnpm test` verde en las tres fases
- [x] 5.2 `pnpm e2e` **entero** verde en las tres fases (no solo la de snippets):
      los roles nuevos de la barra de pestañas tocan a toda la app
- [x] 5.3 Probado a mano en la ventana nativa (WebView2, build x86): guardar
      desde la barra, `Ctrl+J` para abrirlo en su propia pestaña dejando intacta
      la consulta anterior, editar (aparece el punto de sin guardar),
      `Ctrl+Shift+S` con el nombre precargado y `Enter` para guardar de vuelta
      (el punto se va y no aparece copia numerada).
      **El panel no se pudo accionar ahí**: la entrada de ratón sintética no
      llega al contenido de WebView2 y el panel no tiene ruta de teclado —
      queda verificado en Chromium por la suite e2e
- [x] 5.5 Arreglado lo que solo se veía en la ventana nativa: el campo «Guardar
      como» no recibía el foco, así que el flujo que anuncia («Enter para
      guardar») metía el nombre del snippet en la consulta. `autofocus` no hace
      nada en un elemento insertado después del parseo; las pruebas lo tapaban
      porque enfocaban el campo antes de escribir
- [x] 5.4 Commits en Conventional Commits referenciando #338
