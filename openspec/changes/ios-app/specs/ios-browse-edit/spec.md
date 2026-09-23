## ADDED Requirements

### Requirement: Browsing a connection's objects

The app SHALL list a connection's tables, views and routines, with a search box, and SHALL show the
connection's state (connected, engine and version, TLS).

#### Scenario: Searching tables

- **WHEN** the user types part of a table name
- **THEN** the list shows only the objects whose name contains it

### Requirement: Rows as a list, filtered on the server

A table's rows SHALL be shown as a list of records, with filters and sort applied on the server and paging
through the cursor, as the desktop filter panel does.

#### Scenario: Adding a filter

- **WHEN** the user adds the filter `juzgado = 3`
- **THEN** the app runs a query filtered on the server and shows the filter as a chip that can be removed

#### Scenario: Next page

- **WHEN** the user goes to the next page of a result with an open cursor
- **THEN** the next rows are fetched from the cursor without re-running the query

### Requirement: A row as a form, with related data

Opening a row SHALL show each column with its type, and SHALL offer the rows it references and the rows that
reference it, from the engine's foreign keys.

#### Scenario: Following a foreign key

- **WHEN** the user taps "El expediente al que pertenece"
- **THEN** the referenced row opens in the same way

### Requirement: Every change is previewed and confirmed

Editing SHALL collect the changes of a row, show the SQL that will run and the number of rows it affects,
and apply them in one transaction only after the user confirms with Face ID. A connection marked as
production SHALL say so in the preview.

#### Scenario: Confirming

- **WHEN** the user edits `estado` and confirms with Face ID
- **THEN** the `UPDATE` runs inside a transaction and is committed, and the row shows the new value

#### Scenario: Discarding

- **WHEN** the user discards the change
- **THEN** nothing is sent to the server and the row shows its original value

#### Scenario: The server rejects the change

- **WHEN** the `UPDATE` fails
- **THEN** the transaction is rolled back and the readable error (for Informix, the text for its SQLCODE)
  is shown, with the edit kept so it can be corrected

#### Scenario: A read-only engine

- **WHEN** the connection is MongoDB
- **THEN** editing is not offered, and the row says the engine is read-only
