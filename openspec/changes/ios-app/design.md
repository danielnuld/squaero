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
  Queda como salida si la licencia LGPL lo exige (ver Riesgos).

### D4. Toolchain de iOS y los clientes desde el código fuente

Un `cmake/toolchain-ios.cmake` (`CMAKE_SYSTEM_NAME=iOS`, arm64, sysroot `iphoneos` o `iphonesimulator`) compila
el núcleo, los drivers y los clientes, y un script arma el `xcframework` con las dos porciones.
- **OpenSSL:** con los objetivos `ios64-xcrun` e `iossimulator-xcrun`.
- **libpq:** desde el código fuente, extendiendo la receta de `cmake/libpq-win32` con un `pg_config.h` para
  Darwin arm64.
- **mongo-c 1.30:** no configura con CMake 4 en Apple (política CMP0042 y un `try_compile`). Se parchea en el
  `FetchContent` o se compila con CMake 3.31 en ese subproyecto.
- **FreeTDS:** necesita `iconv`, que está en el SDK de iOS.
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

## Risks / Trade-offs

- **[Licencia] MariaDB Connector/C y FreeTDS son LGPL**, y enlazarlos de forma estática en una app de la App
  Store choca con el derecho a reenlazar. El código propio de Squaero es GPL-3.0, y la App Store tiene
  términos que la FSF considera incompatibles con la GPL.
  → Revisarlo antes de publicar. Salidas posibles: frameworks dinámicos embebidos para las LGPL, y una
  excepción de licencia para la App Store, que el autor puede dar mientras sea el único titular del código.
- **[Compilación] FreeTDS, mongo-c y libpq no se han compilado nunca para iOS.**
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

- Cuenta de Apple Developer e identificador del bundle (`io.github.danielnuld.Squaero`, el mismo que macOS).
- La vía de licencia para la App Store (LGPL y GPL).
- iOS mínimo: 17 para la app. El agente pide iOS 26 y Apple Intelligence.
- Si el editor propio (D8) basta o hace falta Runestone.
