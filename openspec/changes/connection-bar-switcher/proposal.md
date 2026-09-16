## Why

La barra de conexiones es lo primero que se toca al abrir Squaero, y es lo que el
usuario dijo que «sigue sin convencerme». Hoy (`components/ConnectionBar.tsx`) es
**una sola fila** con la conexión enfocada y un menú desplegable que, al abrirse,
contiene el gestor entero:

1. **No se ve lo que está abierto.** Con tres conexiones abiertas, la barra
   muestra una. Saber cuáles hay implica abrir el desplegable y leer los puntos
   verdes de una lista donde también están las cerradas.
2. **Cambiar de conexión son tres gestos:** abrir el desplegable, encontrarla en
   la lista y pulsarla; el desplegable se cierra y no queda rastro de en qué
   estás salvo el nombre de la fila.
3. **Buscar no existe.** La lista es `<details>` por grupo. Con treinta
   conexiones importadas de DBeaver hay que plegar y desplegar grupos a mano.
4. **El desplegable hace tres cosas a la vez** —buscar, conectar y administrar
   (crear, editar, borrar, mover de grupo, importar, exportar con su casilla de
   contraseñas y su aviso)— en un panel de 280 px que tapa el explorador.
5. **Repite lo que la cabecera de cada sección ya dice.** Desde #444 cada
   conexión abierta tiene su sección en el explorador, con su color, su nombre y
   sus botones 🧰 / ⟳ / ⏏. La barra vuelve a poner nombre, estado y ⏏ de la
   enfocada.

El plano es el artboard «Prototipo · conexiones y rejilla» del lienzo
https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2 (opción A de la hoja de
alternativas).

## What Changes

- **La barra pasa a ser la lista de las conexiones abiertas.** Una fila por
  conexión, siempre visibles: raya de su color, monograma del motor (MY, PG, MS,
  IFX, MG, SQ), nombre, y debajo el motor con su base y su servidor. Un clic
  enfoca; la fila enfocada se distingue. El punto verde se reserva para «abierta»
  y la fila avisa cuando el core dice que la sesión se cayó (#407).
- **Conectar se hace desde un buscador.** El `+` de la barra abre un desplegable
  con un campo de búsqueda que filtra **por nombre, motor, servidor y grupo**,
  con las guardadas agrupadas y marcando las que ya están abiertas. Elegir una la
  abre y la enfoca; si ya estaba abierta, solo la enfoca.
- **El gestor se muda a su propia pestaña** («Conexiones», herramienta global):
  crear, editar, borrar, mover a grupo, importar y exportar. El desplegable se
  queda en buscar y conectar, con un pie de tres accesos: nueva conexión,
  importar y gestionar.
- **Se reparte el trabajo con la cabecera de sección.** La barra dice *qué hay
  abierto y en cuál estoy*; la sección de cada conexión sigue teniendo sus
  acciones (herramientas, refrescar, desconectar). La barra conserva un
  desconectar por fila, que es el gesto natural donde está la lista.
- **El explorador no cambia:** sigue apilando una sección plegable por conexión
  abierta (#444), con su reparto por flex y su selector de base activa.
- **Sin conexiones abiertas**, la barra dice lo que hay que hacer y ofrece el
  buscador, en lugar de una fila vacía con «Elegir conexión».

## Capabilities

### New Capabilities

- `connection-switcher`: ver de un vistazo qué conexiones están abiertas, cambiar
  entre ellas con un clic, y encontrar y abrir una guardada buscándola por
  nombre, motor, servidor o grupo.
- `connection-manager-tab`: administrar las conexiones guardadas (crear, editar,
  borrar, mover a grupo, importar, exportar) en una pestaña propia en vez de
  dentro de un desplegable.

### Modified Capabilities

Ninguna: no hay specs previas de la barra ni del gestor en `openspec/specs/`. El
explorador por conexión (#444) se mantiene tal cual.

## Impact

- **Solo frontend.**
  - `components/ConnectionBar.tsx`: reescrito (lista + buscador).
  - `components/ConnectionManager.tsx`: pasa a ser el contenido de la pestaña,
    sin la parte de conectar.
  - Módulo puro nuevo `utils/connectionSearch.ts`: filtrar y agrupar lo que
    enseña el buscador.
  - `utils/connections.ts`: `engineMonogram(driver)`.
  - `utils/tabs.ts`: `ToolKind` += `connections`, y en `GLOBAL_TOOLS` (no depende
    de la conexión enfocada).
  - `utils/toolCatalog.ts`: entrada de la herramienta.
  - `App.tsx`: reparto de props entre barra y pestaña; `connbarOpenTick` deja de
    hacer falta como está (guardar ya no tiene que reabrir un desplegable).
  - `styles.css` y los dos catálogos de mensajes.
- **Sin cambios de modelo, almacenamiento ni IPC.** `Connection`, los grupos y
  los ficheros de importación/exportación siguen igual.
- **`engineMonogram` lo comparte** el cambio `connection-form-redesign` (sus
  tarjetas de motor). El primero que se implemente lo añade; el otro lo usa.
- **Pruebas afectadas:** `ConnectionBar.test.tsx` (reescrito: hoy cubre el
  desplegable y el `openTick`), `ConnectionManager.test.tsx` si existe, y el e2e
  `connection-form.spec.ts` + el helper `connect()` de `e2e/support/app-actions.ts`,
  que abre la conexión por «Elegir conexión» → «Nueva conexión».
- **Capturas del sitio y del manual**: la barra sale en `screenshot-app-dark`,
  `-light` e `-initial-dark`, así que hay que regenerarlas (`pnpm media`) y
  repasar la sección del manual «Varias conexiones a la vez».
- Issue: #525. Relacionados: #444 (el explorador por conexión, que se mantiene),
  #407 (el aviso de sesión caída) y #391 (importar de DBeaver y Navicat).
- Fuera de alcance: el riel vertical de iconos y las pastillas sobre las pestañas
  (opciones B y C del lienzo, descartadas), reordenar conexiones arrastrando, y
  cualquier cambio en el formulario de conexión (`connection-form-redesign`).
