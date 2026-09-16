## Why

La ventana «Nueva conexión» es la primera pantalla que ve quien instala Squaero, y
hoy es la menos pensada de la app. `ConnectionForm.tsx` pinta los campos en una
sola columna estirada a todo el ancho del panel y en un orden que no sigue la
tarea:

1. **Lo cosmético va antes que lo necesario.** Nombre, color, grupo e icono
   ocupan la pantalla antes de elegir el motor, que es lo que decide todo lo
   demás. Elegirlo es además un `<select>` nativo con emoji.
2. **El nombre bloquea el guardado.** Es obligatorio aunque de host y base se
   puede deducir uno razonable, y el aviso de error lo dice aparte
   (`cform.saveBlockedName`).
3. **Lo importante se esconde en pestañas.** SSL y SSH son pestañas
   «General / SSL / SSH». No hay nada que diga que el túnel existe ni si está
   activo: se activa escribiendo en `ssh_host`, en una pestaña que no se ha
   abierto.
4. **Las opciones de seguridad no se explican.** «verify_ca» y «verify_identity»
   aparecen como valores de un desplegable, sin decir qué protege cada uno.
5. **La prueba de conexión da poca información.** Es una línea de texto verde o
   roja entre los campos y los botones, que desaparece al hacer scroll.
6. **No hay «guardar y conectar».** Tras guardar se abre el menú de conexiones
   y hay que buscar la que se acaba de crear para conectarla.

El prototipo del lienzo de diseño («Nueva conexión») resuelve estos seis puntos
con los tokens y componentes que la app ya tiene.

## What Changes

- **Primero el motor**, elegido con una rejilla de tarjetas (monograma, nombre y
  puerto por defecto) en lugar del `<select>`.
- **Una sola página con secciones** en el orden de la tarea: Motor → Servidor
  (o Archivo, en SQLite) → Autenticación y base de datos → Seguridad → Túnel
  SSH → Nombre y apariencia. Desaparecen las pestañas del formulario.
- **Índice lateral** que salta a cada sección y marca su estado: completa,
  con errores o desactivada (túnel apagado).
- **Campos compactos en fila** donde van juntos (host + puerto, usuario +
  contraseña), con la etiqueta encima, un «opcional» visible en los campos que
  no son obligatorios y el error debajo del campo.
- **Nombre opcional**: si se deja vacío se guarda un nombre deducido
  (`base @ host`, o el nombre del archivo en SQLite), que se muestra como
  placeholder mientras se escribe.
- **Seguridad con controles segmentados** y una frase por opción que explica
  qué protege; los campos de certificado solo aparecen en los modos que los
  usan.
- **Túnel SSH con interruptor explícito.** Encenderlo despliega sus campos;
  apagarlo limpia los `ssh_*`. El modelo guardado no cambia: el túnel sigue
  activándose porque `ssh_host` tiene valor.
- **Columna derecha fija** con la vista previa de cómo se verá la conexión en la
  barra y una tarjeta de prueba con cuatro estados (sin probar, probando,
  correcta con tiempo de respuesta, fallo con el mensaje del motor). La guía
  de «falta el cliente de Informix» (#506) se mantiene.
- **Pie fijo** con Cancelar, Guardar y **Guardar y conectar** como acción
  principal.
- El selector de icono (emoji) **se conserva**, dentro de «Nombre y apariencia».

## Capabilities

### New Capabilities

- `connection-form`: crear y editar una conexión guardada — elegir motor,
  completar los datos que ese motor pide, probarla y guardarla (y opcionalmente
  conectarla) — con validación por campo y explicación de las opciones de
  seguridad.

### Modified Capabilities

Ninguna: no hay specs previas de este formulario en `openspec/specs/`.

## Impact

- **Solo frontend.** `components/ConnectionForm.tsx` (reescrito),
  `utils/connections.ts` (`fieldErrors` deja de exigir el nombre;
  `defaultConnectionName`, `engineMonogram`), un módulo puro nuevo
  `utils/connectionFormSections.ts` (qué campo va en qué sección y el estado de
  cada una), `App.tsx` (prop `onSaveAndConnect`), `styles.css` y los dos
  catálogos de mensajes.
- **Sin cambios de modelo, almacenamiento ni IPC.** `Connection` y los
  `DriverSchema` no cambian; las conexiones guardadas y los ficheros exportados
  siguen siendo compatibles. `validateConnection` (importación) sigue exigiendo
  el nombre, porque el formulario lo rellena antes de guardar.
- **Pruebas afectadas:** `ConnectionForm.test.tsx` (las pruebas de pestañas se
  sustituyen por pruebas de secciones), `ConnectionFormClientMissing.test.tsx`
  (se mantiene) y `connections.test.ts` (validación del nombre). El e2e
  `import-connections.spec.ts` no pasa por el formulario, pero se ejecuta la
  suite entera.
- Fuera de alcance, cada uno en su issue si se pide: pegar una URL de conexión
  (`mysql://…`) para rellenar los campos, un «entorno» (prod/dev) distinto del
  color, y los rediseños de la barra de conexiones y de la rejilla que están en
  el mismo lienzo.
