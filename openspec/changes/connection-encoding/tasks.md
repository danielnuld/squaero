## 1. Decidir cuánto código hace falta (va primero a propósito)

- [x] 1.1 Contra una BD Informix `DB_LOCALE=en_us.819` con datos acentuados
      byte-exactos, comprobar si `CLIENT_LOCALE` hace que el driver ODBC entregue
      ya UTF-8. **Resultado: sí por la palabra clave del connection string, no por
      variable de entorno.** Medido en el contenedor `quaero-ifx-test` (servidor
      15.0.1, CSDK 4.10). Sin el locale la fila `CHR(195)||CHR(177)` sale `ñ` en
      vez de `Ã±`, y las filas con bytes 0x80–0x9F hacen fracasar la consulta
      entera; con el locale, las 7 filas salen correctas.
- [x] 1.2 Anotado en `design.md` (decisión 3, Open Questions y Test environment).
      **Los pasos de tablas de codesets se caen del plan**, y con ellos el campo
      `encoding` con lista de codesets: Informix pasa al grupo 3.

## 2. La red: UTF-8 garantizado en el borde IPC

- [x] 2.1 `core/src/ipc/utf8.{c,h}`: validación estricta (rechaza sobrelargos,
      subrogados y > U+10FFFF) más reparación, y dos envoltorios cJSON para que
      el buffer temporal no se escape a los llamadores.
      **Desviación:** `is_valid_utf8` **no** se mueve desde el driver Informix.
      El plugin enlaza sólo ODBC + cjson, no `dbcore`, así que no puede llamar al
      core; la duplicación de 30 líneas es la invariante del ABI de plugins, no un
      descuido. Se queda donde está.
- [x] 2.2 Camino rápido sin asignación: texto ya válido se entrega sin copiar.
      Test que fija identidad byte a byte, incluidos multibyte y escapables.
- [x] 2.3 Reparación con un U+FFFD por byte indecodificable. Bordes cubiertos:
      vacío, NULL, continuación suelta, truncado al final, sobrelargos,
      subrogados, y barrido de los 255 bytes y de las 16 384 parejas altas
      comprobando que la salida siempre es UTF-8 válido.
- [x] 2.4 Aplicado en `result_json.c` a celdas y nombres de columna.
- [x] 2.5 Aplicado en `ipc_response_error` (`rpc.c`), última puerta de todo error.
- [x] 2.6 Test en `result_json_test.c`: una columna y una celda en Latin-1 dan un
      frame decodificable que sobrevive a un `cJSON_Parse`, conservando la parte
      legible. Es #315 reducido a una aserción.
- [x] 2.7 `ctest` 52/52 verde, compilando con `-Werror`.

## 3. Que el cliente/servidor convierta, en los tres motores que saben

- [x] 3.1 PostgreSQL: `client_encoding=UTF8` como parámetro en
      `PQconnectdbParams`.
- [x] 3.2 MySQL/MariaDB: `MYSQL_SET_CHARSET_NAME=utf8mb4` como **opción antes** de
      `mysql_real_connect`, no `mysql_set_character_set` después. Así aplica ya en
      el handshake (los errores de conexión vuelven en el mismo encoding),
      sobrevive a una reconexión automática, y un servidor sin utf8mb4 hace
      fracasar el connect con su propio motivo en vez de entregar un handle que
      devuelve mojibake. Lo hereda también la conexión de cancelación, que
      comparte `connect_handle`.
- [x] 3.3 Informix: parámetros opcionales `client_locale` y `db_locale` en el DSN,
      emitidos como `CLIENT_LOCALE`/`DB_LOCALE` por `informix_build_conn_str` en
      ambas formas (directa y `odbc_dsn`), con tests de construcción.
- [x] 3.4 Informix: `CLIENT_LOCALE=en_us.utf8` por defecto en
      `informix_build_conn_str`, en ambas formas de conexión, con el DSN pudiendo
      reemplazarlo y una cadena vacía contando como ausente.
