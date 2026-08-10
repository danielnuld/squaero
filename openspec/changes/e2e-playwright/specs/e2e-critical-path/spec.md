## ADDED Requirements

### Requirement: The critical path works on every supported engine

For each engine the suite can reach, the same journey SHALL be driven through the
interface: connect, browse the objects, describe a table, read a page of rows, edit
rows inside a transaction, export the result, disconnect. Each engine SHALL be
asserted on its own, so a failure names the engine it belongs to.

#### Scenario: Connecting

- **WHEN** the user opens a saved connection
- **THEN** the interface shows it as connected
- **AND** the engine's objects become browsable

#### Scenario: Creating a connection through the form

- **WHEN** the user fills in the connection form for an engine and saves it
- **THEN** the connection is listed and can be opened
- **AND** it survives a reload of the interface

#### Scenario: Browsing objects

- **WHEN** the object tree is expanded for a connected engine
- **THEN** the fixture table appears under it

#### Scenario: Describing a table

- **WHEN** the user asks to describe the fixture table
- **THEN** its columns are listed with their types

#### Scenario: Reading a page of rows

- **WHEN** the user runs a SELECT that returns more rows than one page
- **THEN** the first page is shown
- **AND** asking for the next page shows the following rows rather than repeating
  the first

#### Scenario: Running a statement that fails

- **WHEN** the user runs a statement the engine rejects
- **THEN** the engine's own message is shown
- **AND** the interface stays usable, with no request left unanswered

#### Scenario: Editing rows in a transaction

- **WHEN** the user inserts, updates and deletes rows inside a transaction and
  commits
- **THEN** re-reading the table shows exactly those changes

#### Scenario: Rolling back

- **WHEN** the user makes a change inside a transaction and rolls it back
- **THEN** re-reading the table shows the data unchanged

#### Scenario: Exporting a result

- **WHEN** the user exports the result of a query
- **THEN** the exported content holds the same rows and values that the grid showed

#### Scenario: Disconnecting

- **WHEN** the user closes the connection
- **THEN** the interface shows it as disconnected and its objects are no longer
  browsable

### Requirement: Accented data survives the whole round trip

The journey SHALL be asserted on accented data, not only on ASCII, because that is
where this stack has actually broken.

#### Scenario: Accented values display correctly

- **WHEN** a table holding accented values is read
- **THEN** the grid shows the characters the database holds

#### Scenario: A value that is valid UTF-8 for a different character

- **WHEN** the table holds a value whose bytes are valid UTF-8 for one character
  but mean another in the database's own code set
- **THEN** the grid shows the character the database means

#### Scenario: A row the client cannot convert does not hide the others

- **WHEN** one row holds bytes the engine cannot convert
- **THEN** either every row is shown, or the failure is reported with the engine's
  reason
- **AND** the interface never sits waiting for a response that will not arrive

#### Scenario: Filtering by an accented value

- **WHEN** the user filters on an accented value through the editor
- **THEN** the matching rows are returned
- **AND** an empty result is never presented for a value that exists

#### Scenario: Accented data survives an export

- **WHEN** a result holding accented values is exported
- **THEN** the exported content holds those same characters

### Requirement: A failure points at what broke

When a critical-path test fails, the report SHALL carry enough to diagnose it
without re-running by hand.

#### Scenario: A test fails

- **WHEN** any critical-path assertion fails
- **THEN** the failure identifies the engine and the step
- **AND** it is accompanied by what the interface looked like at that moment

#### Scenario: The interface reports an error the test did not expect

- **WHEN** the interface surfaces an unexpected error during a test
- **THEN** the test fails rather than passing over it
