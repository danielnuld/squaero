## ADDED Requirements

### Requirement: The core and the six drivers build for iOS

The build SHALL produce the core and the SQLite, MySQL/MariaDB, PostgreSQL, Informix, SQL Server and MongoDB
drivers for iOS arm64 devices and the arm64 simulator, with every client library compiled from source and linked
statically: libdrda, Squaero's own MySQL and TDS protocol clients, libpq, mongo-c-driver, libssh2 and OpenSSL.
MariaDB Connector/C and FreeTDS, both LGPL, SHALL NOT be part of the iOS build.

#### Scenario: A clean build on the CI macOS runner

- **WHEN** the iOS build runs from a clean checkout with the iOS toolchain
- **THEN** it produces one `xcframework` with a device slice and a simulator slice
- **AND** the framework holds no reference to a library outside the iOS SDK

#### Scenario: A client library fails to build

- **WHEN** one of the client libraries does not compile for iOS
- **THEN** the build fails naming that library, rather than producing a framework without its driver

### Requirement: Drivers register statically on iOS

On iOS, where the app cannot load plugins with `dlopen`, the core SHALL register every linked driver through
a static registry, with the same driver vtable the desktop plugins expose.

#### Scenario: The app starts

- **WHEN** the iOS app initialises the core
- **THEN** the six drivers are registered without any plugin directory being scanned
- **AND** `app.hello` lists the same driver names the desktop app lists

#### Scenario: Desktop is unchanged

- **WHEN** the desktop app starts
- **THEN** it still discovers drivers as plugins in `<exe_dir>/drivers`

### Requirement: The iOS app talks to the core through the documented IPC

The iOS app SHALL call the core only through the JSON-RPC methods of `docs/IPC.md`, the same contract the
desktop frontend uses, with no iOS-only entry points into driver internals.

#### Scenario: Opening a connection from Swift

- **WHEN** the app opens a connection
- **THEN** it sends `conn.open` with the driver name and the DSN, and reads the `connId` from the response

### Requirement: The core's unit tests pass on the iOS simulator

The core's unit tests SHALL run on the iOS simulator in CI, not only compile.

#### Scenario: CI runs the tests

- **WHEN** the iOS CI job runs
- **THEN** the core unit tests run on a simulator and the job fails if any of them fails
