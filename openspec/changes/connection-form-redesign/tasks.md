# Tareas

Una fase = un PR. Cada fase queda en verde (`pnpm test` + `pnpm e2e`) antes de
fusionarse y de empezar la siguiente. Plano: artboard «Nueva conexión» del
lienzo https://claude.ai/artifact/6FeFimonbnaQPURCWxgZR2.

## 1. Lógica pura (fase A)

> **Secuencia.** La 1.6 estaba partida en dos mitades que no pueden ir juntas
> aquí: `fieldErrors` acepta `{ sshRequired }` en esta fase (aditivo, no cambia
> nada de lo que ya hay), pero **dejar de exigir el nombre se mueve a la fase
> B**, que es la que rellena el nombre deducido en `save()`. Quitarlo ahora
> dejaría al formulario actual guardando conexiones sin nombre entre un PR y el
> siguiente.

- [x] 1.1 `utils/connectionFormSections.ts`: `formSections(schema)` con el mapa
      explícito clave → sección y el orden fijo; una clave desconocida cae en
      `server`
- [x] 1.2 `sectionStatus(...)` → `ok | error | off | pending`. Rojo **solo tras
      intentar guardar**: un formulario recién abierto que ya se queja de tres
      campos que nadie ha tocado es ruido, así que antes de eso es `pending`
- [x] 1.3 Mapa valor de seguridad → clave i18n de su explicación (por VALOR,
      porque no colisionan entre motores; el valor vacío va por CAMPO, porque
      «lo que decida el cliente» es distinto en cada uno) y `needsCertificates`.
      Los textos, en ambos catálogos
- [x] 1.4 `defaultConnectionName(conn)` en `utils/connections.ts`
- [x] 1.5 `engineMonogram(driver)` — **ya estaba**, lo adelantó #525 (`a66a304`)
- [x] 1.6 `fieldErrors` acepta `{ sshRequired }`; `validateConnection` no cambia.
      Lo del nombre, en la fase B (ver la nota de arriba)
- [x] 1.7 Pruebas unitarias: todas las claves de `DRIVER_SCHEMAS` están en el
      mapa **a propósito** (no vale que caigan en el fallback), ningún campo se
      pierde por el camino, orden de secciones por motor, SQLite sin secciones
      de servidor, estados de sección, todos los valores de seguridad de los
      esquemas tienen frase, nombre deducido (con base, sin base, instancia de
      Informix, rutas de Windows y POSIX, `:memory:`, valores en blanco) y el
      túnel encendido

## 2. Estructura del formulario (fase B)

- [x] 2.1 Rejilla de tarjetas de motor que sustituye al `<select>`; cambiar de
      motor conserva el comportamiento de `selectDriver`
- [x] 2.2 Secciones apiladas renderizadas desde `formSections`, sin pestañas;
      filas host + puerto y usuario + contraseña (`fieldRows`, en el módulo puro)
- [x] 2.3 Índice lateral con salto por `scrollIntoView` y marca de estado; el
      resaltado de la sección visible por `IntersectionObserver`. **Ambos van
      guardados**: jsdom no implementa ninguno de los dos y una prueba no puede
      morirse por un scroll. El estado va **en palabras** en el nombre accesible
      («Servidor: falta algo»), porque un «✓» leído en voz alta no dice nada
- [x] 2.4 Etiquetas «opcional», errores debajo del campo y salto al primer error
      al guardar o probar
- [x] 2.5 Base de datos: botón «Listar» dentro del campo y lista desplegable;
      mismo requisito de host y usuario que hoy
- [x] 2.6 Nombre opcional con el placeholder deducido; `save()` rellena el
      nombre (y aquí sí, `fieldErrors` deja de exigirlo — la mitad que la fase A
      dejó pendiente a propósito)
- [x] 2.7 Pie fijo con Cancelar, Guardar y (si llega la prop) Guardar y
      conectar
- [x] 2.8 Pruebas de componente que sustituyen a las de pestañas: secciones por
      motor, índice con error tras guardar, guardar sin nombre, SQLite
- [x] 2.9 **Defecto que costó tres fallos de e2e**: dos entradas del índice se
      tragaban el nombre de un campo que vive dentro («Acceso y base de datos» ⊃
      «Base de datos»; «Nombre y apariencia» ⊃ «Nombre»), así que buscar el
      campo por su etiqueta encontraba el botón del índice. Las secciones pasan a
      **«Acceso»** y **«Apariencia»**, con una prueba que vigila la clase entera

## 3. Seguridad, túnel, vista previa y prueba (fase C)

- [x] 3.1 Control segmentado de seguridad con frase explicativa y campos de
      certificado condicionales — y **ninguno** en SQL Server ni Informix, donde
      el driver no puede leer un fichero de CA
- [x] 3.2 Interruptor SSH: estado inicial desde `ssh_host`, avanzados plegados,
      método de autenticación segmentado, limpieza de `ssh_*` al guardar
      apagado. Apagarlo **conserva lo escrito** mientras se edita (volver a
      encenderlo no obliga a reteclear el bastión); quien descarta es
      `snapshot()`
- [x] 3.3 Columna derecha fija: vista previa (color, monograma, nombre, destino)
- [x] 3.4 Tarjeta de prueba con sus estados y el tiempo medido con
      `performance.now()`; la guía de Informix sin cliente se conserva
- [x] 3.5 `App.tsx`: `onSaveAndConnect` guarda y abre **sin pasar por la lista**
      — la conexión abriéndose ES la confirmación de que se guardó, y aterrizar
      en el gestor pondría una lista entre el usuario y su base
- [x] 3.6 Selector de emoji en «Apariencia» — ya quedó ahí en la fase B
- [x] 3.7 Pruebas (14 nuevas): apagar el túnel descarta `ssh_*` y conservar lo
      escrito al reencenderlo, editar con túnel lo enciende, certificados solo
      en verificar y nunca en SQL Server, la frase cambia con el modo, estados
      de la prueba con el tiempo, vista previa, guardar y conectar

## 4. Estilos

- [ ] 4.1 Clases `.cf-*` solo con tokens de las escalas y sin transiciones;
      revisadas en los temas oscuro, claro, Ciruela, Pizarra y Terminal
- [ ] 4.2 Retirar `.form-tabs`, `.form-tab*`, `.db-picker*` y el estilo viejo
      de las muestras de color después de comprobar con grep que no tienen otros
      usos
- [ ] 4.3 La guardia de contraste de temas sigue en verde

## 5. Idioma

- [ ] 5.1 Todo el texto nuevo por `t()`, con espejo en `messages/en.ts`;
      retirar las claves `cform.*` que queden sin uso (`cform.general`,
      `cform.tabHasErrors`, `cform.saveBlockedName`)
- [ ] 5.2 Recorrer el formulario con la app en inglés

## 6. Cierre

- [ ] 6.1 `pnpm test` en verde en las tres fases
- [ ] 6.2 `pnpm e2e` **entero** en verde en las tres fases
- [ ] 6.3 `pnpm typecheck` en verde
- [ ] 6.4 Probado a mano en la ventana nativa (WebView2, build x86): crear una
      MySQL contra el contenedor de pruebas con «Guardar y conectar»; editar una
      Informix con túnel; salto del índice y resaltado de la sección visible
- [ ] 6.5 Capturas del sitio y del manual regeneradas (`pnpm media`) si el
      formulario aparece en ellas
- [ ] 6.6 Commits en Conventional Commits referenciando el issue del cambio
