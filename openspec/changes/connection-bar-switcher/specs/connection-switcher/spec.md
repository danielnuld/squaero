## ADDED Requirements

### Requirement: La barra lista las conexiones abiertas
La barra lateral SHALL mostrar una fila por cada conexión abierta, todas a la
vez. Cada fila MUST llevar la raya del color de la conexión, el monograma de su
motor, su nombre y, debajo, el motor con su base de datos y su servidor. La fila
de la conexión enfocada MUST distinguirse de las demás.

#### Scenario: Tres conexiones abiertas
- **WHEN** el usuario tiene abiertas «Ventas», «Ventas (dev)» e «Inventario»
- **THEN** la barra muestra las tres filas, cada una con su color y su motor, y la enfocada se distingue

#### Scenario: Una conexión sin color
- **WHEN** una conexión guardada no tiene color
- **THEN** su fila se muestra sin raya de color y el resto de la fila no se desplaza

### Requirement: Enfocar con un clic
Pulsar una fila SHALL enfocar esa conexión: el explorador, las pestañas nuevas y
la base activa pasan a ser los suyos. Enfocar MUST NOT abrir ni cerrar ninguna
conexión.

#### Scenario: Cambiar de conexión
- **WHEN** el usuario pulsa la fila de «Inventario» estando enfocada «Ventas»
- **THEN** «Inventario» queda enfocada, su sección del explorador se marca como enfocada y ninguna conexión se cierra

### Requirement: Estado de cada fila
Una fila SHALL indicar que su conexión está abierta. Cuando el core informa de
que la sesión se perdió (#407), la fila MUST decirlo en lugar de seguir
afirmando que está conectada, y MUST ofrecer reconectar.

#### Scenario: Sesión caída
- **WHEN** el core informa de que la sesión de «Ventas» se perdió
- **THEN** su fila la marca como desconectada y ofrece reconectar, y la conexión sigue en la lista con sus pestañas

### Requirement: Desconectar desde su fila
Cada fila SHALL ofrecer desconectar esa conexión. Desconectar MUST cerrar solo
esa, dejando abiertas las demás, y el foco MUST pasar a otra conexión abierta o a
ninguna si no queda.

#### Scenario: Cerrar la enfocada
- **WHEN** hay dos conexiones abiertas y el usuario desconecta la enfocada
- **THEN** la otra queda enfocada y su sección del explorador es la única que queda

### Requirement: Buscar para conectar
La barra SHALL tener un botón que abre un desplegable con un campo de búsqueda.
El campo MUST filtrar las conexiones guardadas por **nombre, motor, servidor y
grupo**, sin distinguir mayúsculas ni acentos. Los resultados MUST aparecer
agrupados por su grupo, y las que ya están abiertas MUST señalarse como tales.
Elegir una conexión cerrada MUST abrirla y enfocarla; elegir una ya abierta MUST
solo enfocarla. El desplegable MUST cerrarse al elegir, con Escape y al pulsar
fuera.

#### Scenario: Buscar por motor
- **WHEN** el usuario escribe «informix» en el buscador
- **THEN** solo quedan las conexiones de Informix, agrupadas, y las abiertas aparecen marcadas

#### Scenario: Buscar por servidor
- **WHEN** el usuario escribe «10.0.4» y una conexión apunta a `10.0.4.12`
- **THEN** esa conexión aparece en los resultados

#### Scenario: Abrir desde el buscador
- **WHEN** el usuario elige «Inventario», que estaba cerrada
- **THEN** se abre, queda enfocada, aparece su fila en la barra y el desplegable se cierra

#### Scenario: Elegir una ya abierta
- **WHEN** el usuario elige una conexión que ya estaba abierta
- **THEN** solo se enfoca: no se abre una segunda sesión

#### Scenario: Sin coincidencias
- **WHEN** ninguna conexión coincide con lo escrito
- **THEN** el desplegable lo dice, en lugar de quedarse vacío

### Requirement: Nada abierto
Sin conexiones abiertas, la barra SHALL decir que no hay ninguna y ofrecer el
buscador, y el explorador MUST seguir mostrando su indicación de conectar.

#### Scenario: Primer arranque
- **WHEN** la app abre sin conexiones abiertas
- **THEN** la barra dice que no hay ninguna abierta y ofrece abrir el buscador

### Requirement: La barra no repite la cabecera de sección
La barra SHALL limitarse a decir qué está abierto y cuál está enfocada, más
desconectar y reconectar. Las acciones de una conexión concreta (herramientas,
refrescar, plegar, base activa) MUST seguir viviendo en la cabecera de su sección
del explorador (#444), sin duplicarse en la barra.

#### Scenario: Acciones sin duplicar
- **WHEN** hay dos conexiones abiertas
- **THEN** cada sección del explorador conserva sus botones de herramientas, refrescar y desconectar, y la barra no añade otra copia de las herramientas ni del refrescar

### Requirement: El explorador sigue apilando una sección por conexión
Este cambio MUST NOT alterar el explorador: una sección plegable por conexión
abierta, el reparto de altura por flex, el filtro y el scroll propios de cada
árbol, y el selector de base activa dentro de la sección enfocada.

#### Scenario: Dos árboles a la vez
- **WHEN** hay dos conexiones abiertas y ninguna sección plegada
- **THEN** los dos árboles se ven al mismo tiempo, cada uno con su filtro y su scroll
