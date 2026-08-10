## Context

Quaero es un ejecutable único: una shell nativa (`app/src/main.cc`) que embute un
WebView2 con el frontend compilado a un solo `index.html`. Entre el frontend y el
núcleo C hay **exactamente una** puerta, y eso es lo que hace viable todo esto:

```
frontend/src/utils/transport.ts
    globalThis.quaeroRpc(requestJson) -> Promise<respuesta ya parseada>
```

`hasBridge()` ya contempla que el global no exista (es lo que pasa con `pnpm dev`),
así que la aplicación arranca sin puente y no hay que tocar producción para
sustituirlo.

Del otro lado ya existe la mitad complementaria: `tools/quaero-rpc.c`, un puente
stdio al **dispatcher real** que carga los plugins de un directorio — una petición
JSON por línea, una respuesta por línea. Es lo que usa `scripts/smoke/smoke.mjs`
para recorrer el camino crítico sin interfaz.

O sea que las dos mitades del sistema ya hablan por interfaces de texto
estrechas, y nadie las ha unido nunca en una prueba.

Restricciones que mandan sobre el diseño:

- **Informix sólo funciona en x86**: el ODBC de IBM es de 32 bits, así que hay dos
  binarios de `quaero-rpc` posibles y el que carga los cinco drivers es el x86.
- `quaero-rpc` necesita el runtime de mingw en el `PATH` para cargar todos los
  plugins, y `libmysql.dll` vive junto a `build/app`. Ya nos costó tiempo dos veces.
- `frontend/` es el único paquete node del repo; no hay workspace raíz.
- El frontend **no tiene ni un `data-testid`**, pero sí 42 `aria-label` y roles
  correctos (`dialog`, `tab`, `radiogroup`, `alert`).
- El idioma se autodetecta y `es` es el catálogo base.

## Goals / Non-Goals

**Goals:**

- Que una prueba ejercite frontend real → núcleo C real → driver real → BD real,
  sin ninguna capa sustituida.
- Que la suite corra en una máquina con sólo algunos motores, saltándose el resto
  con motivo.
- Que fallar señale **qué motor y qué paso**, sin tener que reproducir a mano.
- Que añadir la cobertura de un componente nuevo sea copiar un patrón, no diseñar
  un arnés.

**Non-Goals:**

- La shell nativa: ventana, menús, diálogos de fichero, persistencia de
  `localStorage` por origen, modal de actualización, enlaces externos. No se
  conducen desde un navegador; van en una fase aparte.
- Sustituir a `ctest`, `vitest` o la suite de smoke. Esto cubre lo que ninguno ve:
  la interfaz y el núcleo **juntos**.
- Cubrir los 44 componentes en este cambio. La fase 1 entrega el arnés y el camino
  crítico; el resto se prioriza después.
- Rendimiento y carga.

## Decisions

### 1. Chromium con el puente inyectado, no CDP contra el WebView2

Playwright conduce Chromium contra el frontend construido, y el arnés **inyecta**
`window.quaeroRpc` apuntando a un proceso `quaero-rpc` real:

```
Playwright (Node)                     Chromium
  quaero-rpc (proceso hijo)  <---->  window.quaeroRpc = (req) => bridgeCall(req)
     |  stdin/stdout, JSON por línea      ^ page.exposeFunction + addInitScript
     v
  núcleo C + plugins reales -> Postgres / MySQL / Informix / SQLite
```

- **Por qué no CDP contra el ejecutable real**: WebView2 se puede abrir a
  depuración remota y `connectOverCDP` funcionaría, pero ataría toda la suite a
  Windows, a un build concreto del ejecutable y a arrancar la shell, para cubrir
  una parte —la shell— que es una fracción pequeña de lo que hay que probar. El
  95 % del comportamiento vive en el frontend y el núcleo, y esta vía lo alcanza
  todo sin esa carga.
- **Lo que por tanto NO se prueba, dicho claro**: la propia shell. Se propone
  después un smoke mínimo por CDP para ella. Un arnés que no diga qué deja fuera
  es peor que no tenerlo, porque se lee como cobertura completa.
