# Cómo contribuir a Quaero

¡Gracias por tu interés! Quaero está pensado para recibir aportes de dos comunidades:

- **Desarrolladores de sistemas / C** → núcleo y **drivers** de motores nuevos.
- **Desarrolladores web** → la interfaz (frontend sobre webview).

La frontera entre ambos es estable y está documentada, así que puedes contribuir en un lado sin conocer el otro.

Al participar en este proyecto aceptas cumplir su [Código de Conducta](CODE_OF_CONDUCT.md).

## Antes de empezar

- Lee el [ROADMAP](ROADMAP.md) y la [arquitectura](docs/ARCHITECTURE.md).
- Busca un issue con la etiqueta `good first issue`.
- Comenta en el issue antes de empezar para evitar trabajo duplicado.

## Contribuir un driver de base de datos

El camino más valioso para la comunidad. Un driver implementa el [contrato vtable](docs/DRIVER_API.md):

1. Copia el driver de referencia (SQLite) como plantilla.
2. Implementa la vtable contra la librería cliente del motor.
3. Compila como biblioteca compartida.
4. Agrega tests y documenta los `features` soportados.

> Importante para licencias: los drivers de clientes **propietarios** (Oracle, Informix) se distribuyen por separado y se cargan en runtime; no se enlazan al núcleo GPL.

## Contribuir a la interfaz

El frontend solo habla con el núcleo vía el [protocolo IPC](docs/IPC.md). Mientras respetes ese contrato, puedes mejorar/rediseñar la UI libremente. Prioriza la **virtualización** y la eficiencia: nada de renderizar miles de filas o nodos fuera del viewport.

## Estilo

- C11. Código que se lea como el código circundante: mismos nombres, mismo nivel de comentarios.
- El núcleo **no** importa nada de la UI.
- Cambios al contrato IPC o a la vtable requieren discusión previa en un issue: rompen a todos.

## Licencia

Al contribuir aceptas que tu aporte se publique bajo [GPLv3](LICENSE).
