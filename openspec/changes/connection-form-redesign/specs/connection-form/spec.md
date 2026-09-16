## ADDED Requirements

### Requirement: El motor se elige primero
El formulario SHALL mostrar como primera sección una rejilla de tarjetas, una por
cada motor de `AVAILABLE_DRIVERS`, con su monograma, su nombre y su puerto por
defecto (o «Archivo local» si el motor no usa servidor). Elegir otro motor MUST
vaciar los parámetros del motor anterior y devolver la prueba al estado «sin
probar», como hace hoy `selectDriver`.

#### Scenario: Cambiar de motor
- **WHEN** el usuario tiene MySQL elegido con host y usuario escritos y pulsa la tarjeta de PostgreSQL
- **THEN** la tarjeta de PostgreSQL queda marcada, los campos quedan vacíos con los placeholders de PostgreSQL y la tarjeta de prueba vuelve a «sin probar»

#### Scenario: Motor de archivo
- **WHEN** el usuario elige SQLite
- **THEN** el formulario muestra la sección «Archivo» con la ruta y el botón Examinar, y no muestra las secciones Servidor, Autenticación, Seguridad ni Túnel SSH

### Requirement: Secciones en el orden de la tarea
El formulario SHALL presentar los campos en una sola página, agrupados en
secciones en este orden: Motor, Servidor (Archivo en SQLite), Autenticación y
base de datos, Seguridad, Túnel SSH, y Nombre y apariencia. Una sección sin
campos para el motor elegido MUST NOT mostrarse. El formulario MUST NOT usar
pestañas para repartir los campos.

#### Scenario: Informix muestra sus campos propios
- **WHEN** el usuario elige IBM Informix
- **THEN** la sección Servidor incluye host, «Puerto o servicio» y el nombre del servidor Informix, y la sección Seguridad ofrece el protocolo (TCP o SSL)

#### Scenario: Ningún campo del esquema se pierde
- **WHEN** se renderiza el formulario para cualquier motor de `DRIVER_SCHEMAS`
- **THEN** cada campo del esquema de ese motor aparece exactamente en una sección

### Requirement: Índice de secciones con estado
El formulario SHALL mostrar un índice con una entrada por sección visible.
Pulsar una entrada MUST desplazar el formulario hasta esa sección. Cada entrada
MUST indicar si la sección está completa (sus campos obligatorios tienen valor),
tiene errores (solo después de intentar guardar o probar) o está desactivada
(Túnel SSH apagado).

#### Scenario: Errores reflejados en el índice
- **WHEN** el usuario pulsa Guardar con el host vacío
- **THEN** la entrada «Servidor» del índice aparece marcada con error y el formulario se desplaza al primer campo con error

#### Scenario: Túnel apagado
- **WHEN** el interruptor del túnel SSH está apagado
- **THEN** la entrada «Túnel SSH» del índice aparece desactivada, no con error

### Requirement: Validación por campo tras el primer intento
Los errores SHALL mostrarse debajo de cada campo y solo después de que el usuario
intente guardar, probar o listar bases, de modo que un formulario recién abierto
no aparezca lleno de avisos. Los campos no obligatorios MUST llevar la marca
«opcional» en su etiqueta. Un campo numérico con un valor no numérico MUST
mostrar error.

#### Scenario: Formulario nuevo sin avisos
- **WHEN** se abre «Nueva conexión»
- **THEN** ningún campo muestra error

#### Scenario: Guardar bloqueado
- **WHEN** el usuario pulsa Guardar con dos campos obligatorios vacíos
- **THEN** no se llama a `onSave`, ambos campos muestran su error y el pie dice «Faltan 2 campos obligatorios.»

### Requirement: Nombre opcional con valor deducido
El nombre de la conexión SHALL ser opcional. Mientras está vacío, su
placeholder MUST mostrar el nombre que se usará: `base @ host` si hay base,
`host` si no la hay, o el nombre del archivo en SQLite. Al guardar con el nombre
vacío, la conexión guardada MUST llevar ese nombre deducido.

#### Scenario: Guardar sin nombre
- **WHEN** el usuario completa host `10.0.4.12`, usuario y base `ventas`, deja el nombre vacío y pulsa Guardar
- **THEN** `onSave` recibe una conexión con nombre `ventas @ 10.0.4.12`

#### Scenario: Nombre escrito
- **WHEN** el usuario escribe «Ventas» en el nombre
- **THEN** la conexión se guarda con el nombre «Ventas»

