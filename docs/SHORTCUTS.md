# Atajos de teclado

Pulsa **F1** dentro de la app para ver esta misma lista (la ayuda en pantalla se
genera desde la fuente única `frontend/src/utils/shortcuts.ts`, así que no se
desincroniza del comportamiento).

`Mod` es **Ctrl** en Windows/Linux y **⌘ (Cmd)** en macOS.

| Acción | Atajo |
|---|---|
| Ejecutar la consulta | `Mod`+Enter |
| Nueva pestaña | `Mod`+Alt+T |
| Cerrar la pestaña activa | `Mod`+Alt+W |
| Siguiente pestaña | Ctrl+RePág (PageDown) |
| Pestaña anterior | Ctrl+AvPág (PageUp) |
| Cambiar tema claro/oscuro | `Mod`+Alt+L |
| Mostrar/ocultar esta ayuda | F1 |

Notas:

- **Ejecutar la consulta** lo maneja el editor (CodeMirror); funciona cuando el
  foco está en el editor.
- Las combinaciones usan `Alt` para no chocar con atajos que el host de la
  ventana (webview) pueda reservar, como Ctrl+T / Ctrl+W del navegador.
- El **tema** también se cambia con el botón de la barra de estado; la preferencia
  (sistema / claro / oscuro) se recuerda entre sesiones.
