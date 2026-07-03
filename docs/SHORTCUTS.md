# Atajos de teclado

Pulsa **F1** dentro de la app para ver esta misma lista (la ayuda en pantalla se
genera desde la fuente única `frontend/src/utils/shortcuts.ts`, así que no se
desincroniza del comportamiento).

`Mod` es **Ctrl** en Windows/Linux y **⌘ (Cmd)** en macOS.

| Acción | Atajo |
|---|---|
| Ejecutar la consulta | `Mod`+Enter |
| Formatear la consulta | `Mod`+Shift+F |
| Nueva pestaña | `Mod`+Alt+T |
| Cerrar la pestaña activa | `Mod`+Alt+W |
| Siguiente pestaña | Ctrl+RePág (PageDown) |
| Pestaña anterior | Ctrl+AvPág (PageUp) |
| Refrescar datos y árbol | F5 |
| Cambiar tema claro/oscuro | `Mod`+Alt+L |
| Mostrar/ocultar esta ayuda | F1 |

Notas:

- **Ejecutar** y **formatear** los maneja el editor (CodeMirror); funcionan
  cuando el foco está en el editor (formatear también con el botón "Formatear").
  El formateo usa el dialecto del motor de la conexión activa y deja intacta una
  consulta de MongoDB (mongosh no es SQL).
- Las combinaciones usan `Alt` para no chocar con atajos que el host de la
  ventana (webview) pueda reservar, como Ctrl+T / Ctrl+W del navegador.
- El **tema** también se cambia con el botón de la barra de estado; la preferencia
  (sistema / claro / oscuro) se recuerda entre sesiones.
