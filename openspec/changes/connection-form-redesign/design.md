## Context

`ConnectionForm.tsx` (414 líneas) se abre como pestaña de herramienta
(`tool: "connectionForm"`) y se monta dentro de `Panel`. Recibe `initial`,
`onSave`, `onCancel`, `onTest`, `onListDatabases` y `groups`. Los campos salen
de `DRIVER_SCHEMAS` (`utils/connections.ts`): los que no tienen grupo van a
«General», y cada `group` (`group.ssl`, `group.ssh`) se convierte en una
pestaña. La validación es `fieldErrors()`, que es pura, y `isValid()`.

Datos que condicionan el diseño:

- El túnel SSH **no tiene una marca propia en el modelo**: el core lo abre
  cuando `ssh_host` tiene valor (`SSH_TUNNEL_FIELDS`, docs/IPC.md). Todos sus
  campos son opcionales.
- Algunos campos de seguridad no tienen grupo: `protocol` (Informix), `tls`
  (MongoDB) y `encryption` (SQL Server) viven hoy en «General».
- `onSaveConnection` en `App.tsx` hace `persist(upsertConnection(...))`, cierra
  la pestaña y sube `connbarOpenTick` para reabrir el menú de conexiones.
- `validateConnection()` también la usa la importación, y ahí el nombre es
  necesario.
