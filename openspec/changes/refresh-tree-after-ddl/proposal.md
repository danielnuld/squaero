## Why

Crear un objeto ejecutando su DDL desde el editor no cambia nada en el árbol: el
procedimiento, la vista o la tabla recién creados no aparecen hasta refrescar a
mano. Las herramientas gráficas (diseñador de tablas, gestor de índices, vista de
estructura) sí suben `treeReload`; `run()` no lo hace nunca, y para un
procedimiento almacenado el editor es el **único** camino que existe (#317).

El refresco que ya existe recarga desde la raíz y **colapsa el árbol entero**.
Dispararlo en cada DDL cambiaría una molestia por otra: quien itera un
procedimiento perdería su navegación en cada ejecución. El refresco automático
tiene que conservar lo que el usuario tenía abierto.

## What Changes

- Tras ejecutar SQL **correctamente**, si alguna sentencia cambia el catálogo
  (`CREATE`, `DROP`, `ALTER`, `RENAME`, `TRUNCATE`), el árbol vuelve a listar sus
  nodos **conservando la expansión, el filtro y la posición**.
- Los cuadernos SQL avisan igual: hoy ejecutan por su cuenta y no notifican nada.
- El refresco manual (F5, el botón, el menú del árbol) sigue igual: recarga desde
  la raíz y colapsa, que es lo que se espera de una recarga explícita.
- La detección es un ayudante puro sobre `splitStatements`, sin diferencias por
  motor; lo que sí se valida por motor es que el objeto nuevo caiga en su carpeta
  (Tablas / Vistas / Procedimientos).

## Capabilities

### New Capabilities

- `object-tree-freshness`: cuándo el árbol de objetos vuelve a leer el catálogo y
  qué conserva al hacerlo.

### Modified Capabilities

Ninguna: `openspec/specs/` sigue vacío.

## Impact

- **Solo frontend.** `App.tsx` (dispara el refresco tras `run()`),
  `components/ObjectTree.tsx` (recarga suave que conserva expansión),
  `components/Notebook.tsx` (avisa a la aplicación), y un módulo puro nuevo para
  clasificar el SQL.
- **Riesgo**: la recarga suave recorre los nodos expandidos; con muchas bases
  abiertas son varias consultas de catálogo. Se limita a lo que ya estaba
  expandido, que es justo lo que el usuario está mirando.
- **Validar en los cuatro motores** que el objeto recién creado aparece en la
  carpeta correcta (lo pidió el reporte).
- Issue relacionado: #317.
