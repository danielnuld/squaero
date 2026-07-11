# Smoke suite por motor

Verificación reproducible del camino crítico de Quaero contra un motor real
(issue #199). No usa el webview: el binario `quaero-rpc` (tool en C) canaliza
JSON-RPC por stdin al **núcleo real + driver real**, y `scripts/smoke/smoke.mjs`
ejecuta la secuencia paso a paso reportando ✅/❌.

## Camino cubierto

`conectar → crear tabla → insertar → SELECT paginado (2 páginas) → describe →
árbol → edición transaccional (begin/insert/update/delete/commit) → rollback →
export CSV → desconectar`.

En MongoDB (solo lectura) el camino se reduce a: conectar → árbol → find
paginado → desconectar.

## Requisitos

- Árbol compilado en `build/` con el tool: `cmake --build build --target quaero-rpc`.
- `node` en el PATH.
- Para `--docker`: Docker (levanta un contenedor efímero del motor).
- Windows: el runner añade `build/app` al PATH para que el plugin del motor
  encuentre su DLL cliente (p.ej. `libmysql.dll`).

## Cómo correrlo

```sh
# SQLite (local, sin contenedor)
scripts/smoke/run.sh sqlite

# MySQL/MariaDB contra un servidor existente (DSN por defecto :13306 root/test123/testdb)
scripts/smoke/run.sh mysql
# ...o contra un contenedor efímero que el script levanta y borra:
scripts/smoke/run.sh mysql --docker

# MongoDB (compila el driver con: cmake -S . -B build -DQUAERO_MONGOC=ON)
scripts/smoke/run.sh mongodb --docker
```

DSN a medida (sobrescribe el default) por variable de entorno:

```sh
QUAERO_SMOKE_DSN='{"host":"127.0.0.1","port":"3306","user":"u","password":"p","database":"d"}' \
  scripts/smoke/run.sh mysql
```

También se puede invocar el driver directamente:

```sh
node scripts/smoke/smoke.mjs sqlite build/app/drivers
```

El código de salida es 0 si todos los pasos pasan, 1 si alguno falla.

## Feature-smoke de SQLite (#196)

Más allá del camino crítico, `scripts/smoke/sqlite-features.mjs` verifica en vivo
(mismo puente `quaero-rpc`, sin contenedor) los flujos sensibles específicos de
SQLite: path con espacios/acentos, diseñador CREATE con tipos variados + describe,
unicode en datos y en nombres de objetos, vistas (árbol + DDL), triggers (listado
+ DDL inline), índices (`pragma_index_list/info`), `EXPLAIN QUERY PLAN`, FKs por
`PRAGMA foreign_key_list`, y archivo de solo lectura (lectura OK / escritura con
error honesto).

```sh
node scripts/smoke/sqlite-features.mjs            # usa build/drivers/sqlite
node scripts/smoke/sqlite-features.mjs build/app/drivers
```

## Feature-smoke de MySQL (#195)

`scripts/smoke/mysql-features.mjs` verifica los flujos sensibles de MySQL contra
un servidor real (contenedor efímero; requiere escritura, por eso un servidor
descartable): utf8mb4 (acentos + emoji) en datos y nombres de objetos,
procedimientos+funciones (listado + `SHOW CREATE`), triggers, eventos
programados, usuarios (CREATE/GRANT/SHOW GRANTS/REVOKE/DROP), monitor
`SHOW PROCESSLIST` + `KILL`, paginación offset sobre >10k filas, y edición
transaccional con rollback real.

```sh
# levantar un mysql:8.0 descartable en :13306 (event scheduler ON para el paso de eventos)
docker run -d --name mysql-qa -e MYSQL_ROOT_PASSWORD=test123 -e MYSQL_DATABASE=testdb -p 13306:3306 mysql:8.0
# esperar a que acepte auth, luego:
PATH="$PWD/build/app:$PATH" node scripts/smoke/mysql-features.mjs
```

## Feature-smoke de MongoDB (#198)

`scripts/smoke/mongo-features.mjs` verifica la superficie de solo lectura de
MongoDB contra un `mongo:7`: árbol de colecciones, describe por muestreo,
`find`/`aggregate`, paginación `skip`+`limit`, y renderizado legible de tipos
BSON especiales (ObjectId, ISODate, Decimal128, documentos anidados, arrays,
emoji).

```sh
# sembrar (colecciones docs con tipos variados + big con 50 docs) en la db quaero_qa:
docker exec <mongo> mongosh --quiet --eval 'db=db.getSiblingDB("quaero_qa"); db.docs.insertMany([...]); for(let i=0;i<50;i++)db.big.insertOne({n:i,name:"row"+i})'
PATH="$PWD/build/app:$PATH" node scripts/smoke/mongo-features.mjs
```

## Feature-smoke de PostgreSQL (#22/#23)

`scripts/smoke/postgres-features.mjs` verifica en vivo, contra un `postgres:16`,
los caminos específicos de PG que las pruebas unitarias *puras* del driver
(`postgres_types_test` / `postgres_identifier_test` / `postgres_dml_test`) **no**
cubren porque emiten consultas de catálogo o usan estado de libpq: UTF-8
(acentos + emoji) en datos y en nombres de objetos entrecomillados, **esquemas
reales** (el diferenciador `DBC_FEAT_SCHEMAS`: `schema.tree` lista un esquema no
`public`; `schema.describe`/`schema.ddl` honran el argumento de esquema),
renderizado de `format_type` + columnas `notnull`/`dflt_value`/`pk` en describe,
`CREATE TABLE` reconstruido por `schema.ddl` (columnas + DEFAULT + PRIMARY KEY,
más error honesto ante un objeto inexistente), tipos de extremo a extremo
(bool/numeric/jsonb/uuid/timestamptz/bytea/`int[]` → los arreglos caen a text),
vistas y vistas materializadas ambas como `view`, paginación con offset sobre
>10k filas, y edición transaccional con ROLLBACK real.

```sh
docker run --rm -d -e POSTGRES_PASSWORD=test123 -e POSTGRES_DB=testdb \
  -p 15432:5432 postgres:16
# IMPORTANTE: correr contra el build x86 — su libpq estático (REL_16_9) hace
# SCRAM-SHA-256 (autenticación por defecto de PG16). El build x64 de desarrollo
# se enlaza contra el libpq de Strawberry, demasiado viejo para SCRAM, y la
# conexión se cuelga hasta agotar el authentication_timeout del servidor.
PATH="/c/mingw32/bin:$PWD/build-x86/app:$PATH" \
  QUAERO_RPC=build-x86/tools/quaero-rpc.exe \
  node scripts/smoke/postgres-features.mjs build-x86/app/drivers
```

> `op.cancel` en vuelo no se ejercita aquí: `quaero-rpc` es un bucle stdio de un
> solo hilo (`dbcore_ipc_handle` bloquea hasta que `query.run` retorna), así que
> un `op.cancel` concurrente nunca alcanza la operación en curso desde un mismo
> proceso. La ruta de cancelación con hilos (PQcancel) la cubre el
> `op_cancel_test` del core.

## Estado por motor

| Motor | Estado | Notas |
|---|:---:|---|
| SQLite | ✅ 12/12 + 9/9 features (2026-07-07) | local; `smoke.mjs` + `sqlite-features.mjs` |
| MySQL/MariaDB | ✅ 12/12 + 10/10 features (2026-07-08) | `smoke.mjs` + `mysql-features.mjs` vs MySQL 8.0.46 |
| PostgreSQL | ✅ 10/10 features (2026-07-11) | `postgres-features.mjs` vs `postgres:16` (build x86, SCRAM) |
| Informix | ⏳ | el driver carga; falta un servidor Informix de prueba |
| MongoDB | ✅ 4/4 + 7/7 features (2026-07-08) | `smoke.mjs` + `mongo-features.mjs` vs `mongo:7` |

## CI

Corre en local sin GitHub Actions. Cuando la facturación de CI se restablezca,
`run.sh <engine> --docker` se puede adoptar tal cual como job (levanta su propio
contenedor y reporta por paso).