- La interfaz no se anima (`--motion-fast`, #386) y todo sale de las escalas de
  tokens (`--sp-*`, `--fs-*`, `--h-*`, `--r-*`).

El prototipo que sirve de plano es el artboard «Nueva conexión» del lienzo
https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2.

## Goals / Non-Goals

**Goals:**

- El orden visual sigue la tarea: motor → dónde → quién → seguridad → túnel →
  cómo se llama.
- Nada escondido: el túnel y la seguridad se ven y se explican.
- El nombre deja de bloquear.
- Probar y guardar siempre a la vista, sin scroll.
- Sin cambios en el modelo, el almacenamiento ni el IPC.

**Non-Goals:**

- Pegar una URL de conexión para rellenar los campos.
- Un campo «entorno» separado del color.
- Rediseñar el selector de emoji (se mueve, no se rehace).
- Los rediseños de la barra de conexiones y de la rejilla.
- Cambiar `DRIVER_SCHEMAS` o añadir motores.

## Decisions

### 1. Secciones derivadas por clave, en un módulo puro

`utils/connectionFormSections.ts` exporta `formSections(schema)`, que devuelve
`{ id, fields }[]` en el orden fijo `server | file | auth | security | ssh`,
con un mapa `clave → sección` (`host, port, server, instance → server`;
`user, password, auth_source, database → auth`;
`ssl_*, sslmode, ssl*, protocol, tls, encryption → security`;
`ssh_* → ssh`; `path → file`). Una clave que no esté en el mapa cae en `server`,
así que un campo nuevo de un driver nunca desaparece. También exporta
`sectionStatus(section, conn, errors, tried, sshOn)`, que devuelve
`"ok" | "error" | "off" | "pending"`.

*Alternativa descartada:* añadir `section` a `DriverField`. Es más explícito,
pero toca los seis esquemas y obliga a que los drivers futuros lo sepan. El mapa
cubre todas las claves actuales y el test de «ningún campo se pierde» lo
vigila.

### 2. Una página con índice, no pestañas ni asistente

Las secciones se apilan en una columna de ~540 px. **El que se desplaza es el
panel entero**, no la columna: la barra de scroll queda en el borde derecho del
panel, que es donde se espera, y no a mitad de pantalla entre el formulario y la
vista previa. El índice de la izquierda y la columna derecha (vista previa y
prueba) usan `position: sticky; top: 0` dentro de ese mismo panel, así que
siguen a la vista mientras se baja. El pie queda fuera del panel y no se
desplaza. El índice usa `scrollIntoView` para saltar y un `IntersectionObserver`
solo para resaltar la sección visible.

*Alternativa descartada:* scroll propio en la columna del formulario. Así se
probó primero en el lienzo, y una barra de scroll en mitad de la pantalla se
lee como un panel incrustado, no como la página.

*Alternativas descartadas:* un asistente por pasos obliga a pulsar «siguiente»
para editar un solo campo, y editar es la mitad del uso. Las pestañas actuales
son justo lo que esconde el túnel.

### 3. El interruptor SSH es estado de la vista

`sshOn` es una señal local que empieza en `!!initial.params.ssh_host`. Apagarla
no borra nada mientras se edita, para que volver a encenderla recupere lo
escrito. Al guardar con el túnel apagado, `snapshot()` quita todas las claves
`ssh_*`. Con el túnel encendido, `fieldErrors` recibe `{ sshRequired: true }` y
exige `ssh_host`.

*Alternativa descartada:* un parámetro `ssh_enabled`. Cambia el formato
guardado y el DSN, y el core no lo necesita.

### 4. Nombre deducido al guardar, no al escribir

`defaultConnectionName(conn)` es pura: `database @ host`, `host`, o el
*basename* de `path`. El input guarda lo que escribe el usuario, y el
placeholder muestra el valor deducido. `save()` rellena `name` antes de llamar a
`onSave`. `fieldErrors` deja de validar el nombre; `validateConnection` lo sigue
exigiendo para la importación.

*Alternativa descartada:* autocompletar el campo mientras se escribe. Al editar
el host se pisaría un nombre que el usuario ya había cambiado.

### 5. Seguridad: control segmentado y textos por valor

El control segmentado reutiliza las `options` del esquema, así que no duplica
valores. La frase explicativa sale de un mapa `valor → clave i18n` en el mismo
módulo puro. Los campos de certificado se muestran cuando el valor está en
`{verify_ca, verify_identity, verify-ca, verify-full}`. Si un modo no tiene
frase se usa la genérica (la del valor por defecto), así que nunca queda un
hueco.

### 6. Monograma del motor

`engineMonogram(driver)` (MY, PG, MS, IFX, MG, SQ) se usa en las tarjetas y en
la vista previa. Los emoji de `engineIcon` siguen donde están: el selector de
icono personalizado y el resto de la app. Es la misma pieza que usará el
rediseño de la barra de conexiones.

### 7. Tiempo de la prueba medido en el formulario

`runTest` rodea `await props.onTest(...)` con `performance.now()`. El core no
devuelve versión ni latencia, así que no se muestra nada que no se haya medido.

### 8. «Guardar y conectar» como prop opcional

`ConnectionForm` recibe `onSaveAndConnect?: (c) => void`. En `App.tsx`, el
manejador llama a `onSaveConnection(c)` y después al mismo `onConnect` que usa
la lista, sin subir `connbarOpenTick`: la conexión ya queda enfocada y abrir el
menú desplegable estorbaría. Si la prop no llega, el botón no se pinta, lo que
mantiene pequeños los tests del componente.

### 9. Estilos con los tokens existentes

Las clases nuevas (`.cf-*`) solo usan `--sp-*`, `--fs-*`, `--h-*`, `--r-*` y
los tokens de color, sin transiciones. Se retiran `.form-tabs`, `.form-tab*`,
`.color-swatch` (sustituido por `.cf-swatch`) y `.db-picker*` después de
comprobar con grep que nadie más los usa.

## Risks / Trade-offs

- **[Riesgo] Un campo nuevo de un driver cae en «Servidor» sin que nadie lo
  note** → El test recorre `DRIVER_SCHEMAS` y comprueba que cada clave está en
  el mapa explícito, no solo que aparece en alguna sección.
- **[Riesgo] Quitar las claves `ssh_*` al guardar con el túnel apagado borra
  datos de conexiones antiguas que tenían `ssh_user` pero no `ssh_host`** →
  Esos datos ya no hacían nada, porque sin `ssh_host` no hay túnel. Se documenta
  en el changelog.
- **[Riesgo] `scrollIntoView` y `IntersectionObserver` se comportan distinto en
  WebView2** → Verificación manual en la build x86 (tarea 6.4). Si falla, el
  índice sigue saltando a la sección y solo se pierde el resaltado.
- **[Trade-off] Una página larga en Informix con SSL y túnel** → El índice y los
  avanzados plegados lo compensan. Aun así hay más scroll que con pestañas.
- **[Riesgo] Las pruebas de pestañas existentes dejan de tener sentido** → Se
  sustituyen por pruebas de secciones, en la misma fase, no se borran sin más.

## Migration Plan

Sin migración de datos. Se entrega en tres PRs (ver tasks.md), cada una con
`pnpm test` y `pnpm e2e` en verde. Para revertir basta con revertir el PR, porque
el formato guardado no cambia.

## Open Questions

- ¿«Guardar y conectar» debe ser la acción principal también en «Editar
  conexión», o allí basta con Guardar? Propuesta: principal solo en «Nueva».
- ¿El selector de emoji se mantiene visible o pasa detrás de un «Personalizar
  icono»? Propuesta: detrás, para no competir con el color.
