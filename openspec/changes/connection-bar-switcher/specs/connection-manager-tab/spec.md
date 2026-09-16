## ADDED Requirements

### Requirement: El gestor de conexiones es una pestaña
Administrar las conexiones guardadas SHALL ocurrir en una pestaña de herramienta
propia («Conexiones»), no dentro del desplegable de la barra. La pestaña MUST
ofrecer crear, editar, borrar, mover a grupo, importar y exportar, y MUST
listar todas las guardadas, abiertas o no, agrupadas. MUST ser una herramienta
**global**: no depende de la conexión enfocada y una sola pestaña sirve para
todas.

#### Scenario: Abrir el gestor
- **WHEN** el usuario pulsa «Gestionar» en el pie del buscador, o la herramienta «Conexiones»
- **THEN** se abre (o se reenfoca) una única pestaña «Conexiones» con la lista completa

#### Scenario: Una sola pestaña
- **WHEN** el usuario abre el gestor con «Ventas» enfocada y después con «Inventario» enfocada
- **THEN** sigue siendo la misma pestaña, no una por conexión

#### Scenario: Borrar una conexión abierta
- **WHEN** el usuario borra desde la pestaña una conexión que está abierta
- **THEN** se pide confirmación como hoy, y al borrarla su fila desaparece de la barra

### Requirement: Exportar e importar conservan su contrato
La pestaña SHALL conservar el exportar con su casilla de **incluir contraseñas**
y su aviso de texto plano, y el importar que lee el formato propio, el
`data-sources.json` de DBeaver (con su `credentials-config.json`) y el `.ncx` de
Navicat, con el mensaje de resultado.

#### Scenario: Exportar con contraseñas
- **WHEN** el usuario marca «Incluir contraseñas» y exporta
- **THEN** el aviso de texto plano está visible antes de confirmar, y el archivo se genera igual que hoy

#### Scenario: Importar de otra herramienta
- **WHEN** el usuario elige a la vez los dos ficheros de DBeaver
- **THEN** las conexiones se importan con sus contraseñas y la pestaña dice cuántas entraron

### Requirement: El buscador lleva a crear, importar y gestionar
El pie del desplegable de búsqueda SHALL ofrecer tres accesos: **nueva
conexión**, **importar** y **gestionar**. Crear y editar MUST seguir abriendo el
formulario de conexión que ya existe, y guardar MUST dejar la conexión lista para
abrirse sin obligar a reabrir ningún desplegable.

#### Scenario: Crear desde el buscador
- **WHEN** el usuario pulsa «Nueva conexión» en el pie del desplegable
- **THEN** se abre el formulario de conexión y el desplegable se cierra

#### Scenario: Guardar una conexión nueva
- **WHEN** el usuario guarda una conexión nueva
- **THEN** aparece en la lista del gestor y en el buscador, sin que la app tenga que reabrir el desplegable para mostrarla
