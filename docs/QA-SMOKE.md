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

## Estado por motor

| Motor | Estado | Notas |
|---|:---:|---|
| SQLite | ✅ 12/12 (2026-07-05) | local, sin contenedor |
| MySQL/MariaDB | ✅ 12/12 (2026-07-05) | contra `mysql:8` en :13306 |
| Informix | ⏳ | el driver carga; falta un servidor Informix de prueba |
| MongoDB | ✅ 4/4 (2026-07-05) | driver compilado con `-DQUAERO_MONGOC=ON`, vs `mongo:7` |

## CI

Corre en local sin GitHub Actions. Cuando la facturación de CI se restablezca,
`run.sh <engine> --docker` se puede adoptar tal cual como job (levanta su propio
contenedor y reporta por paso).
