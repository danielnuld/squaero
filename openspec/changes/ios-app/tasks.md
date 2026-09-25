# Tareas

Seguimiento: #581 (hito «M12 - App de iPhone»).

Cada grupo es un issue y, salvo el 0, uno o varios PR. Un grupo queda verde en CI (y probado en un
dispositivo o en el simulador cuando tiene interfaz) antes de fusionarse. El grupo 1 va primero porque decide
si el resto es posible: si un cliente no compila para iOS, se sabe antes de escribir interfaz. Los grupos 9 y
10 (los clientes propios de MySQL y SQL Server) avanzan en paralelo con el 2 al 6 y tienen que estar antes del
7: sin ellos la app no lleva esos dos motores.

## 0. Decisiones previas — #572

- [x] 0.1 Tipo de cuenta: persona física (decidido el 2026-09-23)
- [x] 0.2 LGPL de terceros: clientes propios Apache-2.0 para MySQL y SQL Server (decidido, grupos 9 y 10)
- [ ] 0.3 Permiso adicional de la GPL-3.0 para tiendas de apps: en consulta; borrador en el issue
- [ ] 0.4 Alta en el Apple Developer Program como persona física, y acuerdo de apps gratuitas aceptado
- [ ] 0.5 Registrar el identificador `io.github.danielnuld.Squaero` y crear la app en App Store Connect,
      que reserva el nombre «Squaero»
- [ ] 0.6 Clave de la API de App Store Connect y certificado de distribución, como secretos del repositorio
      para firmar y subir desde CI
- [ ] 0.7 iOS mínimo (propuesta: 17) y si iPad entra en modo iPhone

## 1. Núcleo y drivers para iOS (`core-ios-build`) — #573

- [x] 1.1 `QUAERO_STATIC_DRIVERS`: símbolo de entrada con nombre por driver y tabla de registro generada por
      CMake; escritorio sigue con plugins. Pruebas: registro estático de los seis y `app.hello`
- [x] 1.2 `cmake/toolchain-ios.cmake` para dispositivo y simulador (arm64)
- [x] 1.3 OpenSSL para iOS (`ios64-xcrun`, `iossimulator-xcrun`) en `QuaeroOpenSSL.cmake`
- [x] 1.4 libdrda y libssh2 para iOS (MySQL y SQL Server esperan a los grupos 9 y 10)
- [x] 1.5 libpq desde el código fuente con un `pg_config.h` para Darwin arm64
- [x] 1.6 mongo-c 1.30: parche para CMake 4 en Apple, o CMake 3.31 en ese subproyecto
- [x] 1.7 Script que arma `SquaeroCore.xcframework` (dispositivo + simulador) y comprueba que no enlaza nada
      fuera del SDK
- [x] 1.8 Las pruebas unitarias del núcleo corren en el simulador
- [x] 1.9 Job de CI en `macos-15` que construye el xcframework y corre las pruebas; mide y anota el tamaño

## 2. Lógica compartida (`shared-logic`) — #574

- [x] 2.1 Entrada de esbuild que empaqueta exportadores, `dataFilter`, `sqlVariables`, `foreignKeys`,
      `informixErrors` y el citado de identificadores en `squaero-logic.js`
- [x] 2.2 Prueba de CI que evalúa el bundle sin `window` ni `document` y nombra el módulo que falle
- [x] 2.3 Fachada Swift sobre JavaScriptCore, con errores explícitos para formatos desconocidos
- [x] 2.4 Pruebas de paridad: los mismos casos de las pruebas de TypeScript dan el mismo resultado desde Swift
      (NULL en JSON, CSV con comas y comillas, filtros de Informix, variables numéricas)

## 3. Esqueleto de la app — #575

- [x] 3.1 Proyecto Xcode generado (XcodeGen) en `ios/`, que enlaza el xcframework y el bundle JS
- [x] 3.2 Puente C `quaero_ios.h` y cliente JSON-RPC en Swift sobre una cola serie, con `op.cancel` aparte
- [x] 3.3 Barra de pestañas (Conexiones, Consultas, Snippets, Ajustes) y estilo del prototipo: violeta,
      Schibsted Grotesk en títulos y Martian Mono en datos, en claro y oscuro
- [x] 3.4 Job de CI que compila la app para el simulador y corre sus pruebas

## 4. Conexiones (`ios-connections`) — #576

- [x] 4.1 Lista agrupada, alta, edición y borrado, con los campos de cada uno de los seis motores
- [x] 4.2 Contraseñas y claves SSH en el llavero con Face ID; DSN armado solo en memoria. Prueba: nada
      secreto en los archivos de la app
