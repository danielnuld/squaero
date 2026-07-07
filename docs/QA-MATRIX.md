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
| Conexión / desconexión / reconexión | ✅ | ✅ | ⏳ | ✅ |
| Árbol de objetos + carpetas por tipo | ⚠️ 1 | ✅ | ⚠️ 2 | ⚠️ 3 |
| Describe / estructura / DDL | ✅ | ✅ | ⏳ | ⚠️ 4 |
| Ejecutar consulta | ✅ | ✅ | ⏳ | ⚠️ 5 |
| Paginación real (offset) | ✅ | ✅ | ⏳ | ✅ |
| Edición transaccional (insert/update/delete + rollback) | ✅ | ✅ | ⏳ | ➖ 6 |
| Detalle de fila (form view) | ⏳ | ⏳ | ⏳ | ⚠️ 7 |
| Export CSV / JSON / SQL / XML / HTML / XLSX | ✅ 8 | ✅ 8 | ⏳ | ⏳ 8 |
| Import CSV / JSON / XLSX | ⏳ | ⏳ | ⏳ | ➖ 6 |
| Generación de datos | ⏳ | ⏳ | ⏳ | ➖ 6 |
| Sort / filtro de grid | ⏳ 8 | ⏳ 8 | ⏳ 8 | ⏳ 8 |
| Historial / snippets / ejecutar selección | ⏳ 8 | ⏳ 8 | ⏳ 8 | ⏳ 8 |
| Monitor de servidor + kill | ➖ 9 | ⏳ | ➖ 10 | ➖ 11 |
| Usuarios / permisos (crear/eliminar/grant/revoke) | ➖ 12 | ⏳ | ➖ 13 | ➖ 14 |
| Procedimientos / funciones | ➖ 15 | ⏳ | ⏳ | ➖ 16 |
| Triggers | ✅ | ⏳ | ⏳ | ➖ 17 |
| Eventos programados | ➖ 18 | ⏳ | ➖ 19 | ➖ 17 |
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
20. **Diagrama ER (todos):** las relaciones son **inferidas por nombre**
    (`customer_id → customers`); no lee claves foráneas reales (fase 2 pendiente).
    Hallazgo QA (#196): en SQLite las FK reales SÍ están disponibles barato vía
    `PRAGMA foreign_key_list` (verificado en vivo) pero el ER no las usa —
    candidato a issue de mejora "ER: FKs reales del catálogo".
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

## Cobertura del smoke automatizado (#199)

El smoke reproducible (`scripts/smoke/`) cubre el camino crítico por motor:
**conectar → árbol → describe → SELECT paginado → insert/update/delete
transaccional → export CSV → desconectar**. Filas cubiertas: Conexión, Árbol,
Describe, Ejecutar consulta, Paginación, Edición transaccional, Export.

| Motor | Smoke | Notas |
|---|:---:|---|
| SQLite | ✅ 12/12 + 9/9 features | `smoke.mjs` (camino crítico) + `sqlite-features.mjs` (2026-07-07) |
| MySQL/MariaDB | ✅ 12/12 | contra `mysql:8` en :13306 (2026-07-05) |
| Informix | ⏳ | el driver carga; falta servidor Informix de prueba |
| MongoDB | ✅ 4/4 | driver compilado con `-DQUAERO_MONGOC=ON` vs `mongo:7` (2026-07-05) |

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

_Última actualización: 2026-07-07 (issue #196: SQLite verificado en vivo vía
sqlite-features.mjs — Triggers/Diseñador CREATE/Índices/EXPLAIN → ✅)._
