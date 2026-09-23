## ADDED Requirements

### Requirement: The frontend's pure modules run on iOS unchanged

The build SHALL bundle the pure modules the iOS app needs from `frontend/src/utils` into one JavaScript file,
and the app SHALL run them with JavaScriptCore behind a Swift facade, without a second implementation in
Swift.

#### Scenario: Building the bundle

- **WHEN** the iOS build runs
- **THEN** it produces `squaero-logic.js` with the exporters, the server-side filter builder, the SQL
  variables, the foreign-key queries, the readable error texts and identifier quoting

#### Scenario: Same answer on both platforms

- **WHEN** the app builds the filter SQL for Informix with `juzgado = 3`
- **THEN** it is the exact text the desktop frontend builds for the same filter

### Requirement: The bundled modules do not depend on a browser

The bundle SHALL evaluate in a JavaScript context with no `window`, `document`, DOM or Solid, and CI SHALL
fail if it does not.

#### Scenario: A module starts using the DOM

- **WHEN** a change makes one of the bundled modules reference `document`
- **THEN** the CI check that evaluates the bundle without a DOM fails and names the module

### Requirement: Exporting in six formats through the shared exporters

The shared exporters SHALL write CSV, JSON, XLSX, XML, HTML and SQL with the same output on iOS as on
desktop, keeping NULL, numbers, dates and UTF-8 text intact.

#### Scenario: A NULL in JSON

- **WHEN** a row with a NULL cell is exported as JSON on iOS
- **THEN** the cell is JSON `null`, not `""`

#### Scenario: Text with a comma, a quote and an accent in CSV

- **WHEN** a cell holds `Pérez, "el Güero"`
- **THEN** the CSV cell is quoted with its inner quotes doubled, as on desktop

#### Scenario: An unknown format

- **WHEN** the app asks for a format that is not one of the six
- **THEN** the facade returns an explicit error and no file is written
