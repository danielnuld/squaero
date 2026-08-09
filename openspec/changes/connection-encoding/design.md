## Context

Estado verificado hoy (#323):

- `ifx_cell_text` (`drivers/informix/src/query.c:339`) es el **único** sitio del
  repo que transcodifica: prueba UTF-8, y si falla ensancha desde Latin-1 a
  buffers `cellu8`/`cellu8_cap` ya presentes en `struct dbc_result`.
- `ifx_stash_diag` (`connection.c:130`) e `ifx_col_name` **no** convierten. Los
  mensajes de `SQLGetDiagRec` de Informix están localizados: en español con
  acentos son Latin-1 crudo, es decir UTF-8 inválido.
- `informix_build_conn_str` no emite `CLIENT_LOCALE` ni `DB_LOCALE`.
- MySQL no llama a `mysql_set_character_set`; PostgreSQL no pasa
  `client_encoding` a `PQconnectdbParams` (`connection.c:105`).
- `core/src/ipc/result_json.c:79` delega en cJSON, que **no valida** UTF-8: copia
  bytes. Un byte inválido corrompe el frame, la respuesta nunca vuelve, la
  interfaz se cuelga. Ése es el mecanismo de #315.

Dos restricciones del proyecto mandan sobre el diseño: el build x86 de 32 bits es
frágil y cada dependencia nueva cuesta caro (ver la receta de libpq estática), y
la regla de capacidades honestas prohíbe fingir éxito en algo no soportado.

Dos anclas útiles que ya existen y evitan trabajo: `struct dbc_result` lleva un
puntero `conn` al dueño, así que la conversión por conexión llega gratis a las
celdas y a los nombres de columna; y todo error de driver pasa por dos únicos
embudos, `dbcore_copy_error` (query/*) y `conn_copy_err` (`conn/manager.c:152`),
antes de terminar en `ipc_response_error` (`ipc/rpc.c:66`).

## Goals / Non-Goals

**Goals:**

- Que ningún driver pueda volver a colgar la interfaz con un byte inválido, y que
  el arreglo viva en **un** sitio, no en cinco.
- Que MySQL y PostgreSQL dejen de depender del charset por defecto de la
  librería cliente enlazada.
- Que el usuario de Informix pueda **declarar** el codeset cuando la adivinanza
  falla, sin recompilar ni editar ficheros.
- Que las conexiones guardadas sigan funcionando sin tocarlas.

**Non-Goals:**

- iconv, ICU o cualquier dependencia nueva. El build x86 no la paga.
- Codesets de varios bytes (Shift-JIS, GBK, EUC). No tenemos el caso; cuando
  aparezca, su issue.
- Encoding por columna, y autodetección estadística del codeset.
- Convertir la entrada: el SQL que escribe el usuario ya es UTF-8 y los motores
  lo aceptan. Sólo se convierte lo que **sale** del motor.

## Decisions

### 1. El saneador va en el borde IPC, en dos llamadas, no en los drivers

Un módulo puro nuevo en el core (`core/src/ipc/utf8.c` + `.h`) con dos funciones:
una que valide, y una que devuelva una copia saneada sólo cuando la validación
falla. Se usa en `result_json.c` (celdas y nombres de columna) y en
`ipc_response_error` (`rpc.c:66`), que es la última puerta por la que sale
**cualquier** mensaje de error, venga de un driver o del propio core.

- **Por qué ahí y no en los embudos de error** (`dbcore_copy_error`,
  `conn_copy_err`): son dos, `ipc_response_error` es uno, y cubre además los
  errores que no vienen de driver.
- **Por qué no en cada driver**: cinco copias del mismo bucle, y un driver nuevo
  llegaría sin red. La regla es arreglarlo donde pasan todos los caminos.
- **Por qué no reemplazar a cJSON por un codificador que valide**: mucho más
  diff por el mismo resultado.
- **Camino rápido obligatorio**: si el texto ya es válido —el 100 % de los casos
  normales— se devuelve el puntero original sin copiar ni asignar nada. Es
  código que corre por cada celda de cada resultado; una asignación por celda no
  es aceptable. La validación es un recorrido de un byte por carácter, ya escrito
  en `is_valid_utf8` de `query.c:270`, que se mueve al core y se borra del driver.
- **Reparación**: cada byte indecodificable pasa a U+FFFD y los caracteres
  válidos sobreviven. Es lossy a propósito: el saneador es **la red, no la capa
  de conversión**. Un acento que llega como U+FFFD significa "algún driver no
  declaró su codeset" — un bug visible, que es exactamente lo que queremos en vez
  de una interfaz colgada.

### 2. Donde el motor sabe convertir, que convierta el motor

- PostgreSQL: un `add_param(..., "client_encoding", "UTF8")` en
  `pg_connect`. libpq entonces pide la conversión al servidor.
- MySQL/MariaDB: `mysql_set_character_set(db, "utf8mb4")` después de
  `mysql_real_connect`. Si falla, la conexión falla con el error del servidor —
  no se entrega un handle que devolvería mojibake en silencio.

Cero código de conversión propio para dos de los cinco motores. Es la rama más
alta de la escalera que aguanta: el servidor tiene las tablas de conversión de
todos los charsets que soporta, y nosotros no queremos tenerlas.

SQLite y MongoDB no necesitan nada: ambos son UTF-8 por especificación. Quedan
cubiertos por la red del punto 1 para el caso de bytes basura almacenados.

Verificado con BD Latin-1 en los dos motores, y con una observación que cierra
cualquier duda sobre por qué adivinar bytes no puede funcionar: los mismos bytes
`93 94` vuelven como comillas tipográficas `“ ”` en MySQL y como los controles
U+0093/U+0094 en PostgreSQL. **Las dos respuestas son correctas** — el `latin1` de
MySQL es en realidad CP1252, y el de PostgreSQL es ISO 8859-1 de verdad. Unos
mismos bytes significan cosas distintas según lo que declare la base de datos, y
eso sólo lo sabe el motor. Ninguna heurística del lado del cliente puede acertar.

**MySQL: opción antes del connect, no llamada después.** `MYSQL_SET_CHARSET_NAME`
se fija con `mysql_options` antes de `mysql_real_connect` en vez de llamar a
`mysql_set_character_set` a continuación. Así el charset aplica durante el propio
handshake (los errores de conexión vuelven en el mismo encoding), sobrevive a una
reconexión automática, y un servidor incapaz de dar `utf8mb4` hace fracasar el
connect con su propio motivo en lugar de entregar un handle que devolvería
mojibake. Además lo hereda gratis la conexión de cancelación, que comparte
`connect_handle`.

### 3. Informix: el cliente CSDK **sí** convierte, si se le pide por el connection string

Esto se decidió midiéndolo (tarea 1.1), no razonándolo, y el resultado cambió el
diseño. Contra una BD `DB_LOCALE=en_us.819` con datos acentuados byte-exactos:

| Fila (bytes en la BD) | Hoy, sin locale | Con `CLIENT_LOCALE=en_us.utf8` |
|---|---|---|
| `Obregón` (F3) | `Obregón` correcto | `Obregón` correcto |
| `CHR(195)‖CHR(177)` = C3 B1, o sea `Ã±` | **`ñ` — mojibake** | **`Ã±` — correcto** |
| comillas cp1252 (93/94) | **`query failed`** | correcto (U+0093/U+0094) |
| euro cp1252 (80) | **`query failed`** | correcto (U+0080) |
| `SELECT` completo de la tabla | **`query failed`** | **7 filas** |

Tres cosas que sólo se ven midiendo:

1. La adivinanza **falla de verdad**, no en teoría: los bytes C3 B1 son UTF-8
   válido por casualidad, así que pasan sin tocar y se leen `ñ` cuando el dato es
   `Ã±`. Es la falsa pasada del punto 1 del proposal, reproducida.
2. Peor que el mojibake: sin el locale, una fila con bytes 0x80–0x9F hace
   **fracasar la consulta entera**. El CSDK ya está convirtiendo por su cuenta
   (locale de cliente por defecto en Windows, cp1252) y se niega ante esos bytes.
   Una sola fila envenena el `SELECT` completo — la tabla entera es ilegible.
3. La variable de **entorno** `CLIENT_LOCALE` no hace nada: el driver ODBC de
   Windows sólo atiende la palabra clave del connection string. Un experimento
   por entorno da un falso negativo; queda anotado para que nadie lo repita.

Conclusión: Informix pasa a ser **igual que MySQL y PostgreSQL** (punto 2). Se le
pide UTF-8 al cliente y él convierte. Consecuencias:

- **Las tablas de 128 entradas no se escriben.** El punto se cae entero, que era
  el resultado deseado del experimento.
- **El campo `encoding` con lista de codesets tampoco hace falta.** Lo que se
  envía es `CLIENT_LOCALE=en_us.utf8`, siempre, y el cliente deduce el codeset de
  la BD por su cuenta (verificado: con sólo `CLIENT_LOCALE`, sin `DB_LOCALE`, ya
  convierte bien).
- Quedan como **escotilla opcional** los dos parámetros `client_locale` y
  `db_locale` del DSN, ya implementados en `informix_build_conn_str`, para la BD
  cuyo locale el cliente no logre deducir. No se ponen en el formulario hasta que
  exista el caso.
- La heurística de `ifx_cell_text` **se queda** como red del lado del driver,
  pero deja de ser el mecanismo principal. Con el locale puesto ya no debería
  dispararse nunca.

### 4. Lo que se conserva de la heurística

La heurística de `ifx_cell_text` se queda tal cual, como red del lado del driver
para el caso en que el locale no llegue a aplicarse (una conexión con
`client_locale` explícito a un codeset de un byte, por ejemplo). Deja de ser el
mecanismo principal y ya no necesita el fallback CP1252 que se había propuesto:
con el locale puesto, los bytes llegan convertidos y la rama no se ejecuta.

### 5. El fallo de fetch tiene que decir por qué

`ifx_next_row` (`drivers/informix/src/query.c:265` y `:270`) devuelve -1 **sin
llamar a `ifx_stash_diag`**, así que `last_error` queda vacío y el núcleo emite
`"query failed"` a secas. Es exactamente el fallo que provocan las filas con
bytes 0x80–0x9F, y hoy el usuario no recibe ni una pista. Con el locale puesto el
fallo desaparece, pero el hueco en el camino de error se queda si no se arregla:
cualquier otro fallo de `SQLFetch`/`SQLGetData` sigue saliendo mudo. Se arregla
aquí porque este cambio ya es el que toca los caminos de error del driver, y
porque un error sin motivo contradice la regla de capacidades honestas.

### 6. La otra dirección: el SQL que sale (#324)

Medir la entrada abrió un segundo frente, y el diseño creció para cubrirlo porque
el síntoma era peor que el original: `WHERE nota LIKE '%ñada%'` devolvía **cero
filas sin error**. El CSDK convierte **en un solo sentido** — los datos que vuelven
sí, el texto de la sentencia no — así que el servidor recibía los bytes UTF-8 y los
leía como caracteres Latin-1.

La vía documentada para ser explícito sobre el encoding de una sentencia es la
entrada ancha, `SQLExecDirectW`, que recibe UTF-16 y deja que el driver convierta.
Un solo sitio de llamada en todo el driver, así que lo heredan consultas, DDL,
metadatos y edición por igual.

**Pero la puerta tuvo que quedar más estrecha de lo que parecía necesario.**
`SQLExecDirectW` **segfaultea** dentro del driver de IBM cuando el no-ASCII está en
un **identificador** (`SELECT id AS año`), y funciona perfectamente cuando está
dentro de un **literal**. Eso no lo podemos arreglar. Así que `ifx_sql_wide_safe`
sólo habilita la vía ancha cuando **todos** los bytes no-ASCII viven dentro de
literales entrecomillados:

- Literal acentuado → vía ancha → **arreglado**, que es el caso peligroso.
- Identificador acentuado → camino de siempre → el servidor devuelve
  «An illegal character has been found in the statement». Exactamente lo que ya
  hacía antes, y muy preferible a tumbar el proceso.
- ASCII → llamada idéntica a la de siempre, así que la vía nueva no puede provocar
  ninguna regresión en lo que ya funcionaba.

Alternativas descartadas: convertir la sentencia nosotros al codeset de la base
exigiría averiguar ese codeset y tener las tablas que precisamente eliminamos, y no
podría representar lo que no cabe en él (el CSDK, en cambio, contesta con un
«Inexact character conversion» honesto). Un escáner que entienda SQL de verdad
—comentarios, identificadores delimitados— sería mucho más código para decidir lo
mismo: el escaneo se limita a comillas simples y trata todo lo demás como inseguro.

Persiguiendo ese segfault salió además un bug latente sin relación con el
encoding: `describe_columns` hacía `strlen` sobre un buffer **sin inicializar** en
lugar de usar el `name_len` que ODBC devuelve. Si un driver no escribe el nombre,
ese `strlen` se sale del array. Arreglado aquí porque el diff ya estaba en esa
función.

## Risks / Trade-offs

- **El saneador toca todo el texto que sale del core** → su camino rápido no
  asigna, no copia y devuelve el puntero original; el test que lo fija (byte a
  byte idéntico para texto ya válido) se escribe antes que la reparación.
- **Enviar `CLIENT_LOCALE=en_us.utf8` siempre cambia el comportamiento de todas
  las conexiones Informix existentes, incluida la de #315** → es el riesgo
  principal del cambio. Se verificó contra un servidor **15.0.1** en Docker con
  un CSDK **4.10**; el servidor real de #315 es **11.70**. Antes de cerrar hay
  que repetir la medición contra 11.70: si allí el cliente no dedujera el codeset
  de la BD, hará falta enviar también `DB_LOCALE`, y para eso están los dos
  parámetros opcionales ya implementados.
- **El CSDK podría rechazar `en_us.utf8` si le faltan los objetos de conversión**
  → el fallo sería en `connect`, con el mensaje del propio cliente, y la escotilla
  `client_locale` permite volver al comportamiento anterior sin recompilar.
- **`mysql_set_character_set` puede fallar en un servidor viejo sin `utf8mb4`** →
  la conexión falla con el error del servidor, que es honesto y accionable;
  `utf8mb4` existe desde MySQL 5.5.3 (2010).
- **Los mensajes de error de Informix se convierten con el `encoding` de la
  conexión, pero un fallo *durante* el connect ocurre antes de que haya conexión
  establecida** → ese texto lo salva la red del punto 1, con U+FFFD en los
  acentos. Un mensaje con un acento raro es infinitamente mejor que la interfaz
  colgada, que es lo que pasa hoy.
- **U+FFFD oculta el bug de un driver que no declaró su codeset** → mitigado por
  el orden: los drivers convierten (puntos 2 y 3) y la red sólo debería
  dispararse con datos genuinamente corruptos.
- **Si `CLIENT_LOCALE` funciona, parte de este diseño se cae** → es el resultado
  deseado, no un riesgo: menos código. Por eso el experimento va primero.

## Migration Plan

Sin migración de datos ni de formato. `encoding` es un parámetro opcional del DSN:
ausente significa `auto`, que es el comportamiento actual, así que las conexiones
guardadas y los ficheros de importación existentes siguen siendo válidos sin
tocarlos. El rollback es revertir el commit; nada persistido cambia de forma.

## Open Questions

- ~~¿Convierte el driver ODBC de Informix cuando se le pasa `CLIENT_LOCALE`?~~
  **Resuelto (tarea 1.1): sí, por la palabra clave del connection string; no, por
  variable de entorno.** Medido contra Informix 15.0.1 en Docker con CSDK 4.10.
  Las tablas de codesets se caen del plan.
- ¿Se comporta igual el servidor **11.70** de #315? Es el único requisito de
  verificación que queda abierto, y de él depende si hay que enviar `DB_LOCALE`
  además de `CLIENT_LOCALE`.
- ¿Hace falta exponer los locales en el formulario? Hoy no: van fijos y el cliente
  deduce el resto. Los parámetros del DSN existen para el caso raro; se añaden al
  formulario sólo si aparece.
- ~~El SQL de **entrada** con acentos no se ha medido.~~ **Medido, y está roto en
  todas las configuraciones, incluida la de hoy** (tarea 5.3): un identificador
  acentuado (`AS año`) da error, y un literal acentuado (`LIKE '%ñada%'`) devuelve
  **cero filas sin error** existiendo la fila. El CSDK no convierte el texto de la
  sentencia hacia el servidor, y ni `CLIENT_LOCALE` ni `DB_LOCALE` lo cambian. **No
  es una regresión de este cambio y este cambio no puede arreglarlo**: es el camino
  de salida, necesita su propio issue. Se deja aquí anotado con la medición para
  que no se pierda.

## Test environment

Contenedor desechable `quaero-ifx-test`
(`icr.io/informix/informix-developer-database`, servidor 15.0.1, puerto 9088,
`informix`/`in4mix`), BD `quaero_enc` con `DB_LOCALE=en_us.819` y la tabla
`enc_test`: acentos Latin-1 reales, la fila discriminadora `CHR(195)||CHR(177)` y
dos filas con bytes 0x80–0x9F.

Dos trampas del entorno, anotadas para no volver a perder tiempo:

- `quaero-rpc` sólo carga los cinco plugins si los DLL de runtime de mingw están
  en el `PATH` (`PATH=/c/mingw32/bin:$PATH`); están puestos junto a
  `build-x86/app/quaero.exe` pero no junto a `build-x86/tools/`. Sin eso, cuatro
  plugins fallan con un «could not load library» que no explica nada.
- Las tablas creadas por el `dbaccess` **del contenedor** (v15) son ilegibles
  desde el CSDK **4.10** de Windows: `-242 Could not open database table`, con
  `oncheck` limpio y legibles desde dentro del contenedor. Es la diferencia de
  versión cliente/servidor, no un problema de Quaero. El fixture se crea **por
  ODBC**, que además es el camino que usa Quaero de verdad.
