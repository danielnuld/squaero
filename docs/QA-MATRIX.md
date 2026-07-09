# Matriz de verificación: funcionalidad × motor

Documento vivo (issue #194). Estado de **cada funcionalidad** de Quaero frente a
**cada motor** soportado. Los issues de verificación por motor (#195 MySQL, #196
SQLite, #197 Informix, #198 MongoDB) usan esta matriz como checklist y van
cambiando ⏳ → ✅/⚠️/❌ a medida que se prueba en vivo. El smoke automatizado
(#199) cubre el subconjunto marcado más abajo.

## Leyenda

| Estado | Significado |
|:---:|---|
| ✅ | Funciona (verificado en vivo) |
| ⚠️ | Funciona con límites (ver nota) |
| ➖ | No aplica al motor (razón honesta que muestra la UI) |
| ❌ | Roto (issue enlazado) |
| ⏳ | Sin verificar todavía |

**Motores:** SQLite (embebido), MySQL/MariaDB (motor de referencia), Informix
(ODBC, build x86), MongoDB (solo lectura: find/aggregate). PostgreSQL **no** es un
motor incluido todavía — llega en M12 (#22/#23); varias herramientas ya tienen su
SQL preparado, pero el driver no se distribuye aún.

## Matriz

| Funcionalidad | SQLite | MySQL/MariaDB | Informix | MongoDB |
|---|:---:|:---:|:---:|:---:|
| Conexión / desconexión / reconexión | ✅ | ✅ | ✅ 28 | ✅ |
| Conexión cifrada (SSL/TLS) | ➖ 36 | ✅ 37 | ❌ 38 | ⚠️ 39 |
| Árbol de objetos + carpetas por tipo | ⚠️ 1 | ✅ | ⚠️ 2 | ⚠️ 3 |
| Describe / estructura / DDL | ✅ | ✅ | ✅ 29 | ⚠️ 4·34 |
| Ejecutar consulta | ✅ | ✅ | ✅ 28 | ⚠️ 5·34 |
| Paginación real (offset) | ✅ | ✅ | ✅ 28 | ✅ |
| Edición transaccional (insert/update/delete + rollback) | ✅ | ✅ | ✅ 32 | ➖ 6 |
| Detalle de fila (form view) | ⏳ | ⏳ | ⏳ | ⚠️ 7 |
| Export CSV / JSON / SQL / XML / HTML / XLSX | ✅ 8 | ✅ 8 | ✅ 8·35 | ⏳ 8 |
| Import CSV / JSON / XLSX | ⏳ | ⏳ | ⏳ | ➖ 6 |
| Generación de datos | ⏳ | ⏳ | ⏳ | ➖ 6 |
| Sort / filtro de grid | ⏳ 8 | ⏳ 8 | ⏳ 8 | ⏳ 8 |
| Historial / snippets / ejecutar selección | ⏳ 8 | ⏳ 8 | ⏳ 8 | ⏳ 8 |
| Monitor de servidor + kill | ➖ 9 | ✅ 33 | ➖ 10 | ➖ 11 |
| Usuarios / permisos (crear/eliminar/grant/revoke) | ➖ 12 | ✅ 33 | ➖ 13 | ➖ 14 |
| Procedimientos / funciones | ➖ 15 | ✅ 33 | ✅ 30 | ➖ 16 |
| Triggers | ✅ | ✅ 33 | ✅ 31 | ➖ 17 |
| Eventos programados | ➖ 18 | ✅ 33 | ➖ 19 | ➖ 17 |
| Diagrama ER | ⚠️ 20 | ⚠️ 20 | ⚠️ 20 | ⚠️ 20 |
| Constructor visual de consultas | ⏳ | ⏳ | ⏳ | ➖ 21 |
| Charts / gráficos | ⏳ 8 | ⏳ 8 | ⏳ 8 | ⏳ 8 |
| Diseñador de tablas (CREATE) | ✅ | ⏳ | ⏳ | ➖ 6 |
| Diseñador de tablas (ALTER) | ⚠️ 22 | ⏳ | ⏳ | ➖ 6 |
| Índices | ✅ | ⏳ | ⏳ | ➖ 23 |
| Constraints | ➖ 24 | ⏳ | ⏳ | ➖ 23 |
| Sincronización de esquema / datos | ⏳ | ⏳ | ⏳ | ➖ 6 |
| Transferencia de datos | ⏳ | ⏳ | ⏳ | ⚠️ 25 |
| EXPLAIN (plan visual) | ✅ | ⏳ | ➖ 26 | ➖ 27 |

## Notas (razones de ⚠️ y ➖)

Las razones ➖ son las que la propia UI muestra (fuente: `frontend/src/utils/*`).

1. **SQLite — carpetas por tipo:** solo se ofrece la carpeta de *Triggers*; SQLite
   no tiene procedimientos/funciones/eventos.
2. **Informix — carpetas por tipo:** Procedimientos/Funciones/Triggers; sin eventos.
3. **MongoDB — árbol:** colecciones en lugar de tablas; sin carpetas de rutinas.
4. **MongoDB — describe:** los tipos/columnas se infieren muestreando ~200 documentos.
5. **MongoDB — consulta:** sintaxis mongosh (`db.coll.find({...}).sort().limit()`),
   solo `find`/`aggregate` (lectura).
6. **MongoDB — escritura:** «MongoDB es de solo lectura en Quaero (find/aggregate)»
   → edición, import, generación, diseñador, sync no aplican.
7. **MongoDB — detalle de fila:** disponible en modo lectura (sin editar).
8. **Engine-agnóstico:** funciona sobre el conjunto de resultados/cliente, igual en
   todos los motores; ⏳ hasta confirmarlo en vivo o por el smoke.
9. **SQLite — monitor:** «SQLite es una base de datos embebida: no tiene procesos de servidor.»
10. **Informix — monitor:** «Informix administra sesiones por CLI (onmode), no por SQL.»
11. **MongoDB — monitor:** «El monitor de procesos aún no está disponible para MongoDB.»
12. **SQLite — usuarios:** «SQLite no tiene usuarios ni permisos: es una base de datos embebida.»
13. **Informix — usuarios:** «La gestión de usuarios de Informix aún no está disponible aquí.»
14. **MongoDB — usuarios:** «La gestión de usuarios de MongoDB aún no está disponible aquí.»
15. **SQLite — rutinas:** «SQLite no tiene procedimientos ni funciones almacenadas…»
16. **MongoDB — rutinas:** «MongoDB no expone procedimientos almacenados en catálogos SQL.»
17. **MongoDB — triggers/eventos:** «MongoDB no expone triggers en catálogos SQL.»
18. **SQLite — eventos:** «SQLite no tiene eventos programados.»
19. **Informix — eventos:** «Los eventos programados de Informix no están disponibles aquí.»
20. **Diagrama ER (#260):** las relaciones se leen de las **llaves foráneas
    reales** del motor cuando las expone (MySQL `KEY_COLUMN_USAGE`, PostgreSQL
    `pg_constraint`, SQLite `PRAGMA foreign_key_list`, Informix `sysreferences`);
    solo se **cae a la inferencia por nombre** (`customer_id → customers`) cuando
    el motor no tiene FKs (MongoDB) o la consulta falla, marcándolo en la UI.
    Verificado en vivo con SQLite y MySQL (columna FK sin convención → resuelta).
21. **MongoDB — constructor visual:** genera SQL `SELECT`; MongoDB usa mongosh.
22. **SQLite — ALTER:** solo add/drop/rename de columnas; el cambio de tipo in-place
    da error honesto (SQLite no soporta `MODIFY COLUMN`).
23. **MongoDB — índices/constraints:** «MongoDB gestiona índices por comandos, no por
    catálogos SQL.» / «MongoDB no expone constraints en catálogos SQL.»
24. **SQLite — constraints:** el listado por catálogo no está disponible (viven en el
    texto del `CREATE TABLE`).
25. **MongoDB — transferencia:** válido como **origen** (lectura); no como destino (escritura).
26. **Informix — EXPLAIN:** Informix escribe el plan a archivo (`SET EXPLAIN`), no vía SQL.
27. **MongoDB — EXPLAIN:** usa la superficie `.explain()`, no `EXPLAIN` SQL.
28. **Informix — verificado en vivo (2026-07-08)** contra un servidor Informix
    real (IBM Informix Dynamic Server 11.70.FC7, ~400 objetos) vía el `quaero-rpc`
    x86 (el driver ODBC de Informix es 32-bit; ver [[quaero-x86-unified-build]]).
    Conexión, consulta con literales y paginación offset confirmados.
29. **Informix — describe:** BUG encontrado y **corregido** en esta verificación
    (#197): `describe_table` reportaba TODAS las columnas como `CHAR` porque la
    aritmética `coltype - (coltype/256)*256` asumía división entera, pero el `/`
    de Informix es no-truncante → colapsaba a 0. Cambiado a `MOD(coltype,256)`;
    ahora devuelve el tipo real (SMALLINT/VARCHAR/DATETIME/DECIMAL…), verificado
    en vivo sobre `abreviado_jo`.
30. **Informix — procedimientos/funciones:** listado y cuerpo (`sysprocbody`,
    datakey 'T') verificados; las **sobrecargas** se resuelven por `procid`
    (una rutina sobrecargada ×2 devuelve dos cuerpos distintos).
31. **Informix — triggers:** listado (`systriggers`) y cuerpo (`systrigbody`) por
    `trigid` verificados en vivo.
32. **Informix — edición transaccional:** verificado en vivo (2026-07-08) sobre
    una **tabla scratch dedicada** (creada y eliminada al terminar, sin tocar
    datos de negocio): insert×2 + update + delete visibles dentro de la
    transacción, `ROLLBACK` los deshizo (→ 0 filas) y `COMMIT` persiste (control
    positivo). Confirma que la base es *logged* y que el rollback real funciona a
    través del driver ODBC. El constructor de DML tiene además test unitario
    (`informix_dml_test`).
33. **MySQL — verificado en vivo (2026-07-08)** contra MySQL 8.0.46 (contenedor
    efímero) vía `scripts/smoke/mysql-features.mjs`, 10/10: utf8mb4 (acentos +
    emoji) en datos Y nombres de objetos, procedimientos+funciones (listado por
    `information_schema.ROUTINES` + `SHOW CREATE`), triggers, eventos
    programados, usuarios (CREATE/GRANT/SHOW GRANTS/REVOKE/DROP), monitor
    `SHOW PROCESSLIST` + `KILL` de una 2ª sesión, paginación offset sobre 12k
    filas, y edición transaccional con rollback real.
34. **MongoDB — verificado en vivo (2026-07-08)** contra mongo:7 vía
    `scripts/smoke/mongo-features.mjs`, 7/7 (solo lectura): árbol de colecciones,
    describe por muestreo (8 campos inferidos), find + `aggregate`, paginación
    `skip`+`limit`, y renderizado legible de tipos BSON especiales —
    ObjectId (hex de 24), ISODate, Decimal128, documentos anidados, arrays y
    emoji. Confirma que los límites ⚠️ 3/4/5 son correctos (no fallos crípticos).
35. **Informix — export:** el export es client-side (`exportResult`, **sin ramas
    por motor**); verificado (2026-07-08) corriendo los exportadores reales sobre
    un resultado real de Informix — CSV/JSON/SQL/XML/HTML preservan acentos
    (`café ñoño`, ruta Latin-1→UTF-8) y los NULL. XLSX usa el mismo camino
    `{columns,rows}`→`buildXlsx` (con test unitario). Nota: el volcado SQL
    (`toInserts`) emite identificadores ANSI entre comillas dobles; para
    **re-importar** en Informix habría que activar `DELIMIDENT` (sin él, las
    comillas dobles son literales de cadena). El archivo se genera correctamente.
36. **SQLite — SSL/TLS:** no aplica; es una base embebida, sin transporte de red.
37. **MySQL — SSL/TLS:** **verificado en vivo (2026-07-08)** — `ssl_mode=required`
    contra `mysql:8.0` → cifrado `TLS_AES_128_GCM_SHA256`, **TLSv1.3**
    (`SHOW STATUS LIKE 'Ssl_cipher'` no vacío). Campos DSN `ssl_mode` /
    `ssl_ca` / `ssl_cert` / `ssl_key` (`DBC_FEAT_SSL`).
38. **Informix — SSL/TLS:** **no implementado todavía** — el driver ODBC no
    expone opciones SSL (`entry.c` declara TLS ausente honestamente). Es el
    trabajo restante de **#144** (necesita opciones de connection-string ODBC +
    un servidor Informix con TLS para verificar).
39. **MongoDB — SSL/TLS:** el driver soporta `tls`/`ssl` (→ `MONGOC_URI_TLS`);
    no verificado en vivo (el contenedor de prueba no tiene TLS configurado).

## Cobertura del smoke automatizado (#199)

El smoke reproducible (`scripts/smoke/`) cubre el camino crítico por motor:
**conectar → árbol → describe → SELECT paginado → insert/update/delete
transaccional → export CSV → desconectar**. Filas cubiertas: Conexión, Árbol,
Describe, Ejecutar consulta, Paginación, Edición transaccional, Export.

| Motor | Smoke | Notas |
|---|:---:|---|
| SQLite | ✅ 12/12 + 9/9 features | `smoke.mjs` (camino crítico) + `sqlite-features.mjs` (2026-07-07) |
| MySQL/MariaDB | ✅ 12/12 + 10/10 features | `smoke.mjs` + `mysql-features.mjs` vs MySQL 8.0.46 (2026-07-08) |
| Informix | ✅ en vivo | vs un servidor IBM IDS 11.70 real, `quaero-rpc` x86 (2026-07-08) — lectura + edición transaccional (tabla scratch); encontró+corrigió el bug de tipos del describe |
| MongoDB | ✅ 4/4 + 7/7 features | `smoke.mjs` + `mongo-features.mjs` vs `mongo:7` (2026-07-08) |

Ver [QA-SMOKE.md](./QA-SMOKE.md) para correrlo. Las filas ✅ de SQLite y
MySQL/MariaDB arriba (conexión, árbol, describe, consulta, paginación, edición
transaccional, export) están verificadas por el smoke del camino crítico.

**SQLite feature-smoke (`scripts/smoke/sqlite-features.mjs`, #196)** verifica en
vivo contra el core real, sin contenedor: path con espacios/acentos, diseñador
CREATE con tipos variados + describe (PK), unicode (acentos+emoji) en datos Y en
nombres de objetos, vistas (árbol + DDL), triggers (listado + DDL inline),
índices (`pragma_index_list/info`, como la app), `EXPLAIN QUERY PLAN`, FKs reales
por `PRAGMA foreign_key_list`, y archivo de solo lectura (lectura OK, escritura
con error honesto). Esas filas de la columna SQLite pasan a ✅.

_Última actualización: 2026-07-08 — **los 4 motores verificados en vivo**:
#196 SQLite (`sqlite-features.mjs`), #195 MySQL 8.0.46 (`mysql-features.mjs`),
#197 Informix IDS 11.70 solo-lectura (+ bug de tipos del describe corregido),
#198 MongoDB mongo:7 (`mongo-features.mjs`)._