- [x] 3.5 Verificado en vivo contra una BD **Latin-1 de cada motor**, comparando
      la fila cuyos bytes son `C3 B1` (`Ã±` en Latin-1, y también UTF-8 válido
      para `ñ` — el único caso que distingue "el motor convirtió" de "pasaron los
      bytes crudos"):
      - PostgreSQL (BD `LATIN1`): las 4 filas correctas, `Ã±` bien.
      - MySQL (BD `latin1`): las 4 filas correctas, `Ã±` bien; smoke 12/12.
      - Informix (BD `en_us.819`): las 7 filas correctas sin pasar nada en el DSN,
        incluidas las dos que **antes hacían fracasar la consulta entera**.
      - SQLite: smoke 12/12. MongoDB: su test de integración en `ctest`.
      Observación que confirma por qué adivinar bytes no puede funcionar: los
      mismos bytes `93/94` salen como comillas tipográficas `“ ”` en MySQL y como
      los controles U+0093/U+0094 en PostgreSQL. Ambos **correctos**: el `latin1`
      de MySQL es en realidad CP1252. Sólo el motor sabe qué significan sus bytes.

## 4. Informix: los caminos que hoy no convierten ni informan

- [x] 4.0 Extraída la red UTF-8 a un módulo puro `src/utils/text.c`, con tests.
      Estaba duplicada como dos `static` en `query.c` y ahora la necesitan tres
      caminos. El camino rápido sigue sin asignar nada: el texto ya válido se
      devuelve **con el mismo puntero**, y el test lo fija.
- [x] 4.1 Los nombres de columna se convierten **una vez en `describe_columns`**, no
      en cada llamada: así `ifx_col_name` sigue siendo un accesor plano, se respeta
      su contrato de puntero estable y no hace falta un segundo búfer.
      *Cobertura sólo por tests unitarios:* no se puede crear una columna con nombre
      acentuado a través del driver (el identificador acentuado lo rechaza el
      servidor), así que el caso vivo requeriría una BD heredada creada con otra
      herramienta.
- [x] 4.2 `ifx_stash_diag` convierte el texto ya ensamblado de `SQLGetDiagRec`,
      truncando sin cortar una secuencia multibyte por la mitad si al ensanchar ya
      no cabe en el búfer fijo. Perder la cola de un mensaje es mejor que perder el
      mensaje: sin convertir, un error localizado con acentos rompía el mismo frame
      que debía reportarlo y el usuario no veía **nada**.
- [x] 4.3 `ifx_next_row` llama a `ifx_stash_diag` en sus **dos** salidas de error
      (el `SQLFetch` y el `fetch_cell`) antes de devolver -1.
      Verificado en vivo provocando el fallo con un desajuste de locale a propósito
      (`client_locale=en_us.CP1252` contra una BD 8859-1): ahora llega
      `fetch: [HY000] … Inexact character conversion during translation` donde
      antes llegaba `query failed` a secas.
- [x] 4.4 Verificada en vivo la red del driver forzando `client_locale=en_us.819`:
      las siete filas llegan ensanchadas desde Latin-1, incluidas las dos de bytes
      0x80–0x9F. Es el único modo de ejercitarla ahora, porque por defecto el CSDK
      ya entrega UTF-8 y la red no se dispara.

## 6. El SQL que sale: literales acentuados (#324)

- [x] 6.1 Confirmado con un round-trip que el CSDK convierte **en un solo
      sentido**: `SELECT 'ñ'` devolvía `Ã±`, `LENGTH('ñ')` daba 2 y `ASCII('ñ')`
      daba 195, o sea que el servidor recibía los bytes UTF-8 sin convertir.
- [x] 6.2 Helper puro `ifx_utf8_to_utf16` (`src/utils/utf16.c`) con tests que fijan
      las unidades exactas: acentos, tres bytes, pares subrogados, los extremos de
      cada rango, y rechazo de UTF-8 mal formado (sobrelargos, subrogados
      codificados, truncados) para que el llamador caiga al camino de siempre en vez
      de enviar algo alterado.
- [x] 6.3 `ifx_run` ejecuta con `SQLExecDirectW` cuando corresponde. Un solo sitio
      de llamada en todo el driver, así que lo heredan consultas, DDL, metadatos y
      edición.
- [x] 6.4 **La puerta quedó más estrecha de lo previsto, y por una razón medida:**
      `SQLExecDirectW` **segfaultea** dentro del driver de IBM cuando el no-ASCII
      está en un **identificador** (`AS año`), mientras que dentro de un literal
      funciona perfecto. No es algo que podamos arreglar, así que
      `ifx_sql_wide_safe` habilita la vía ancha sólo si **todos** los bytes
      no-ASCII van dentro de literales entrecomillados; el resto sigue por el
      camino de hoy, donde el servidor devuelve un error limpio. Un segfault es
      mucho peor que un error, y el error es lo que ya pasaba antes.
- [x] 6.5 Endurecido `describe_columns`: usaba `strlen` sobre un buffer **sin
      inicializar** en vez del `name_len` que devuelve ODBC. Si el driver no escribe
      el nombre, ese `strlen` se sale del array. Bug latente independiente de #324,
      encontrado persiguiendo el segfault.
- [x] 6.6 Verificado en vivo: `LIKE '%ñada%'` devuelve su fila (antes cero),
      `= 'Cañada'` empareja, `LENGTH('ñ')` es 1, una comilla escapada con acento
      (`'it''s café'`) sale intacta, un alias acentuado da error limpio **sin
      caída**, un emoji no representable en Latin-1 da un
      «Inexact character conversion» honesto, y el SQL ASCII no cambia en nada.

## 5. Cierre

- [ ] 5.1 Repetir la medición de 1.1 contra el servidor **11.70** de #315: es la
      única incógnita que queda y decide si hay que enviar `DB_LOCALE` además de
      `CLIENT_LOCALE`.
- [ ] 5.2 Verificación en vivo completa contra #315: celdas, nombres de columna,
      comillas tipográficas y un mensaje de error localizado, legibles y sin
      cuelgues.
- [x] 5.3 Medido el SQL de **entrada** con acentos, contra Informix Latin-1, en las
      tres configuraciones (por defecto, con `DB_LOCALE`, y con el
      `CLIENT_LOCALE=en_us.819` de antes). **Roto en todas, incluida la de hoy: no
      es una regresión de este cambio y ningún locale lo arregla.**
      - `SELECT id AS año` → error «An illegal character has been found in the
        statement».
      - `WHERE nota LIKE '%ñada%'` → **cero filas, sin error**, existiendo la fila.
        Silenciosamente equivocado, que es peor que fallar.
      El SQL sale como UTF-8 y el CSDK no lo convierte hacia el servidor.
      Abierto como **#324** y arreglado en el grupo 6, en esta misma rama.
- [x] 5.4 Sin regresión: `ctest` 52/52 con `-Werror`, smoke de SQLite 12/12 y de
      MySQL 12/12 (esta última contra la BD Latin-1).
- [ ] 5.5 Build x86 verde y sin dependencias nuevas — que no se haya colado iconv
      ni ICU.
- [ ] 5.6 Documentar los parámetros `client_locale`/`db_locale` donde se documentan
      los del DSN, y dejar anotado que la variable de entorno no sirve.
