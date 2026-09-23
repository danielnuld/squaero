## Context

Squaero tiene tres capas: el núcleo en C (`libdbcore`), los drivers como plugins que el núcleo carga con
`dlopen`, y un frontend en SolidJS que corre en el webview del sistema y habla con el núcleo por JSON-RPC
(`docs/IPC.md`). En escritorio todo eso ya compila para Windows x64, Linux y macOS arm64 (#560, #568), con los
clientes de cada motor compilados desde el código fuente salvo libpq y mongo-c en macOS, que vienen de
Homebrew.

Para iOS cambian tres cosas: no se pueden cargar plugins con `dlopen` desde fuera del bundle firmado, no hay
Homebrew, y la interfaz de escritorio (árbol + rejilla densa) no sirve en un teléfono. El prototipo aprobado
(8 pantallas) define la interfaz. El usuario pidió los seis motores, exportar a los seis formatos y, en una
segunda fase, un agente de IA en el dispositivo.

## Goals / Non-Goals

**Goals:**
- Una app de iPhone con los seis motores, edición con vista previa y Face ID, consultas y exportación.
- Reutilizar el núcleo y los drivers tal cual, por el mismo contrato IPC.
- No duplicar la lógica pura que ya tiene pruebas en TypeScript.
- Dejar el agente de IA como fase 2, sin que la fase 1 dependa de él.

**Non-Goals:**
- iPad con diseño propio: la app corre en iPad en modo iPhone; un diseño de dos columnas va aparte.
- Sincronizar conexiones por iCloud.
- Mantener conexiones vivas en segundo plano.
- Un agente con modelos en la nube.
- Diagrama ER, constructor visual, monitor y usuarios/permisos: quedan para después de la fase 1.

## Decisions

### D1. Interfaz nativa en SwiftUI, no el frontend en un WKWebView

La app se escribe en SwiftUI y llama al núcleo por JSON-RPC.
- **Por qué:** las convenciones que el prototipo usa (listas agrupadas, hojas, selector de Archivos, hoja de
  compartir, Face ID, teclado con fila de teclas SQL) son nativas. Además, el agente de la fase 2 usa
  Foundation Models, que solo tiene API en Swift. Y el frontend de escritorio necesitaría un segundo diseño
  para el teléfono de todos modos.
- **Alternativa descartada:** el frontend en WKWebView en «modo teléfono». Reutilizaría más código, pero
  pelea con los gestos y el teclado de iOS, y aun así necesitaría un puente a Swift para el llavero, Face ID,
  Archivos y el agente.

### D2. La lógica pura del frontend se ejecuta con JavaScriptCore

Los módulos puros de `frontend/src/utils` que la app necesita se empaquetan con esbuild en un solo
`squaero-logic.js`, que la app ejecuta con JavaScriptCore (incluido en iOS) detrás de una fachada Swift
pequeña: exportadores (CSV, JSON, XLSX con fflate, XML, HTML, SQL), filtros en el servidor (`dataFilter`),
variables (`sqlVariables`), llaves foráneas (`foreignKeys`), textos de error (`informixErrors`) y citado de
identificadores.
- **Por qué:** estos módulos ya tienen pruebas y cubren las trampas medidas contra motores reales (números
  sin comillas en las variables, `owner:tabla` de Informix, el UNION ALL de 16 ramas de las llaves foráneas).
  Reescribirlos en Swift los duplicaría y los haría divergir.
- **Condición:** esos módulos no pueden depender del DOM ni de Solid. Una prueba de CI evalúa el bundle en un
  contexto sin `window` ni `document`, y falla si alguno se cuela.
- **Alternativas descartadas:** portarlos a Swift (dos implementaciones) o moverlos al núcleo en C (mucho
  trabajo y un cambio del contrato IPC sin necesidad).

### D3. Drivers con registro estático en iOS

Con la opción `QUAERO_STATIC_DRIVERS`, cada driver compila su símbolo de entrada con un nombre propio
(`dbc_driver_entry_<nombre>` en lugar del común), y CMake genera una tabla con los drivers enlazados que el
núcleo registra al iniciar con `dbcore_runtime_register_driver`.
- **Por qué:** es lo mínimo para cargar varios drivers en un solo binario. El vtable no cambia, y escritorio
  sigue con plugins.
- **Alternativa:** frameworks dinámicos embebidos, que iOS sí permite si van firmados dentro del bundle.
  Ya no hace falta para las LGPL, porque no van en iOS (D10).

### D4. Toolchain de iOS y los clientes desde el código fuente

Un `cmake/toolchain-ios.cmake` (`CMAKE_SYSTEM_NAME=iOS`, arm64, sysroot `iphoneos` o `iphonesimulator`) compila
el núcleo, los drivers y los clientes, y un script arma el `xcframework` con las dos porciones.
- **OpenSSL:** con los objetivos `ios64-xcrun` e `iossimulator-xcrun`.
- **libpq:** desde el código fuente, extendiendo la receta de `cmake/libpq-win32` con un `pg_config.h` para
  Darwin arm64.
- **mongo-c 1.30:** no configura con CMake 4 en Apple (política CMP0042 y un `try_compile`). Se parchea en el
  `FetchContent` o se compila con CMake 3.31 en ese subproyecto.
- **MySQL y SQL Server:** no se usan MariaDB Connector/C ni FreeTDS en iOS, por su licencia (D10).
- **Por qué desde el código fuente:** en iOS no hay Homebrew ni bibliotecas del sistema para estos clientes.

### D5. Un puente C mínimo y un solo hilo para el núcleo

Un encabezado `quaero_ios.h` expone tres funciones: iniciar el runtime con los drivers estáticos,
`dbcore_ipc_handle(json)` y liberar la respuesta. Swift serializa las peticiones en una sola cola de fondo,
como el hilo de trabajo de escritorio, y despacha `op.cancel` fuera de ella para poder cortar una consulta
lenta.
- **Por qué:** el núcleo está pensado para un solo hilo (salvo cancelar). Repetir el modelo de escritorio
  evita añadirle bloqueos.

### D6. Secretos en el llavero, el resto en archivos

- **Contraseñas y claves SSH:** en el llavero, con `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` y un
  `SecAccessControl` `.biometryCurrentSet` (Face ID o el código del dispositivo). El DSN se arma en memoria
  justo antes de `conn.open` y no se guarda nunca.
- **Conexiones, grupos, snippets y ajustes:** en JSON dentro de Application Support, sin secretos.
- **Importar de escritorio:** su formato de conexiones.

### D7. Segundo plano: reconectar, no mantener vivo

iOS cierra los sockets de una app suspendida. La app no intenta mantenerlos. Al volver (`scenePhase`), o al
fallar una petición con error de conexión, marca la conexión como caída y ofrece reconectar, igual que el
aviso de conexión caída de escritorio (#407). El túnel SSH se reabre al reconectar.

### D8. Editor SQL propio sobre UITextView

El editor es un `UITextView` envuelto para SwiftUI, con un resaltador de palabras clave, cadenas, números y
variables, completado con los nombres del esquema (`schema.describe`) y una fila de teclas SQL sobre el
teclado.
- **Alternativa:** Runestone (MIT, tree-sitter), si el resaltado propio se queda corto. Añadiría una
  dependencia.

### D9. Fase 2: el agente con Foundation Models y herramientas de solo lectura

- **Sesión:** `LanguageModelSession` del modelo del sistema, disponible solo si
  `SystemLanguageModel.default.availability` lo permite.
- **Herramientas:** `buscarEsquema(texto)` (nombres de tablas y columnas), `describirTabla(nombre)` y
  `ejecutarSelect(sql)` con un límite de filas.
- **Estructura fija para los filtros:** `@Generable` con columna, operador y valor, validados contra las
  columnas reales antes de convertirse en filtros.
- **Solo lectura:** `ejecutarSelect` rechaza lo que no sea una sola sentencia `SELECT`, con el clasificador de
  sentencias del núcleo (`stmt_class`), no con una expresión regular en Swift.
- **Cambios:** un cambio propuesto no se ejecuta; abre la vista previa normal, con Face ID.
- **Por qué solo el modelo del dispositivo:** mantiene la promesa de que nada sale del equipo.
- **Por qué buscar en vez de pasar el esquema:** la ventana de contexto es pequeña, y un Informix con cientos
  de tablas no cabe.

### D10. Clientes propios, Apache-2.0, para MySQL y SQL Server

Dos bibliotecas nuevas en C, con la forma de libdrda (repositorio propio, Apache-2.0, pruebas en vivo contra
contenedores):
- **`libmywire`:** el protocolo cliente/servidor de MySQL y MariaDB. Incluye el handshake,
  `mysql_native_password` y `caching_sha2_password` (con TLS, o con la clave RSA del servidor por OpenSSL),
  TLS, el protocolo de texto de las consultas y la lectura por filas para el cursor.
- **`libtdswire`:** TDS 7.4 para SQL Server. Incluye PRELOGIN con TLS dentro de TDS, LOGIN7, SQL batch, los
  tokens de resultado (COLMETADATA, ROW, NBCROW, DONE, ERROR/INFO) y los tipos de datos habituales.

Se escriben **solo desde especificaciones públicas**: la documentación del protocolo de MySQL y MariaDB, y
[MS-TDS] de Microsoft, publicada bajo su Open Specifications Promise. Nunca a partir del código de
MariaDB Connector/C ni de FreeTDS, igual que libdrda con DRDA. Los drivers `mysql` y `mssql` ganan un segundo
backend. Escritorio puede seguir con MariaDB y FreeTDS, y adoptar los propios cuando igualen su cobertura
medida.
- **Por qué:** la LGPL-2.1 prohíbe añadir restricciones a quien recibe el programa (sección 10), igual que la
  GPL, y la App Store las añade. No es código nuestro, así que no podemos dar una excepción. Con clientes
  propios el riesgo desaparece en vez de quedar pendiente.
- **Alternativas descartadas:**
  - Frameworks dinámicos LGPL: habituales, pero dejan en manos de terceros que la app siga publicada.
  - Salir sin MySQL ni SQL Server: contradice el requisito de los seis motores.

### D11. Lo que la App Store comprueba, desde el primer build

- **Base de demostración:** una SQLite con datos de muestra dentro de la app, para que la revisión de Apple (y
  cualquiera sin servidor) pueda probar todo.
- **Permisos:** `NSFaceIDUsageDescription` y `NSLocalNetworkUsageDescription`, redactados en el idioma del
  usuario. No se pide ningún permiso que no se use.
- **`PrivacyInfo.xcprivacy`:** sin recogida de datos ni rastreo, con la razón de cada API de las que Apple
  exige declarar (UserDefaults, marcas de tiempo de archivos). La etiqueta de privacidad: «Datos no
  recopilados». La política de privacidad se publica en la web.
- **Cifrado:** `ITSAppUsesNonExemptEncryption` en el `Info.plist`, con la respuesta que corresponda al uso de
  TLS estándar. Se confirma una vez en App Store Connect y los builds dejan de pararse en esa pregunta.
- **Pantalla de licencias:** en Ajustes, generada desde el inventario de `THIRD-PARTY.md`. Un script de CI
  compara el inventario con lo que realmente enlaza el `xcframework`.
- **Código incluido:** solo el `squaero-logic.js` del bundle; nada se descarga (guía 2.5.2).
- **Cuenta:** Apple Developer de persona física, así que el vendedor que aparece es el nombre legal del
  autor. Solo publica apps gratuitas, así que basta el acuerdo de apps gratuitas (sin datos bancarios ni
  fiscales).

## Risks / Trade-offs

- **[Licencia] El código propio de Squaero es GPL-3.0**, y la FSF considera los términos de la App Store
  incompatibles con la GPL.
  → Un permiso adicional de la sección 7 de la GPL-3.0 que autorice la distribución por tiendas de apps. El
  autor puede darlo porque es el único titular: todo el historial es suyo. Está en consulta, con el borrador
  en #572. A partir de ahí, cada colaborador tendría que aceptarlo, y CONTRIBUTING lo diría.
- **[Licencia] Las LGPL de terceros** (MariaDB Connector/C, FreeTDS) no tienen arreglo desde nuestro lado.
  → No van en iOS (D10), y un chequeo de CI impide que entre cualquier LGPL o GPL ajena en el build de iOS.
- **[Trabajo] Dos clientes de protocolo nuevos.** TDS es el mayor: TLS dentro de PRELOGIN y muchos tipos.
  → Cada uno con su issue y sus pruebas en vivo contra los contenedores de pruebas (`quaero-my-test`,
  `quaero-mssql-test`), como libdrda. Los drivers eligen el backend al compilar.
- **[Compilación] mongo-c y libpq no se han compilado nunca para iOS.**
  → Es la primera fase, y el CI la valida antes de escribir interfaz.
- **[Tamaño] Seis clientes y OpenSSL estáticos.**
  → Medir el binario en la fase 1. Se acepta hasta unos 40 MB descargados.
- **[Segundo plano] Las conexiones se caen al suspender la app.**
  → D7: reconectar con un toque, sin fallos silenciosos.
- **[JavaScriptCore] Un módulo puro puede empezar a depender del DOM** y romper la app sin que escritorio lo
  note.
  → La prueba de CI de D2.
- **[Agente] El modelo del dispositivo es pequeño**, así que el SQL que escribe puede ser incorrecto.
  → Siempre se muestra antes de ejecutarse, solo se ejecuta `SELECT`, y se empieza por los casos más fiables
  (filtros y errores).

## Migration Plan

- Escritorio no migra nada: el registro estático es una opción de compilación, y los módulos puros siguen
  donde están.
- La app sale primero por TestFlight a un grupo pequeño, y a la App Store cuando se resuelva la licencia.
- **Vuelta atrás:** la app no toca las bases de otra forma que escritorio, y los datos de la app viven en su
  sandbox, así que desinstalarla basta.

## Open Questions

- El permiso adicional de la GPL-3.0 para la App Store: en consulta (borrador en #572).
- Identificador del bundle: `io.github.danielnuld.Squaero`, el mismo que macOS, y que el nombre «Squaero»
  esté libre en la App Store (se reserva al crear la app en App Store Connect).
- iOS mínimo: 17 para la app. El agente pide iOS 26 y Apple Intelligence.
- Si el editor propio (D8) basta o hace falta Runestone.
