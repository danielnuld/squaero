# Tareas

Seguimiento: #581 (hito «M12 - App de iPhone»).

Cada grupo es un issue y, salvo el 0, uno o varios PR. Un grupo queda verde en CI (y probado en un
dispositivo o en el simulador cuando tiene interfaz) antes de fusionarse. El grupo 1 va primero porque decide
si el resto es posible: si un cliente no compila para iOS, se sabe antes de escribir interfaz.

## 0. Decisiones previas — #572

- [ ] 0.1 Cuenta de Apple Developer y equipo de firma; identificador del bundle `io.github.danielnuld.Squaero`
- [ ] 0.2 Vía de licencia para la App Store: LGPL de MariaDB Connector/C y FreeTDS (estático o frameworks
      dinámicos) y la GPL-3.0 propia (excepción de licencia del autor)
- [ ] 0.3 iOS mínimo (propuesta: 17) y si iPad entra en modo iPhone

## 1. Núcleo y drivers para iOS (`core-ios-build`) — #573

- [ ] 1.1 `QUAERO_STATIC_DRIVERS`: símbolo de entrada con nombre por driver y tabla de registro generada por
      CMake; escritorio sigue con plugins. Pruebas: registro estático de los seis y `app.hello`
- [ ] 1.2 `cmake/toolchain-ios.cmake` para dispositivo y simulador (arm64)
- [ ] 1.3 OpenSSL para iOS (`ios64-xcrun`, `iossimulator-xcrun`) en `QuaeroOpenSSL.cmake`
- [ ] 1.4 libdrda, libssh2 y MariaDB Connector/C para iOS
- [ ] 1.5 libpq desde el código fuente con un `pg_config.h` para Darwin arm64
- [ ] 1.6 FreeTDS con el `iconv` del SDK
- [ ] 1.7 mongo-c 1.30: parche para CMake 4 en Apple, o CMake 3.31 en ese subproyecto
- [ ] 1.8 Script que arma `SquaeroCore.xcframework` (dispositivo + simulador) y comprueba que no enlaza nada
      fuera del SDK
- [ ] 1.9 Las pruebas unitarias del núcleo corren en el simulador
- [ ] 1.10 Job de CI en `macos-15` que construye el xcframework y corre las pruebas; mide y anota el tamaño

## 2. Lógica compartida (`shared-logic`) — #574

- [ ] 2.1 Entrada de esbuild que empaqueta exportadores, `dataFilter`, `sqlVariables`, `foreignKeys`,
      `informixErrors` y el citado de identificadores en `squaero-logic.js`
- [ ] 2.2 Prueba de CI que evalúa el bundle sin `window` ni `document` y nombra el módulo que falle
- [ ] 2.3 Fachada Swift sobre JavaScriptCore, con errores explícitos para formatos desconocidos
- [ ] 2.4 Pruebas de paridad: los mismos casos de las pruebas de TypeScript dan el mismo resultado desde Swift
      (NULL en JSON, CSV con comas y comillas, filtros de Informix, variables numéricas)

## 3. Esqueleto de la app — #575

- [ ] 3.1 Proyecto Xcode generado (XcodeGen) en `ios/`, que enlaza el xcframework y el bundle JS
- [ ] 3.2 Puente C `quaero_ios.h` y cliente JSON-RPC en Swift sobre una cola serie, con `op.cancel` aparte
- [ ] 3.3 Barra de pestañas (Conexiones, Consultas, Snippets, Ajustes) y estilo del prototipo: violeta,
      Schibsted Grotesk en títulos y Martian Mono en datos, en claro y oscuro
- [ ] 3.4 Job de CI que compila la app para el simulador y corre sus pruebas

## 4. Conexiones (`ios-connections`) — #576

- [ ] 4.1 Lista agrupada, alta, edición y borrado, con los campos de cada uno de los seis motores
- [ ] 4.2 Contraseñas y claves SSH en el llavero con Face ID; DSN armado solo en memoria. Prueba: nada
      secreto en los archivos de la app
- [ ] 4.3 TLS con verificación (CA desde Archivos) y túnel SSH por contraseña o clave
- [ ] 4.4 SQLite con archivos del teléfono (Archivos)
- [ ] 4.5 Conexión caída al volver del segundo plano: aviso y reconectar
- [ ] 4.6 Importar el archivo de conexiones de escritorio
- [ ] 4.7 Prueba en vivo desde el simulador contra los contenedores de pruebas (Informix por DRDA con y sin
      TLS, PostgreSQL, MySQL, SQL Server, MongoDB), también por túnel SSH

## 5. Explorar y editar (`ios-browse-edit`) — #577

- [ ] 5.1 Tablas, vistas y rutinas con buscador y estado de la conexión
- [ ] 5.2 Filas como lista, con filtros en el servidor como etiquetas y paginación por cursor
- [ ] 5.3 Fila como formulario, con tipos y datos relacionados por llaves foráneas
- [ ] 5.4 Editar, vista previa del SQL, Face ID y transacción; aviso de producción; error legible y rollback
- [ ] 5.5 MongoDB de solo lectura, sin ofrecer edición
- [ ] 5.6 Prueba en vivo: editar, confirmar y descartar en MySQL, PostgreSQL e Informix

## 6. Consultas y exportar (`ios-query-export`) — #578

- [ ] 6.1 Editor sobre `UITextView` con resaltado, completado del esquema y fila de teclas SQL
- [ ] 6.2 Snippets y variables (`:nombre`, `${nombre}`) con los valores recordados
- [ ] 6.3 Hoja de exportar: seis formatos, todas las filas por cursor o solo las visibles, nombre del archivo
- [ ] 6.4 Guardar en Archivos y Compartir
- [ ] 6.5 Prueba: exportar las 1 284 filas de una tabla a cada formato y reabrir el archivo

## 7. Distribución — #579

- [ ] 7.1 Icono, pantalla de arranque y `PrivacyInfo.xcprivacy` (sin recogida de datos)
- [ ] 7.2 Workflow de TestFlight firmado desde CI
- [ ] 7.3 Ficha de la App Store (ES y EN) y capturas del simulador
- [ ] 7.4 Manual y web: sección de iPhone

## 8. Fase 2: agente de IA en el dispositivo (`ios-ai-agent`, refs #263) — #580

- [ ] 8.1 Disponibilidad: solo en iOS 26+ con Apple Intelligence; desactivado por defecto, con su
      explicación en Ajustes
- [ ] 8.2 Herramientas de solo lectura: `buscarEsquema`, `describirTabla` y `ejecutarSelect`, que rechaza todo
      lo que no sea un `SELECT` según el clasificador de sentencias del núcleo
- [ ] 8.3 Filtrar hablando: salida `@Generable` validada contra las columnas y convertida en etiquetas de
      filtro
- [ ] 8.4 Explicar un error y proponer el arreglo con las columnas reales
- [ ] 8.5 Explicar una consulta o un snippet antes de ejecutarlo
- [ ] 8.6 Pedir datos en lenguaje natural: `SELECT` en el dialecto del motor, mostrado antes de ejecutarse
- [ ] 8.7 Un cambio propuesto abre la vista previa con Face ID y nunca se ejecuta solo. Prueba: el agente no
      puede ejecutar un `UPDATE` por ninguna vía
- [ ] 8.8 Batería de preguntas de evaluación contra la base de demostración, con los aciertos anotados