- [x] 4.3 TLS con verificación (CA desde Archivos) y túnel SSH por contraseña o clave
- [x] 4.4 SQLite con archivos del teléfono (Archivos)
- [x] 4.5 Conexión caída al volver del segundo plano: aviso y reconectar
- [x] 4.6 Importar el archivo de conexiones de escritorio
- [x] 4.7 Prueba en vivo desde el simulador (`LiveTests`, en el job `ios-app` con servidores nativos del Mac):
      PostgreSQL y MongoDB con TLS verificado contra una CA propia, y PostgreSQL por túnel SSH con clave.
      Fuera: Informix (solo hay imagen Docker, y el runner de macOS no tiene Docker; el DRDA se prueba en
      Linux) y MySQL/SQL Server (esperan #583/#584)

## 5. Explorar y editar (`ios-browse-edit`) — #577

- [x] 5.1 Tablas, vistas y rutinas con buscador y estado de la conexión
- [x] 5.2 Filas como lista, con filtros en el servidor como etiquetas y paginación por cursor
- [x] 5.3 Fila como formulario, con tipos y datos relacionados por llaves foráneas
- [x] 5.4 Editar, vista previa del SQL, Face ID y transacción; aviso de producción; error legible y rollback
- [x] 5.5 MongoDB de solo lectura, sin ofrecer edición
- [x] 5.6 Prueba en vivo: editar, confirmar y descartar (`LiveTests`, en el job `ios-app`) en PostgreSQL,
      incluido un rechazo del servidor que aborta la transacción y se deshace. Fuera: Informix (solo imagen
      Docker, como en 4.7) y MySQL (espera #583)

## 6. Consultas y exportar (`ios-query-export`) — #578

- [x] 6.1 Editor sobre `UITextView` con resaltado, completado del esquema y fila de teclas SQL
- [x] 6.2 Snippets y variables (`:nombre`, `${nombre}`) con los valores recordados
- [x] 6.3 Hoja de exportar: seis formatos, todas las filas por cursor o solo las visibles, nombre del archivo
- [x] 6.4 Guardar en Archivos y Compartir
- [x] 6.5 Prueba: exportar las 1 284 filas de una tabla a cada formato y reabrir el archivo

## 7. Distribución — #579

- [x] 7.1 Icono (1024 px), pantalla de arranque, y textos de Face ID y red local en ES y EN
- [x] 7.2 `PrivacyInfo.xcprivacy` sin recogida de datos, con las razones de las API declaradas; CI compara
      las API que importa el binario con las declaradas (`scripts/ios/check-privacy.sh`)
- [x] 7.3 `ITSAppUsesNonExemptEncryption` y la respuesta de cumplimiento de exportación (exenta: solo TLS,
      SSH y SCRAM estándar hacia los servidores del usuario, y el llavero)
- [x] 7.4 Base de demostración SQLite incluida y ofrecida en la pantalla de conexiones
- [x] 7.5 Pantalla de licencias generada desde `THIRD-PARTY.md`, con los `NOTICE` de Apache-2.0 (ninguno de
      los componentes Apache-2.0 publica uno en la versión fijada; va `THIRD_PARTY_NOTICES` de mongo-c)
- [x] 7.6 Chequeo de CI: ninguna dependencia LGPL o GPL ajena en el build de iOS, y el inventario coincide con
      lo que enlaza el `xcframework` (`scripts/ios/check-inventory.mjs`, en el job `ios-core`)
- [ ] 7.7 Política de privacidad publicada en la web (ES y EN), y su URL en App Store Connect (publicada
      con #585; falta ponerla en App Store Connect)
- [ ] 7.8 Workflow que firma y sube a TestFlight desde CI
- [ ] 7.9 Ficha de la App Store (ES y EN), categoría Herramientas para desarrolladores, capturas de iPhone,
      notas para la revisión (cómo abrir la base de demostración)
- [x] 7.10 Manual y web: sección de iPhone (manual §12, y un bloque en la portada ES y EN)

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

## 9. `libmywire`: cliente propio del protocolo de MySQL y MariaDB (Apache-2.0) — #583

- [x] 9.1 Repositorio propio (github.com/danielnuld/libmywire) con la estructura de libdrda (C11, CMake, CI multiplataforma, pruebas en vivo)
- [x] 9.2 Handshake, `mysql_native_password` y `caching_sha2_password` (con TLS o clave RSA del servidor)
- [x] 9.3 TLS con verificación de CA y de nombre
- [x] 9.4 Consultas de texto, conjuntos de resultados, filas afectadas y errores con código y SQLSTATE
- [x] 9.5 Lectura por filas para el cursor (sin cargar el resultado entero) y cancelar con `KILL QUERY`
- [x] 9.6 Pruebas en vivo contra MySQL 8.4 y MariaDB (contenedores), incluidos UTF-8 y los tipos habituales
- [x] 9.7 El driver `mysql` gana el backend `libmywire`; el build de iOS lo usa, y escritorio sigue con MariaDB
      hasta igualar la cobertura (`QUAERO_MYWIRE`, un `mysql.h` propio en `drivers/mysql/mywire`; las pruebas de
      integración del driver corren con los dos clientes, y `LiveTests` edita una fila de MySQL 8.4). El driver
      guarda cada resultado entero, como con MariaDB: el protocolo no deja otra consulta con uno abierto

## 10. `libtdswire`: cliente propio de TDS para SQL Server (Apache-2.0) — #584

- [ ] 10.1 Repositorio propio con la estructura de libdrda
- [ ] 10.2 PRELOGIN con TLS dentro de TDS, LOGIN7 y cifrado obligatorio u opcional, como el `encryption` del
      driver
- [ ] 10.3 SQL batch y los tokens COLMETADATA, ROW, NBCROW, DONE, ERROR e INFO
- [ ] 10.4 Tipos: enteros, decimal/numeric, money, float, fechas (datetime, datetime2, date, time,
      datetimeoffset), (n)char/(n)varchar/(max), varbinary, bit y uniqueidentifier
- [ ] 10.5 Cancelar con el mensaje ATTENTION
- [ ] 10.6 Pruebas en vivo contra SQL Server 2022 (`quaero-mssql-test`), incluida la tabla de 16 tipos
- [ ] 10.7 El driver `mssql` gana el backend `libtdswire`; el build de iOS lo usa, y escritorio sigue con
      FreeTDS hasta igualar la cobertura

