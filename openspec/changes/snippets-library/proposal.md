## Why

`snippets-save-and-palette` (#320/#321) resolvió *guardar* y *encontrar*, y dejó
escrito que «la biblioteca —editar el cuerpo, etiquetas, duplicar— va en un
cambio aparte». Este es ese cambio. Lo disparan cuatro molestias del uso diario,
tres de ellas fallos de verdad:

1. **Abrir un snippet a veces no hace nada.** `insertSnippet` salta a
   `lastQueryId()` sin comprobar que la pestaña siga existiendo, y `lastQueryId`
   nunca se limpia al cerrarla. Tras cerrar la consola, `activeId` apunta a una
   pestaña muerta: el workspace se queda en blanco y el texto se pierde en
   silencio. La rama que abriría una pestaña nueva solo corre si **nunca** hubo
   una consulta activa, que es el único caso que hoy funciona.
2. **Abrir un snippet contamina la consulta en curso.** La acción por defecto
   inserta en el cursor, encima de lo que se estaba escribiendo. Mezclar dos
   consultas en un editor es peligroso: lo que se ejecuta deja de ser lo que se
   creía tener delante.
3. **No se pueden buscar.** El panel pinta la lista entera; con cuarenta
   snippets es scroll.
4. **No se puede editar el cuerpo.** Solo renombrar: corregir un `WHERE` obliga
   a insertar, editar, volver a guardar y borrar el viejo.

## What Changes

El fondo del cambio es repartir el trabajo entre las tres superficies que hoy
intentan hacer lo mismo: la **paleta** (`Ctrl+J`) es acceso rápido, el **panel**
es gestión, y la **pestaña de consulta** es trabajo. De ahí sale todo lo demás.

- **Abrir lleva a una pestaña propia**, no al cursor. Una pestaña por snippet:
  si ya está abierta se reenfoca en vez de duplicarse, con el mismo patrón de
  dedup por clave que `openTool` ya usa. La consulta en la que se estaba
  trabajando no se toca nunca.
- **Insertar en el cursor sigue existiendo** como acción secundaria (menú de la
  fila y `Mod+Enter` en la paleta), y su salto a la última consulta activa
  comprueba que esa pestaña siga viva.
- **La barra de pestañas se vuelve un `tablist` de verdad** (`role="tab"`,
  `aria-selected`, tabindex móvil y flechas). Hoy son `div`s sin roles: ni un
  lector de pantalla ni una prueba pueden decir qué pestaña está activa, que es
  justo el contrato de «una pestaña por snippet».
- **Editar y guardar de vuelta desde esa pestaña**, sin atajos nuevos: en una
  pestaña ligada a un snippet, el campo «Guardar como» de la barra del editor se
  precarga con su nombre. `Enter` con el nombre intacto **actualiza** el snippet;
  cambiarlo guarda uno **nuevo**. La pestaña marca cuando tiene cambios sin
  guardar.
- **Panel maestro-detalle con buscador** por nombre **y cuerpo** —lo que resuelve
  el «sé que escribí un `LEFT JOIN` a facturas, pero no cómo lo llamé»—, con
  renombrar, duplicar, insertar y borrar en un menú `⋯`, e importar/exportar al
  pie.
- **El panel no lleva editor.** Deliberado: editar pasa por la pestaña, donde ya
  hay CodeMirror, autocompletado de esquema y el botón de ejecutar. Un solo
  camino de edición.

## Capabilities

### New Capabilities

- `snippet-library`: gestionar el conjunto guardado —buscarlo, abrirlo para
  trabajar, editarlo y devolver los cambios— sin perder de vista lo que ya se
  estaba escribiendo.

### Modified Capabilities

Ninguna. `snippet-capture` y `snippet-recall` siguen como están; lo que cambia
es qué hace la activación por defecto de un snippet, recogido aquí.

## Impact

- **Solo frontend.** `utils/tabs.ts` (`snippetId` y `openSnippetTab`),
  `utils/snippets.ts` (`updateSnippetBody`, `searchSnippets`), `App.tsx`
  (acciones, paleta, barra de pestañas, flujo de nombrado),
  `components/SnippetsPanel.tsx` (reescrito), `styles.css` y los dos catálogos
  de mensajes.
- **Sin cambios de modelo ni de almacenamiento**: se sigue guardando el mismo
  `{ id, name, body }` bajo `quaero.snippets`, así que los sets exportados
  anteriores importan igual.
- **Sin atajos nuevos.** `Ctrl+S` se descartó a propósito: `shortcuts.ts` ya
  avisa de que el host del webview puede reclamarlo, que es por lo que #320
  eligió `Ctrl+Shift+S`.
- **El riesgo real está en los roles ARIA de la barra de pestañas**, lo único que
  se toca fuera de snippets. Se cubre corriendo la suite e2e entera, no solo la
  de snippets.
- Fuera de alcance, cada uno su issue: carpetas y etiquetas, huecos `${…}` al
  abrir, confirmar el cierre de una pestaña con cambios sin guardar, y
  sincronizar entre equipos (importar/exportar ya lo cubre a mano).
- Issues: #338 (este cambio), #320 y #129 (origen).