- **Por qué el artefacto construido y no `vite dev`**: `vite preview` sirve el
  mismo `dist/index.html` de un solo fichero que se embute en el binario. Probar
  el artefacto que se envía cuesta una compilación y elimina toda una clase de
  «funcionaba en dev».

### 2. Un proceso `quaero-rpc` por worker, y correlación por id

`page.exposeFunction("__quaeroBridge", ...)` publica una función Node en la página;
un `addInitScript` asigna `window.quaeroRpc` para reenviar a ella. Del lado de
Node, un proceso hijo por worker de Playwright, con las respuestas correlacionadas
por el `id` del JSON-RPC.

- **Correlación por `id`, no por orden de llegada.** El núcleo despacha `op.cancel`
  **sin** encolarlo detrás de la consulta en curso (es su razón de existir), así
  que las respuestas pueden llegar desordenadas. Emparejar por orden funcionaría
  hasta la primera prueba de cancelación y fallaría de forma intermitente, que es
  la peor manera de fallar.
- **Un proceso por worker, no uno por prueba**: arrancarlo cuesta cargar cinco
  plugins; por prueba sería un peaje por nada. El aislamiento que las pruebas
  necesitan es de **conexiones y datos**, y eso se resuelve abriendo y cerrando
  conexiones y resembrando, no reciclando el proceso.
- Si el proceso muere, la función expuesta rechaza con un motivo explícito en vez
  de dejar la promesa colgada. Un puente muerto que no contesta produce
  exactamente el síntoma que estas pruebas existen para detectar, y confundirlo
  con un bug del producto costaría una tarde.

### 3. Serie primero, y el motivo apuntado

`workers: 1`. Los motores comparten una tabla de fixture, así que dos workers
mutándola a la vez se pisarían.

`// ponytail: suite en serie; si el reloj molesta, dar a cada worker su propio
sufijo de tabla por motor.`

La alternativa —tabla por worker— es la mejora obvia, pero se paga cuando el
tiempo de la suite duela, no antes.

### 4. El binario se elige por entorno, con los avisos ya resueltos

`QUAERO_RPC` y `QUAERO_DRIVERS` apuntan al binario y al directorio de plugins; por
defecto el **x86**, que es el único que carga los cinco drivers. El arnés añade el
runtime de mingw al `PATH` del hijo por su cuenta.

Esas dos trampas —el `PATH` y la elección de binario— ya nos costaron tiempo dos
veces con un «could not load library» que no explica nada. Que el arnés las
resuelva, y que además **diga qué drivers cargó**, convierte un rato de
desconcierto en una línea de log.

### 5. Cada motor se salta solo, salvo cuando se exige

En el `globalSetup`, para cada motor: ¿cargó su driver? ¿contesta su base? Los que
no, se marcan como no disponibles y sus pruebas se saltan **con motivo**.

Pero un `skip` silencioso es una trampa: un trabajo de CI puede pasar a verde
comprobando nada. Por eso `QUAERO_E2E_REQUIRE` (lista de motores) convierte el
salto en fallo. La suite es tolerante en un portátil y exigente donde importa.

### 6. Sembrar por el núcleo, y una prueba que sí use el formulario

La siembra va por una sesión directa de `quaero-rpc` antes de abrir el navegador:
es rápida y **no depende de que la interfaz funcione**, que es justo lo que se está
poniendo a prueba. Cada fichero de pruebas resiembra su tabla, así que dos
ejecuciones seguidas ven el mismo punto de partida aunque la anterior insertara y
borrara.

Las conexiones guardadas se siembran en `localStorage` (`quaero.connections`) por
`addInitScript`, junto con `quaero.locale` y el resto de claves conocidas
(`quaero.history`, `quaero.snippets`, `quaero.settings`, `quaero.theme`,
`quaero.skin`, `quaero.notebooks`), para que ninguna prueba herede el estado de
otra ni el de un usuario real.