### Requirement: Opciones de seguridad explicadas
La sección Seguridad SHALL ofrecer las opciones del motor (modo SSL, cifrado,
protocolo o TLS) como un control segmentado, y MUST mostrar debajo una frase que
explique qué hace la opción elegida. Los campos de certificado MUST mostrarse
solo en los modos que verifican certificados.

#### Scenario: Verificar CA en MySQL
- **WHEN** el usuario elige «Verificar CA» en MySQL
- **THEN** aparecen los campos de certificado de CA, certificado de cliente y clave de cliente, y la frase explica que se comprueba que el certificado lo firmó la CA

#### Scenario: Sin cifrado
- **WHEN** el usuario elige «Desactivado»
- **THEN** los campos de certificado no se muestran y la frase avisa de que el tráfico viaja sin cifrar

### Requirement: Túnel SSH con interruptor explícito
La sección Túnel SSH SHALL tener un interruptor. Encendido, MUST mostrar los
campos del túnel, y el servidor SSH MUST ser obligatorio. Apagado, MUST ocultar
esos campos, y guardar MUST dejar vacíos todos los parámetros `ssh_*`. Al editar
una conexión que ya tiene `ssh_host`, el interruptor MUST aparecer encendido.
Los campos avanzados (host y puerto destino, política y fichero de hosts
conocidos) MUST quedar plegados por defecto.

#### Scenario: Apagar el túnel descarta sus datos
- **WHEN** el usuario enciende el túnel, escribe un servidor SSH, lo apaga y guarda
- **THEN** la conexión guardada no tiene `ssh_host` ni ningún otro parámetro `ssh_*` con valor

#### Scenario: Editar una conexión con túnel
- **WHEN** se abre «Editar conexión» para una conexión con `ssh_host` = `bastion.local`
- **THEN** el interruptor aparece encendido y el campo servidor SSH muestra `bastion.local`

### Requirement: Autenticación SSH según el método
El formulario SHALL ofrecer el método de autenticación SSH como un control
segmentado (por defecto, agente, contraseña o clave privada) y MUST mostrar solo
los campos del método elegido.

#### Scenario: Clave privada
- **WHEN** el usuario elige «Clave privada»
- **THEN** se muestran la ruta de la clave con Examinar y la frase de la clave, y no se muestra la contraseña SSH

### Requirement: Vista previa de la conexión
El formulario SHALL mostrar, siempre visible mientras se desplaza la página, cómo aparecerá la
conexión en la barra de conexiones: color, monograma del motor, nombre (el
escrito o el deducido) y el destino. La vista previa MUST actualizarse con cada
cambio.

#### Scenario: Cambiar el color
- **WHEN** el usuario elige el color rojo
- **THEN** la raya de color de la vista previa pasa a rojo sin guardar nada

### Requirement: Prueba de conexión con estados visibles
El formulario SHALL tener una tarjeta de prueba, siempre visible mientras se desplaza la página, con
los estados: sin probar, faltan campos, probando (con el destino host:puerto),
correcta (con el tiempo de respuesta medido por el formulario) y fallo (con el
mensaje del motor tal cual). Si el fallo es de Informix sin cliente instalado, la
tarjeta MUST mostrar la guía de instalación y el botón que abre la descarga de
IBM. Probar MUST NOT guardar nada.

#### Scenario: Prueba correcta
- **WHEN** el usuario pulsa «Probar conexión» con los datos válidos y `onTest` resuelve
- **THEN** la tarjeta muestra «Conexión correcta» y el tiempo en milisegundos que tardó `onTest`

#### Scenario: Prueba fallida
- **WHEN** `onTest` rechaza con «Access denied for user 'root'»
- **THEN** la tarjeta muestra «No se pudo conectar» y el mensaje completo en tipografía monoespaciada

#### Scenario: Informix sin cliente
- **WHEN** `onTest` rechaza con el error de cliente de Informix ausente
- **THEN** la tarjeta muestra la guía de instalación y el botón de descarga, no el diagnóstico en bruto

### Requirement: Guardar y conectar
El pie del formulario SHALL ofrecer Cancelar, Guardar y «Guardar y conectar»
(acción principal). «Guardar y conectar» MUST guardar la conexión igual que
Guardar y, a continuación, abrirla y enfocarla. Cuando no se proporciona
`onSaveAndConnect`, el botón MUST NOT mostrarse.

#### Scenario: Guardar y conectar
- **WHEN** el usuario pulsa «Guardar y conectar» con el formulario válido
- **THEN** la conexión queda guardada, se cierra el formulario y la conexión se abre y queda enfocada en la barra

#### Scenario: Cancelar con Escape
- **WHEN** el usuario pulsa Escape
- **THEN** el formulario se cierra sin guardar
