## 1. Clasificar el SQL ejecutado

- [x] 1.1 Ayudante puro `changesCatalog(sql)` en `utils/sqlEffects.ts`: verdadero
      cuando alguna sentencia empieza por `CREATE`/`DROP`/`ALTER`/`RENAME`/
      `TRUNCATE`. Reutiliza el `scrub` de `queryTarget` (quita comentarios y
      literales) en vez de `splitStatements`: basta con buscar el verbo tras el
      inicio o un `;` del texto ya limpio
- [x] 1.2 Pruebas: cada verbo, `SELECT`/`INSERT`/`UPDATE`/`DELETE` en falso, SQL
      con comentario delante, varias sentencias donde solo una es DDL, `CREATE`
      dentro de una cadena o de un comentario (no cuenta), y SQL vacío

## 2. Recarga suave del árbol (conservando la expansión)

- [x] 2.1 `ObjectTree`: prop nueva para la recarga suave, separada de `reloadKey`
      (que sigue recargando desde la raíz y colapsando)
- [x] 2.2 Volver a listar los nodos expandidos —contenedores y carpetas lazy—
      sin tocar `expanded`, `filter` ni el scroll; `loadChildren` necesita poder
      saltarse la caché
- [x] 2.3 Respetar el `generation` que ya protege contra cambios de conexión a
      medio vuelo
- [x] 2.4 Prueba de componente: con dos niveles expandidos, la recarga suave
      vuelve a consultar el catálogo y mantiene la expansión; el nodo nuevo del
      catálogo simulado aparece

## 3. Disparar el refresco

- [x] 3.1 `run()`: al terminar bien, si `changesCatalog(sql)`, recarga suave
- [x] 3.2 `Notebook`: notificar a la aplicación cuando una celda ejecuta DDL
- [x] 3.3 No disparar nada cuando la ejecución falla

## 4. Validación por motor (lo pidió el reporte)

- [ ] 4.1 SQLite: tabla y vista
- [ ] 4.2 MySQL/MariaDB: tabla, vista y procedimiento
- [ ] 4.3 PostgreSQL: tabla, vista y función
- [ ] 4.4 Informix: tabla, vista y procedimiento (el caso reportado)

## 5. Cierre

- [x] 5.1 `pnpm test` verde
- [x] 5.2 Commit en Conventional Commits referenciando #317
