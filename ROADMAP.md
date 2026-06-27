# Plan de desarrollo — Quaero

Este documento describe las fases del proyecto. Cada fase es un **milestone** en GitHub y agrupa los issues que la componen. La estrategia es construir un **camino vertical delgado de punta a punta** (conectar → consultar → ver resultados) y luego ensanchar funcionalidad y motores.

El repositorio permanece **privado** hasta completar el primer entregable usable (final de M2/M3), momento en que se hará **público**.

---

## M0 — Fundaciones del proyecto

Infraestructura mínima para que todo lo demás se construya encima.

- Estructura de carpetas y sistema de build (CMake) multiplataforma.
- CI en GitHub Actions (build Windows/Linux/macOS).
- Integrar la librería `webview` y mostrar una ventana vacía ("hola mundo").
- Definir el contrato IPC núcleo ↔ frontend (JSON-RPC sobre `webview_bind`).
- Toolchain del frontend (Vite + framework ligero) y empaquetado de assets en el binario.

## M1 — Núcleo: motor de datos (MVP)

El corazón del proyecto, como **librería pura sin UI**, testeable de forma aislada.

- Diseñar y documentar la **vtable del driver** (`driver.h`).
- Cargador dinámico de drivers (plugins `.dll`/`.so`).
- Capa de conexión: open/close, manejo de credenciales en memoria.
- Ejecución de queries y modelo de result set (filas, columnas, tipos).
- Serialización de result sets a JSON para el frontend.
- **Driver SQLite** (primer motor de referencia, C puro, sin servidor).
- Tests unitarios del núcleo.

## M2 — Frontend: interfaz base

La UI mínima que convierte el núcleo en algo usable.

- Layout principal (sidebar + área de trabajo + barra de estado).
- Editor SQL con resaltado de sintaxis (CodeMirror/Monaco).
- Grid de resultados **virtualizado** (millones de filas sin degradar).
- Gestor de conexiones (crear/editar/guardar/eliminar) + persistencia.
- **Camino E2E**: escribir SQL → ejecutar → ver resultados. *(Primer entregable demostrable.)*

## M3 — Introspección de esquema y árbol de objetos

- API de introspección en la vtable (bases, esquemas, tablas, vistas, columnas, índices, FKs).
- Árbol de objetos navegable en el sidebar.
- Vista de estructura de tabla.
- Generación de DDL (`CREATE`) desde un objeto.

> **Hito: repositorio público.** Al cierre de M3 existe una herramienta utilizable de extremo a extremo.

## M4 — Segundo motor: MySQL / MariaDB

Primer motor cliente-servidor. Valida que la abstracción de drivers sirve para un motor real con red y autenticación.

- Driver MySQL/MariaDB.
- Mapeo de tipos MySQL ↔ modelo del núcleo.
- Conexiones seguras (SSL) y vía túnel SSH.
- Ajustes a la abstracción según hallazgos del segundo driver.

## M5 — Motor: Informix

Reusa la experiencia de Tabularis sobre el CSDK de Informix.

- Driver Informix (conexión vía CSDK, introspección).
- Mapeo de tipos Informix ↔ modelo del núcleo.

## M6 — Motor: MongoDB

Motor **documental**: pone a prueba la abstracción, hoy tabular.

- Driver MongoDB.
- Modelo de resultados documental y ajustes al núcleo/IPC (cómo representar documentos y colecciones en el result set neutral).

## M7 — Edición de datos y transacciones

- Edición de celdas en el grid (`UPDATE`).
- Insertar / eliminar filas.
- Transacciones (commit/rollback) y edición segura.
- Preview del SQL generado antes de aplicar los cambios.

## M8 — Import / Export

- Exportar result set / tabla (CSV, JSON, `INSERT`s SQL).
- Importar datos (CSV/JSON) a una tabla.
- Mapeo de columnas y manejo de errores en el import.

## M9 — Transferencia y sincronización

- Transferencia de datos entre conexiones (mismo o distinto motor).
- Comparación/sincronización de **estructura** (schema diff).
- Comparación/sincronización de **datos**.

## M10 — SDK de plugins y documentación para la comunidad

- Empaquetar el SDK de drivers (headers + ejemplo + docs).
- Guía "Cómo escribir un driver" con plantilla.
- Documentación de la API IPC para contribuyentes de frontend.
- `CONTRIBUTING`, plantillas de issue/PR, código de conducta.

## M11 — Pulido, empaquetado y release

- Instaladores (Windows MSI, Linux AppImage/deb, macOS `.app`).
- Release automatizado (GitHub Releases) y firma de binarios.
- UX: manejo de errores, atajos de teclado, tema claro/oscuro.
- README final, capturas, landing.
- Auditoría de licencias de dependencias.

## M12 — Motores adicionales (post-MVP)

- Driver PostgreSQL con `libpq` + mapeo de tipos.
- Driver SQL Server (FreeTDS).
- Driver Oracle (OCI).