**Con una excepción deliberada**: una prueba crea la conexión **rellenando el
formulario**. Sembrar siempre por `localStorage` dejaría sin cubrir precisamente el
primer camino que recorre cualquier usuario nuevo.

Los fixtures reutilizan lo aprendido en #323/#324: valores acentuados, la fila cuyos
bytes son `C3 B1` (UTF-8 válido para `ñ`, pero `Ã±` en Latin-1) y filas con bytes
`0x80–0x9F`. Son las que distinguen un arreglo real de uno aparente, y ya están en
`enc_test` en los tres contenedores.

### 7. Localizadores por rol y etiqueta; los huecos se anotan, no se tapan

No hay `data-testid`, pero sí 42 `aria-label` y roles correctos. Las pruebas usan
`getByRole`/`getByLabel`, que además comprueban que la interfaz sea utilizable con
teclado y lector de pantalla.

Donde no haya forma accesible de alcanzar un control, la respuesta es **añadir la
etiqueta al componente**, no inventar un `testid`: un `testid` sólo lo ve la
prueba, una etiqueta la ve también el usuario. Cada caso así se anota en
`tasks.md`; ninguno se resuelve con un selector de clase CSS o de posición, que es
como se consigue una suite que se rompe con cada refactor.

## Risks / Trade-offs

- **Intermitencia, el riesgo real de todo E2E** → nada de esperas por tiempo: se
  espera por condición observable. Cualquier prueba que sólo pase «a veces» se
  arregla o se borra el mismo día; una suite en la que no se confía es peor que
  ninguna, porque enseña a ignorar los rojos.
- **Los fallos de encoding son invisibles a simple vista** (`ñ` frente a `Ã±`) →
  esas aserciones comparan el valor exacto, no «contiene acentos».
- **Informix no puede correr en CI**: necesita el ODBC de IBM de 32 bits en
  Windows → CI cubrirá Postgres, MySQL y SQLite con servicios, y exigirá esos tres
  con `QUAERO_E2E_REQUIRE`; Informix se verifica en la máquina que lo tiene. Es una
  limitación de la dependencia, no del diseño, y queda escrita.
- **La suite depende de contenedores que hay que levantar** → cuando no están, se
  salta con un mensaje que dice el comando para arrancarlos, en vez de un rojo
  desconcertante.
- **Playwright y sus navegadores son una dependencia pesada** → sólo
  `devDependency` del paquete frontend, así que no toca el binario ni el build x86.
  Los navegadores se descargan aparte (`playwright install`), no van en el lockfile.
- **La shell nativa queda sin cubrir** → declarado arriba y en el proposal, con su
  fase propia. El riesgo no es el hueco, es olvidar que existe.
- **Un arnés puede tapar un bug real**: si el puente inyectado se comporta distinto
  del de la shell (por ejemplo devolviendo un objeto donde la shell devuelve texto)
  → el puente imita el contrato documentado en `transport.ts`, que ya acepta ambas
  formas, y la fase de la shell por CDP es la que cierra esa duda del todo.

## Migration Plan

No hay migración: sólo se añade. La suite no entra en la puerta de CI hasta que su
fase la añada, así que nadie se bloquea mientras se estabiliza. Para revertir basta
borrar `frontend/e2e/`, el script y la devDependency; nada de producción cambia.

## Open Questions

- **MongoDB** no tiene contenedor; entra en la matriz cuando lo tenga.
- ¿Qué componentes necesitan una etiqueta accesible nueva? Sale de escribir la fase
  1; se anota conforme aparezca y se decide entonces si va en este cambio o en uno
  de accesibilidad aparte.
- ¿Merece la pena el smoke por CDP contra el ejecutable? Se decide con la fase 1
  hecha, cuando se vea cuánto queda realmente sin cubrir.
- ¿Entra la suite en la puerta de CI o queda como trabajo manual/nocturno? Depende
  de cuánto tarde y de lo estable que resulte; decidirlo antes de medirlo sería
  adivinar.
