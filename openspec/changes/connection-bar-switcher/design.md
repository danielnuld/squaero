## Context

`components/ConnectionBar.tsx` (125 líneas) es hoy una fila con la conexión
enfocada (`.connbar-active`) más un `⏏`, y un desplegable (`.connbar-drop`) que
monta `ConnectionManager` entero. Recibe 12 props desde `App.tsx`
(`ConnectionManagerProps` + `openTick`) y las reenvía, cerrando el desplegable
tras conectar, crear o editar (`mergeProps`, no *spread*: con *spread* la lista
de conexiones se congelaba en el montaje).

Lo que ya existe y este cambio respeta:

- **Varias conexiones abiertas a la vez**: `openConns()` y `focusedDefId()` en
  `App.tsx`; `inConn(defId, fn)` enfoca y luego actúa.
- **Una sección de explorador por conexión** (#444): `For` sobre `openConns()`,
  cada una con `ObjectTree` y `--conn-accent`. La **cabecera de cada sección** ya
  trae el color, el nombre, y los botones de herramientas (🧰), refrescar (⟳) y
  desconectar (⏏, nombrado).
- **`ConnectionManager`** hace de lista y de gestor: grupos como `<details>` con
  su plegado persistido (`loadCollapsedGroups`), menú contextual para mover de
  grupo, exportar con casilla de contraseñas y aviso, e importar de DBeaver y
  Navicat.
- **`connbarOpenTick`**: `App` lo sube al guardar una conexión para reabrir el
  desplegable, porque la lista vivía dentro.
- **Herramientas globales**: `GLOBAL_TOOLS` en `utils/tabs.ts` (help, settings,
  connectionForm, history, snippets, notebook) abre una sola pestaña sin atarla a
  la conexión enfocada.

Decisiones ya tomadas con el usuario: **se mantienen las secciones apiladas** del
explorador, y **el gestor se va a su propia pestaña** dejando el desplegable para
buscar y conectar.

Plano: artboard «Prototipo · conexiones y rejilla» (opción A) del lienzo
https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2.

## Goals / Non-Goals

**Goals:**

- Ver de un vistazo qué hay abierto y en cuál estoy.
- Cambiar de conexión en un clic.
- Encontrar una conexión entre treinta escribiendo, no plegando grupos.
- Que la barra y la cabecera de sección dejen de decir lo mismo.

**Non-Goals:**

- Tocar el explorador por conexión (#444).
- El riel de iconos ni las pastillas sobre las pestañas (opciones B y C).
- Reordenar conexiones arrastrando.
- El formulario de conexión (va en `connection-form-redesign`).
- Cambiar el modelo guardado, los grupos o los formatos de importación.

## Decisions

### 1. Dos componentes con un papel cada uno

`ConnectionBar` queda **presentacional y estrecho**: recibe las conexiones
abiertas ya resueltas (`{ defId, name, driver, color, lost, sub }`), la enfocada,
y cuatro callbacks (`onFocus`, `onDisconnect`, `onReconnect`, `onPick`). El
desplegable de búsqueda vive dentro de ella.

`ConnectionManager` deja de tener «conectar» y pasa a ser **el contenido de la
pestaña**: lista completa, CRUD, mover de grupo, importar y exportar. Se monta en
`Panel`, como las demás herramientas.

*Alternativa descartada:* un solo componente con un modo «barra» y un modo
«pestaña». Es el patrón que acabó en el `RowActionBar`/`PendingRowsBar` de #517,
donde separarlos hizo las pruebas la mitad de largas.

### 2. El filtro del buscador, puro

`utils/connectionSearch.ts`:

- `matchesConnection(conn, query, engineLabel)` — compara nombre, etiqueta del
  motor, servidor y grupo, **sin distinguir mayúsculas ni acentos** (normalizar
  con `String.normalize("NFD")` y quitar diacríticos: «Nómina» tiene que salir al
  escribir «nomina»).
- `searchGroups(conns, query, openIds, labelOf)` — devuelve los grupos con sus
  coincidencias en el orden que ya usa `groupConnections` (sin grupo primero,
  luego alfabético), cada entrada marcando `isOpen`.

El «servidor» de una conexión sale de sus `params`: `host`+`port`, o `path` en
SQLite, o `server` en Informix. Eso es una función pura más,
`connectionTarget(conn)`, que **también usa la fila de la barra** para su
segunda línea, así que lo que se ve y lo que se busca no pueden divergir.

### 3. El monograma del motor

`engineMonogram(driver)` en `utils/connections.ts` (MY, PG, MS, IFX, MG, SQ, y
`DB` para uno desconocido). Los emoji de `engineIcon` **siguen** donde están: el
icono personalizado de una conexión y el resto de la app. Es la misma pieza que
pide `connection-form-redesign` para sus tarjetas de motor: **la añade el primero
de los dos cambios que se implemente**.

### 4. El gestor, herramienta global

`ToolKind` += `"connections"`, dentro de `GLOBAL_TOOLS` y con entrada en
`TOOL_CATALOG`. Se abre con `showTool("connections", …, { key: "connections" })`,
así que la deduplicación por clave que ya existe garantiza **una sola pestaña**.

Con la lista fuera del desplegable, **`connbarOpenTick` deja de tener sentido**:
guardar una conexión ya no tiene que reabrir nada. Se retira, y con él el efecto
que lo escuchaba en la barra.

### 5. Qué acción vive dónde

| Acción | Sitio |
|---|---|
| Ver qué hay abierto, enfocar | fila de la barra |
| Desconectar, reconectar | fila de la barra (y ⏏ de la sección, que ya estaba) |
| Buscar y abrir una guardada | desplegable del `+` |
| Crear, editar, borrar, mover de grupo, importar, exportar | pestaña «Conexiones» |
| Herramientas, refrescar, plegar, base activa | cabecera de la sección (#444) |

La barra **no** repite herramientas ni refrescar: esa era una de las quejas.

### 6. Accesibilidad y teclado

La lista es un `role="listbox"`/`option` con `aria-selected` en la enfocada, y las
flechas mueven el foco entre filas. El desplegable es un `role="dialog"` con el
campo de búsqueda enfocado al abrir, ↑/↓ para recorrer resultados, Enter para
abrir el resaltado y Escape para cerrar — el mismo patrón que la paleta de
comandos, que ya tiene ese comportamiento resuelto.

### 7. Lo que cambia para las pruebas y las capturas

El helper `connect()` del e2e abre la conexión por «Elegir conexión» → «Nueva
conexión» → nombre del motor. Con la barra nueva pasa a ser: `+` → escribir →
elegir. Es **un solo sitio** (`e2e/support/app-actions.ts`), y de ahí cuelga toda
la suite, así que se cambia una vez y se corre entera. `connection-form.spec.ts`
también entra por ahí.

## Risks / Trade-offs

- **[Riesgo] Con muchas conexiones abiertas la lista come el explorador** →
  Cada fila mide 44 px; por encima de cinco abiertas la lista tiene su propio
  scroll con altura máxima, y el explorador conserva el resto. Medido en el
  prototipo con tres.
- **[Riesgo] El gesto de conectar cambia para todo el mundo** → Es el objetivo
  del cambio, pero toca el manual, las capturas y el helper del e2e. Va todo en
  la misma entrega.
- **[Riesgo] Quitar `connbarOpenTick` puede dejar «guardar» sin señal visible**
  → La conexión nueva aparece en la pestaña del gestor, que es donde se guardó, y
  en el buscador. Cubierto con una prueba.
- **[Trade-off] Dos sitios para desconectar** (fila y cabecera de sección) → Se
  mantiene a propósito: la fila es donde está mirando quien cambia de conexión, y
  la cabecera es la que resolvió el «no hay opción de desconectar» de #251.
- **[Riesgo] Normalizar acentos a mano** → Se cubre con pruebas de «Nómina» vs
  «nomina» y de mayúsculas, que es donde esto falla en la práctica.

## Migration Plan

Sin migración de datos: no cambian `Connection`, los grupos ni los ficheros de
importación. Tres PRs (ver tasks.md). Para revertir basta con revertirlos; lo
único que desaparece del almacenamiento es nada, y el plegado de grupos
(`quaero.connGroups`) lo sigue usando la pestaña.

## Open Questions

- ¿La fila de la barra debe llevar también el **grupo** de la conexión, además
  del motor y el servidor? Propuesta: no, lo dice el buscador; la fila ya tiene
  dos líneas.
- ¿Merece un atajo para el buscador de conexiones (por ejemplo `Mod+Shift+O`)?
  Propuesta: sí, no global sino documentado, y solo si `Mod+Shift+O` está libre
  en WebView2.
