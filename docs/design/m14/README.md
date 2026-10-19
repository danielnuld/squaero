# Rediseño M14 — dirección de estilo

Decisión de #678: Squaero adopta el **rediseño M14** (un solo layout para toda la app) con **cuatro estilos** seleccionables en Ajustes › Apariencia. **B · Nativo** es el predeterminado.

| Estilo | Carácter | Base | Acento | Tipografía | Radios |
|---|---|---|---|---|---|
| **B · Nativo** (predeterminado) | Claro, sobrio, integrado con el sistema | `#ffffff` sobre chrome `#e9edf1` | `#0f7b72` | Fuente del sistema (Segoe UI Variable / SF Pro / Cantarell) + JetBrains Mono | 6 / 8 / 12 px |
| **A · Quiet pro** | Oscuro frío para jornadas largas | `#0f1216` | `#3fb8a9` | Geist + Geist Mono | 4 / 6 / 8 px |
| **C · Editorial** | Oscuro cálido, técnico | `#17140f` | `#e0a43c` | IBM Plex Sans + IBM Plex Mono, etiquetas en minúscula | 2 px |
| **Rosa pastel** | Claro y suave | `#fffafc` sobre chrome `#fbe7ef` | `#c2477a` | Figtree + JetBrains Mono | 8 / 12 / 16 px |

Los cuatro comparten el mismo layout y los mismos componentes; un estilo solo redefine variables CSS. Todos los pares de color medidos cumplen WCAG 2.2 AA (texto 4,5:1, bordes de controles y foco 3:1). Los valores exactos están en [`prototype/theme-helmet.txt`](prototype/theme-helmet.txt).

## Por qué

- La interfaz actual tenía rasgos genéricos (acento índigo por defecto, etiquetas en MAYÚSCULAS, negritas en todas partes, iconos de web app) y 42 hallazgos de UI/UX. El rediseño corrige la estructura (ventana, explorador, rejilla, editor, diálogos) y no solo el color: ver [`audit/`](audit/).
- Un solo layout con varios estilos permite elegir el aspecto sin multiplicar el trabajo de implementación: cada estilo es un conjunto de tokens.
- B es el predeterminado porque es claro, legible y se integra con el sistema (Mica / vibrancy en la barra de título y el panel lateral a través del shell nativo).

## Principios del layout

- **Barra de título propia por sistema operativo** (Windows con menú y Snap, macOS con semáforos y menú global, GNOME con header bar), búsqueda Ctrl+K centrada y notificaciones con historial.
- **Columna de paneles** a la izquierda (Objetos, Historial, Snippets, Datos; abajo Conexiones y Ajustes). Las herramientas viven en el menú Herramientas y en la paleta.
- **Explorador** con varias conexiones, cada una con su **color** (también en pestañas y barra de estado), desconectar/reconectar, esquemas y columnas.
- **Barra de documento con jerarquía**: una acción primaria, acciones con icono y texto, el resto en «Más». Datos · Estructura · Índices · DDL siempre en el mismo sitio.
- **Rejilla**: tipo y claves en la cabecera, edición en la celda con «Guardar (n)», selección de rango con agregados, valores crudos.
- **Editor**: selector de conexión, «Ejecutar sentencia» con alcance explícito (sentencia / selección / script), Detener durante la ejecución, resultados en pestañas.
- **Un solo patrón de diálogo y de asistente**; las acciones destructivas nombran objeto y cantidad y piden confirmación.

## Contenido

- [`prototype/`](prototype/) — fuentes del prototipo navegable (113 pantallas + piezas compartidas) en formato Design Component (`.dc.html`):
  - `bodies/*.body` — una pantalla o componente por archivo (fuente de verdad).
  - `build.py` — ensambla `bodies/` en `project/*.dc.html` con la cabecera y los tokens de `theme-helmet.txt`.
  - `theme-helmet.txt` — tokens de los cuatro estilos y clases utilitarias.
  - `REDESIGN.md`, `AUDIT-RULES.md` — reglas de diseño que siguen todas las pantallas.
  - `icons.md` — set de iconos.
  - `generators/` — scripts que generaron grupos de pantallas (referencia; escriben en `bodies/`).
  - `shoot.mjs` — renderiza cada pantalla con Playwright y guarda captura y errores (necesita el runtime del lienzo como `support.js`, que no se versiona).
- [`audit/`](audit/) — auditorías UI/UX de la app actual (`app-actual.md`, 42 hallazgos) y del rediseño (`rediseno.md`, 43 hallazgos), y los scripts de contraste.

Prototipo publicado (privado, compartir desde su menú): https://claude.ai/artifact/3pYMFRk6WLiVtpV5KVdMWE

## Implementación

Este documento cierra la fase 0 (#678). Las fases siguientes llevan el rediseño a la app: identidad (#679), densidad global (#682), iconos (#683), layout principal (#688), árbol (#689), rejilla (#690), editor (#691), diálogos (#692), barra de estado y notificaciones (#693), bienvenida (#694) y propagación (#696). Los cuatro estilos se añaden como temas integrados en `frontend/src/utils/themes.ts`.
