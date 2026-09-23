## Why

Squaero solo existe en escritorio, y el trabajo diario con una base de datos también ocurre lejos de la
computadora: comprobar un registro, corregir un dato mal capturado o lanzar una consulta guardada. Hasta
#557 era imposible llevarlo a iOS, porque Informix dependía del Client SDK de IBM, que no existe para ese
sistema. Con libdrda (DRDA en C portable) y la experiencia de compilar todos los clientes desde el código
fuente para macOS arm64 (#568), ya nada técnico lo impide. El prototipo aprobado
(https://claude.ai/artifact/RrPE8csPaYMokjqPU95no4, 8 pantallas) fija qué debe hacer la app.

## What Changes

- **App nativa para iPhone** (SwiftUI, iOS 17+), con los **seis motores** de escritorio: Informix por DRDA,
  PostgreSQL, MySQL/MariaDB, SQL Server, MongoDB (solo lectura) y SQLite (archivos del propio teléfono).
- **Conexiones** agrupadas, con TLS verificado, túnel SSH y contraseñas en el **llavero de iOS protegidas
  con Face ID**. Importar las conexiones exportadas desde Squaero de escritorio.
- **Explorar y editar**: tablas, vistas y rutinas; filas como lista de registros con **filtros y paginación
  en el servidor**; detalle de fila como formulario, con datos relacionados.
- **Editar con vista previa**: cada cambio muestra su SQL y se aplica en una transacción; confirmar pide
  **Face ID** y avisa si la conexión es de producción.
- **Consultas**: editor SQL con resaltado, snippets y variables (`:nombre`), resultados paginados.
- **Exportar resultados** a CSV, JSON, XLSX, XML, HTML y SQL, con todas las filas o solo las visibles, y
  **Guardar en Archivos** o **Compartir**.
- **Núcleo y drivers para iOS**: el núcleo en C y los seis drivers se compilan como `xcframework` estático
  (iOS no carga plugins con `dlopen`); la app habla con el núcleo por el mismo JSON-RPC de `docs/IPC.md`.
- **La lógica pura se comparte, no se reescribe**: los módulos puros del frontend en TypeScript (exportadores,
  construcción de filtros, variables, consultas de llaves foráneas, textos de error de Informix) se empaquetan
  en un solo archivo JS que la app ejecuta con JavaScriptCore, que viene con iOS. Escritorio no cambia.
- **Fase 2, agente de IA en el dispositivo** (Foundation Models de Apple, iOS 26+, equipos con Apple
  Intelligence), opcional y desactivado por defecto: filtrar hablando, explicar errores, explicar una consulta
  y pedir datos en lenguaje natural. Solo tiene herramientas de lectura; **nunca ejecuta un cambio**, que pasa
  por la vista previa y Face ID como uno hecho a mano. Cierra la parte de Apple de #263.

## Capabilities

### New Capabilities
- `core-ios-build`: compilar el núcleo y los seis drivers (con sus clientes: libdrda, libpq, MariaDB
  Connector/C, FreeTDS, mongo-c, libssh2, OpenSSL) para iOS arm64 y el simulador, con registro estático de
  drivers.
- `shared-logic`: reutilizar en iOS los módulos puros del frontend (exportar a CSV/JSON/XLSX/XML/HTML/SQL,
  filtros, variables, llaves foráneas, errores legibles) mediante JavaScriptCore, con las mismas pruebas.
- `ios-connections`: gestionar conexiones en iOS (seis motores, TLS, SSH, llavero con Face ID, importar de
  escritorio).
- `ios-browse-edit`: explorar objetos, leer filas con filtros en el servidor, ver una fila y editarla con
  vista previa de la transacción y Face ID.
- `ios-query-export`: editor SQL con snippets y variables, resultados, y exportar a Archivos o Compartir.
- `ios-ai-agent`: agente de IA en el dispositivo, opcional, de solo lectura (fase 2).

### Modified Capabilities
<!-- openspec/specs/ está vacío: no hay requisitos existentes que modificar. -->

## Impact

- **Nuevo**: `ios/` (proyecto Xcode generado, SwiftUI), `cmake/toolchain-ios.cmake`, un bundle
  `squaero-logic.js` generado desde `frontend/src/utils`, y un workflow de CI en macOS que compila el
  `xcframework` y la app.
- **Núcleo**: registro estático de drivers (hoy cada plugin exporta el mismo símbolo de entrada). El
  contrato IPC no cambia.
- **Frontend de escritorio**: sin cambios de comportamiento; sus módulos puros pasan a tener un segundo
  consumidor, así que no pueden depender del DOM ni de Solid.
- **Dependencias**: Xcode, y una cuenta de Apple Developer (99 USD al año) para TestFlight y la App Store.
- **Riesgos**: compilar FreeTDS, mongo-c y libpq para iOS no está probado; las licencias LGPL de MariaDB
  Connector/C y FreeTDS enlazadas en una app de la App Store hay que revisarlas; iOS suspende la app en segundo plano y
  corta las conexiones y los túneles; el agente de IA solo existe en equipos compatibles.
- **Issues**: se abre uno por fase (ver `tasks.md`); el agente se vincula a #263.
