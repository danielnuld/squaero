## ADDED Requirements

### Requirement: Ajuste de estilo de rejilla
Los ajustes SHALL incluir `gridStyle` con los valores `registro`, `hoja` e
`informe`, con `registro` como valor predeterminado. Un valor guardado ausente o
desconocido MUST cargar como `registro` sin descartar el resto de ajustes. El
panel de Ajustes → Estilo MUST ofrecer los tres estilos como un grupo de opciones
excluyentes, con una frase que describa cada uno.

#### Scenario: Ajustes antiguos
- **WHEN** se cargan ajustes guardados que no tienen `gridStyle`
- **THEN** el estilo es `registro` y la densidad, los colores por tipo y el resto de ajustes conservan sus valores

#### Scenario: Valor desconocido
- **WHEN** los ajustes guardados tienen `gridStyle: "tarjetas"`
- **THEN** el estilo es `registro`

#### Scenario: Cambiar el estilo
- **WHEN** el usuario elige «Informe» en Ajustes → Estilo
- **THEN** todas las rejillas de datos abiertas pasan a Informe sin volver a ejecutar la consulta, y el estilo se mantiene tras reiniciar

### Requirement: Altura de fila por estilo y densidad
La altura de fila SHALL depender del estilo y de la densidad: Registro 28 px
(normal) y 22 px (compacta), Hoja densa 22 px y 20 px, Informe 32 px y 28 px. La
misma función MUST dar la altura a la virtualización y a la navegación con
teclado, para que ninguna de las dos se desalinee al cambiar de estilo.

#### Scenario: Informe compacto
- **WHEN** el estilo es Informe y la densidad es compacta
- **THEN** cada fila mide 28 px y la navegación con teclado lleva la celda seleccionada a la vista sin saltos

### Requirement: Estilo Registro
En el estilo Registro, la rejilla SHALL mostrar una columna inicial con el número
de fila, que al pasar el ratón o con la fila marcada muestra una casilla. La
cabecera MUST presentar el nombre de la columna y, debajo, su tipo; la clave
primaria MUST llevar un icono de llave dibujado (no un emoji) con su nombre
accesible. Los números MUST ir alineados a la derecha con cifras tabulares. NULL
MUST mostrarse como una etiqueta, distinta de una cadena vacía. Con los colores
por tipo activos, el texto MUST ir en tinta y el color MUST aplicarse solo a
números, fechas, booleanos y binarios.

#### Scenario: Marcar desde la columna del número de fila
- **WHEN** el usuario pulsa la casilla de la fila 3 y después la de la fila 5
- **THEN** las filas 3 y 5 quedan marcadas en el mismo conjunto de marcas que Ctrl+clic, y el menú contextual ofrece «Copiar 2 filas seleccionadas»

#### Scenario: Marcar todas
- **WHEN** el usuario pulsa la casilla de la cabecera de esa columna
- **THEN** quedan marcadas todas las filas visibles tras el filtro, igual que con Ctrl+A

#### Scenario: NULL frente a cadena vacía
- **WHEN** una fila tiene NULL en `saldo` y otra tiene una cadena vacía en `ciudad`
- **THEN** la celda de `saldo` muestra la etiqueta NULL y la de `ciudad` aparece vacía

### Requirement: Estilo Hoja densa
En el estilo Hoja densa, la rejilla SHALL dibujar líneas horizontales y
verticales en todas las celdas, presentar el tipo en la misma línea que el nombre
de la columna y, con los colores por tipo activos, aplicar color a todos los
tipos, incluido el texto.

#### Scenario: Colores apagados en Hoja densa
- **WHEN** el estilo es Hoja densa y el usuario apaga «Colorear los datos por tipo»
- **THEN** todas las celdas se muestran en tinta y NULL conserva su marca distintiva

### Requirement: Estilo Informe
En el estilo Informe, la rejilla SHALL omitir las líneas verticales, marcar el
tipo de cada columna con una raya de color bajo su cabecera (gris con los
colores por tipo apagados) y mostrar los datos en tinta. Los valores numéricos
MUST mostrarse con separador de miles, conservando exactamente los decimales que
envía el core. Las fechas y marcas de tiempo en formato ISO MUST mostrarse con el
mes abreviado en el idioma de la interfaz. Un valor que no se pueda interpretar
MUST mostrarse tal cual.

#### Scenario: Número con decimales
- **WHEN** una columna `decimal` trae el valor `4321.990`
- **THEN** la celda muestra `4,321.990` (no redondea ni quita ceros)

#### Scenario: Entero grande
- **WHEN** una columna `int` trae `9007199254740993`
- **THEN** la celda muestra `9,007,199,254,740,993` sin pérdida de precisión

#### Scenario: Fecha y marca de tiempo
- **WHEN** una columna `date` trae `2023-02-14` y una `timestamp` trae `2024-11-03 18:05:00`
- **THEN** las celdas muestran `14 feb 2023` y `3 nov 2024 18:05:00` con la interfaz en español

#### Scenario: Valor no ISO
- **WHEN** una columna `date` de Informix trae `14/02/2023`
- **THEN** la celda muestra `14/02/2023`

### Requirement: Los valores que salen de la rejilla son siempre crudos
En los tres estilos, copiar una celda o fila, copiar como INSERT, transferir,
exportar, filtrar y editar SHALL operar sobre el valor que envió el core, nunca
sobre el texto formateado. El tooltip de una celda formateada MUST mostrar su
valor crudo.

#### Scenario: Copiar en Informe
- **WHEN** el estilo es Informe y el usuario copia la fila con `saldo` = `1250.00` y `alta` = `2023-02-14`
- **THEN** el portapapeles contiene `1250.00` y `2023-02-14`, no `1,250.00` ni `14 feb 2023`

#### Scenario: Editar en Informe
- **WHEN** el estilo es Informe y el usuario entra a editar la celda `saldo`
- **THEN** el campo de edición contiene `1250.00`

#### Scenario: Filtrar en Informe
- **WHEN** el estilo es Informe y el usuario escribe `1250` en el filtro de `saldo`
- **THEN** la fila con `1250.00` sigue visible

### Requirement: Los estilos respetan temas y accesibilidad
Los tres estilos SHALL tomar todos sus colores de los tokens del tema activo y
MUST funcionar en los temas claro, oscuro, Ciruela, Pizarra y Terminal. Las
marcas visuales del estilo (casilla, llave, etiqueta NULL) MUST tener un
equivalente accesible: la fila marcada conserva `aria-selected` y la llave, su
nombre accesible.

#### Scenario: Tema claro
- **WHEN** el tema es claro y el estilo es Hoja densa
- **THEN** las líneas de la cuadrícula y los colores de celda usan los tokens del tema claro y la guardia de contraste pasa
