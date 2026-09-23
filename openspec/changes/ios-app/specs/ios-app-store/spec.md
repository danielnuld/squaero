## ADDED Requirements

### Requirement: Every binary in the app has a license the App Store allows

The iOS app SHALL contain only code under licenses that allow distribution through the App Store: permissive
licenses (MIT, BSD, Apache-2.0, PostgreSQL, public domain, SIL OFL for fonts) and Squaero's own code under
whatever permission its author grants for the App Store. It SHALL NOT contain LGPL or GPL code by other
authors.

#### Scenario: MySQL and SQL Server on iOS

- **WHEN** the iOS build links the MySQL/MariaDB and SQL Server drivers
- **THEN** they use Squaero's own Apache-2.0 protocol clients, not MariaDB Connector/C or FreeTDS

#### Scenario: A dependency with a copyleft license sneaks in

- **WHEN** a dependency under LGPL or GPL by another author is added to the iOS build
- **THEN** the license check in CI fails and names it

### Requirement: The app shows its third-party licenses

The app SHALL list every third-party component it contains with its license text and notices (including the
Apache-2.0 `NOTICE` files), reachable from Ajustes.

#### Scenario: Opening the licenses

- **WHEN** the user opens Ajustes and then Licencias
- **THEN** each component appears with its version and its full license text

### Requirement: App Review can use the app without a server

The app SHALL include a demo database (SQLite) that opens from the connections screen with no server, no
account and no network, so App Review and new users can try browsing, editing, queries and export.

#### Scenario: A reviewer opens the app

- **WHEN** the app starts for the first time
- **THEN** the connections screen offers "Base de demostración", and opening it shows tables with data that
  can be edited and exported

### Requirement: Permissions are explained in plain language

The app SHALL declare a clear purpose string for each permission it asks for: Face ID (to unlock saved
passwords), the local network (to reach database servers on the user's network) and Files (to open SQLite
files and CA certificates, and to save exports). It SHALL NOT ask for any permission it does not use.

#### Scenario: The first connection to a server on the local network

- **WHEN** the user opens a connection to a server on the local network for the first time
- **THEN** iOS asks for local-network access with Squaero's purpose string, and a refusal is reported with how
  to allow it in Settings

### Requirement: The privacy declarations match what the app does

The app SHALL ship a privacy manifest (`PrivacyInfo.xcprivacy`) that declares no data collection and no
tracking, with the reason for each required-reason API it uses; its App Store privacy label SHALL say "Data
Not Collected"; and a privacy policy SHALL be published at a public URL that says the same.

#### Scenario: A new SDK or API

- **WHEN** a change starts using a required-reason API (for example file timestamps or UserDefaults)
- **THEN** the manifest gains that API with its reason in the same change

### Requirement: Encryption is declared for export compliance

The app SHALL declare in its `Info.plist` how it uses encryption (TLS through OpenSSL, and the Keychain),
so each build goes to App Store Connect with its export-compliance answer instead of blocking on a manual
question.

#### Scenario: Uploading a build

- **WHEN** CI uploads a build to App Store Connect
- **THEN** the build does not wait on the encryption question, because the declaration is in the app

### Requirement: The app runs only bundled code

The app SHALL NOT download or execute code at runtime: the JavaScript it runs through JavaScriptCore is the
bundle shipped inside the app, as App Review guideline 2.5.2 requires.

#### Scenario: Updating the shared logic

- **WHEN** the shared JavaScript modules change
- **THEN** the change reaches users only through a new build of the app
