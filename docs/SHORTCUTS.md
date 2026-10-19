# Atajos de teclado

Pulsa **F1** dentro de la app para ver esta misma lista (la ayuda en pantalla se
genera desde la fuente única `frontend/src/utils/shortcuts.ts`, así que no se
desincroniza del comportamiento).

`Mod` es **Ctrl** en Windows/Linux y **⌘ (Cmd)** en macOS.

## Generales

Funcionan desde cualquier parte de la ventana. Se pueden **cambiar** en
**Ajustes → Atajos de teclado** (#684); la ayuda (F1) y la barra de menús muestran siempre
la tecla vigente.

| Acción | Atajo |
|---|---|
| Nueva pestaña | `Mod`+T (o `Mod`+Alt+T) |
| Cerrar la pestaña activa | `Mod`+W (o `Mod`+Alt+W) |
| Siguiente pestaña | Ctrl+AvPág (PageDown) |
| Pestaña anterior | Ctrl+RePág (PageUp) |
| Refrescar datos y árbol | F5 |
| Paleta de comandos | `Mod`+K |
| Buscar objetos (tablas, vistas…) | `Mod`+P |
| Buscar snippets guardados | `Mod`+J |
| Guardar la consulta como snippet | `Mod`+Shift+S |
| Confirmar los cambios de la rejilla | `Mod`+S |
| Buscar en el editor | `Mod`+F |
| Abrir el filtro de una tabla con una condición nueva | `Mod`+Shift+L |
| Abrir el filtro de una tabla con un orden nuevo | `Mod`+Shift+O |
| Confirmar la transacción abierta | `Mod`+Alt+C |
| Revertir la transacción abierta | `Mod`+Alt+R |
| Acercar / alejar / restablecer el zoom de la interfaz | `Mod`++ / `Mod`+- / `Mod`+0 |
| Cambiar tema claro/oscuro | `Mod`+Alt+L |
| Mostrar/ocultar esta ayuda | F1 |

## Editor SQL

Con el foco en el editor (CodeMirror). Estas teclas no se pueden reasignar.

| Acción | Atajo |
|---|---|
| Ejecutar la sentencia actual (o la selección) | `Mod`+Enter |
| Ejecutar el script completo | `Mod`+Shift+Enter |
| Formatear la consulta | `Mod`+Shift+F |
| Plegar / desplegar la sentencia o el comentario | `Mod`+Shift+[ / `Mod`+Shift+] |
| Plan de ejecución (EXPLAIN) | `Mod`+Shift+E |
| Abrir las sugerencias de autocompletado | Ctrl+Espacio |
| Aceptar la sugerencia; si no hay, expandir una abreviatura de plantilla | Tab |
| Saltar al siguiente / anterior marcador de una plantilla | Tab / Mayús+Tab |
| Ir a la definición del identificador | F12 o `Mod`+clic |
| Buscar los usos del identificador | Mayús+F12 o Alt+F7 |
| Saltar al uso siguiente / anterior (con los usos marcados) | F3 / Mayús+F3 |
| Quitar la marca de los usos | Esc |
| Renombrar el identificador en el script | F2 o Mayús+F6 |
| Añadir la siguiente coincidencia de la selección (multicursor) | `Mod`+D |
| Seleccionar todas las coincidencias de la selección | `Mod`+Shift+L |
| Añadir un cursor arriba / abajo | `Mod`+Alt+↑ / ↓ |
| Añadir un cursor donde se hace clic (fuera de un identificador con definición) | `Mod`+clic |
| Selección rectangular | Alt+arrastrar |

`Mod`+D y `Mod`+Shift+L son también atajos de la rejilla y del filtro: cada uno
actúa donde está el foco (el filtro solo existe en una pestaña de tabla, que no
tiene editor).

## Rejilla de resultados

Cuando el foco está en ella:

| Acción | Atajo |
|---|---|
| Moverse entre celdas | Flechas, Inicio, Fin, RePág, AvPág |
| Editar la celda seleccionada (en modo edición) | Enter |
| Marcar todas las filas visibles | `Mod`+A |
| Seleccionar un bloque de celdas | Mayús+flechas, Mayús+clic o arrastrar |
| Copiar las filas marcadas, o el bloque de celdas como TSV | `Mod`+C |
| Duplicar las filas marcadas como filas nuevas | `Mod`+D |
| Pegar filas como filas nuevas | `Mod`+V |
| Desmarcar, o reducir el bloque a la celda con el foco | Esc |
| Ver la fila relacionada (clave foránea) | `Mod`+B o `Mod`+clic |
| Abrir/cerrar «Buscar en la página» (solo las filas cargadas) | `Mod`+F |
| Marcar para borrar las filas seleccionadas (en modo edición) | Supr (Delete) |
| Revisar y guardar los cambios | `Mod`+S |

En el **panel de filtro** de una tabla, Mayús+Enter añade otra condición (Enter
aplica el filtro).

## Notas

- Los atajos de la rejilla actúan sobre las filas marcadas o, si no hay ninguna,
  sobre las filas del bloque de celdas seleccionado. Sin nada que copiar o duplicar, la
  combinación se deja al navegador. Duplicar y pegar solo funcionan en una tabla
  con clave primaria.
- El formateo usa el dialecto del motor de la conexión activa y deja intacta una
  consulta de MongoDB (mongosh no es SQL).
- **Autocompletar** sugiere según el contexto: tablas y columnas de la conexión
  activa, alias, CTEs, joins por clave foránea y palabras clave de la cláusula.
- `Mod`+T y `Mod`+W abren y cierran pestañas como en un navegador; la app los
  intercepta antes que el webview. Las formas con `Alt` siguen funcionando para
  quien las aprendió.
- El **zoom** escala el texto, el espacio y los controles de la app, no la
  página; también se ajusta en Ajustes → Apariencia y con un clic en la barra de
  estado se restablece.
- En Windows y Linux la **barra de menús nativa** (Archivo, Editar, Ver,
  Consulta, Herramientas, Ventana, Ayuda) muestra estos mismos atajos junto a
  cada orden; las teclas las sigue atendiendo la interfaz, así que nunca se
  disparan dos veces.
- El **tema** también se cambia con el botón de la barra de estado; la preferencia
  (sistema / claro / oscuro) se recuerda entre sesiones.
