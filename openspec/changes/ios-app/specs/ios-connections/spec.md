## ADDED Requirements

### Requirement: Connections to the six engines

The iOS app SHALL create, edit, group and delete connections to Informix, PostgreSQL, MySQL/MariaDB, SQL
Server, MongoDB and SQLite, with the same fields each driver takes on desktop.

#### Scenario: Informix over DRDA

- **WHEN** the user creates an Informix connection
- **THEN** the form asks for server, DRDA port (9089 by default), database, user and password
- **AND** explains that the server's `drsoctcp` listener is used and no IBM client is needed

#### Scenario: A local SQLite file

- **WHEN** the user picks a `.sqlite` or `.db` file from Files
- **THEN** it opens as a SQLite connection, read and write, inside the app's sandbox

### Requirement: Passwords live in the Keychain behind Face ID

Passwords and SSH keys SHALL be stored in the iOS Keychain, bound to the device, and SHALL be read only after
Face ID or the device passcode succeeds. They SHALL NOT be stored in the app's files or its preferences.

#### Scenario: Connecting

- **WHEN** the user opens a connection that has a saved password
- **THEN** the app asks for Face ID before reading it
- **AND** a failed or cancelled Face ID opens nothing and says why

#### Scenario: Not saving the password

- **WHEN** the user turns off "Guardar en el llavero"
- **THEN** the password is asked each time and never written anywhere

### Requirement: TLS and SSH tunnels

Every networked engine SHALL support TLS with certificate verification and an SSH tunnel, with the same
modes as desktop, and a CA file imported from Files.

#### Scenario: Verified TLS

- **WHEN** a connection requires TLS with verification and the server's certificate does not match the CA
- **THEN** the connection fails with the verification error, and the app does not offer to skip it silently

#### Scenario: SSH tunnel

- **WHEN** a connection goes through an SSH tunnel with a password or a key
- **THEN** the app opens the tunnel and connects through it, and a wrong SSH credential is reported as such

### Requirement: The app survives being sent to the background

iOS closes the sockets of a suspended app, so open connections and tunnels drop; on return the app SHALL show which
connections were lost and reconnect them on request, never leaving a screen that fails silently.

#### Scenario: Returning after an hour

- **WHEN** the user returns to the app after its connections were closed by the system
- **THEN** each affected connection shows it was disconnected, with a button to reconnect

### Requirement: Importing connections from desktop

The app SHALL import the connection file that Squaero desktop exports, without passwords unless the file
carries them.

#### Scenario: Importing through Files

- **WHEN** the user opens a desktop export with Squaero
- **THEN** its connections and groups appear, and each one without a password asks for it on first use
