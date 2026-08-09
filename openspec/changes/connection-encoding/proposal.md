## Why

El encoding de los datos hoy no se negocia con ningún motor: se adivina, y sólo
en un driver. `ifx_cell_text` mira los bytes de cada celda y, si no son UTF-8
válido, asume Latin-1 y los ensancha. Eso apagó el incendio que lo motivó (#315,
la grilla colgada para siempre) pero dejó la causa intacta: nadie le pide UTF-8
al servidor, la adivinanza falla con CP1252, y los caminos que **no** pasan por
`ifx_cell_text` —los mensajes de error y los nombres de columna— siguen podiendo
tumbar el puente sin dejar rastro (#323).

## What Changes

- **Saneador UTF-8 en el borde IPC.** Una función en el core valida, y repara si
  hace falta, todo texto de driver antes de que llegue a cJSON: celdas, nombres
  de columna y `last_error`. cJSON **no valida** UTF-8, copia los bytes que le
  den, así que hoy no existe última línea de defensa: un solo byte inválido
  corrompe el frame, la respuesta nunca vuelve y la interfaz se queda cargando.
  Con esto, ningún driver —presente o futuro— puede volver a colgarla.
- **Pedirle UTF-8 al servidor donde el motor sabe convertir.**
  `client_encoding=UTF8` en PostgreSQL y `mysql_set_character_set("utf8mb4")` en
  MySQL/MariaDB. Una llamada por driver, cero código de conversión propio: el
  servidor ya sabe transcodificar mejor que nosotros. Hoy PostgreSQL contra una
  BD LATIN1 devuelve Latin-1 crudo, sin conversión y sin la red que sí tiene
  Informix.
- **Informix también sabe convertir, y se le pide.** `CLIENT_LOCALE=en_us.utf8`
  en el connection string, medido en vivo: sin él, una fila cuyos bytes son
  `C3 B1` se lee `ñ` cuando el dato es `Ã±`, y **una fila con bytes 0x80–0x9F
  hace fracasar la consulta entera**. Con él, todo llega correcto. La variable de
  entorno del mismo nombre no sirve: el driver ODBC sólo atiende la palabra clave.
- **Escotilla, no formulario poblado de opciones inertes.** Dos parámetros
  opcionales del DSN (`client_locale`, `db_locale`) cubren la BD cuyo codeset el
  cliente no logre deducir. No hay lista de codesets ni tablas de conversión: el
  cliente ya las tiene.
- **La adivinanza de `ifx_cell_text` se queda como red del lado del driver**, pero
  deja de ser el mecanismo principal.
- **El fallo de fetch dirá por qué.** `ifx_next_row` devuelve -1 sin guardar el
  diagnóstico ODBC, así que hoy el usuario recibe `"query failed"` a secas — el
  mensaje exacto que produjeron las filas de bytes 0x80–0x9F al medir.
- Sin dependencias nuevas: **no** se añade iconv ni ICU al build (x86 incluido).

## Capabilities

### New Capabilities

- `text-encoding`: cómo cada motor entrega su texto en UTF-8 — pedido al servidor
  o al cliente en los tres que saben convertir, y declarable por conexión para la
  base de datos cuyo codeset no se puede deducir.
- `utf8-boundary`: la garantía de que ningún texto de driver cruza el IPC sin ser
  UTF-8 válido, cubriendo celdas, nombres de columna y mensajes de error.

### Modified Capabilities

Ninguna: `openspec/specs/` sigue vacío.

## Impact

- **Core**: un módulo puro nuevo (`utf8`) y su uso en `core/src/ipc/result_json.c`
  y en el camino de `last_error` (`core/src/ipc/conn_methods.c`).
- **Informix**: `ifx_cell_text` y las tablas de conversión salen de
  `drivers/informix/src/query.c` hacia un helper propio; `ifx_stash_diag` e
  `ifx_col_name` empiezan a convertir; el parámetro `encoding` entra por
  `ifx_connect` y, si la verificación en vivo lo respalda, por
  `informix_build_conn_str` como `CLIENT_LOCALE`/`DB_LOCALE`.
- **MySQL y PostgreSQL**: una línea cada uno en `connect`.
- **Frontend**: un campo `encoding` (select) en el esquema de Informix en
  `frontend/src/utils/connections.ts`, con su texto por `t()` y espejo en inglés.
- **Riesgo**: el saneador toca **todo** el texto que sale del core, así que su
  camino rápido tiene que ser exactamente eso — rápido — y no debe alterar un
  solo byte de un texto ya válido. Es lo primero que se prueba.
- **Compatibilidad**: `auto` reproduce lo de hoy, así que las conexiones
  guardadas siguen funcionando sin tocarlas.
- **Verificación en vivo obligatoria** contra la BD Informix real de #315,
  incluyendo un mensaje de error localizado con acentos. Los otros cuatro
  motores, sin regresión.
- **Fuera de alcance**, cada uno su issue si aparece el caso: iconv/ICU y
  codesets de varios bytes (Shift-JIS, GBK, EUC), encoding por columna,
  autodetección estadística del codeset.
