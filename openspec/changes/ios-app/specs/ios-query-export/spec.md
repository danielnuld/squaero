## ADDED Requirements

### Requirement: An SQL editor on the phone

The app SHALL offer an SQL editor with syntax colours, completion of the connection's table and column names,
and a row of SQL keys above the keyboard.

#### Scenario: Running a query

- **WHEN** the user runs a query
- **THEN** the results appear under the editor with the row count and the time it took

#### Scenario: A query that fails

- **WHEN** the query fails
- **THEN** the readable error is shown and the editor keeps the text

### Requirement: Snippets and variables

The app SHALL save queries as snippets and SHALL ask for the value of each `:nombre` or `${nombre}` variable
before running, with the same rules as desktop (numbers without quotes, NULL as a switch).

#### Scenario: A snippet with a variable

- **WHEN** the user runs the snippet "Audiencias del día" with `:sala`
- **THEN** the app asks for `:sala`, remembers the value for next time, and runs the query with it

### Requirement: Exporting a result from the phone

The app SHALL export a result in CSV, JSON, XLSX, XML, HTML or SQL through the shared exporters (capability
`shared-logic`), with all rows or only the visible ones, an editable file name, and the choice of saving to
Files or sharing.

#### Scenario: Saving to Files

- **WHEN** the user exports all rows as XLSX and chooses "Guardar en Archivos"
- **THEN** the system file picker opens with the file named `<nombre>.xlsx`, and it holds every row

#### Scenario: Sharing

- **WHEN** the user chooses "Compartir"
- **THEN** the iOS share sheet opens with the file, for Mail, AirDrop or any other app

#### Scenario: Changing the format

- **WHEN** the user switches from CSV to JSON
- **THEN** the file name's extension changes to `.json` and the description of the format updates

### Requirement: Exporting all rows reads the whole result

When asked for all rows, the app SHALL read the whole result through the open cursor (`query.next`), not only
the page on screen, and SHALL NOT re-run the query when a cursor is open.

#### Scenario: A result larger than one page

- **WHEN** a result of 1 284 rows is shown 50 at a time and the user exports all rows
- **THEN** the file holds 1 284 rows

#### Scenario: Only the visible rows

- **WHEN** the user exports only the visible rows
- **THEN** the file holds exactly the rows loaded on screen
