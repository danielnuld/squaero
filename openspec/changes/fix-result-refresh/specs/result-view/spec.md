## ADDED Requirements

### Requirement: Refreshing a result re-runs the query that produced it

The system SHALL refresh a result tab by re-running the SQL that produced the
displayed rows, at the same page, and SHALL NOT run the editor's current text.

#### Scenario: Editor changed after the query ran

- **WHEN** the user runs a `SELECT`, then edits the editor text to something else,
  then applies a row change from the grid
- **THEN** the grid is refreshed with the `SELECT` that produced it
- **AND** the edited editor text is not executed

#### Scenario: Refresh keeps the current page

- **WHEN** the displayed result is page N of a paged query and it is refreshed
- **THEN** the same page N is re-run, not the first page

#### Scenario: Table preview refresh

- **WHEN** the result came from opening a table (a preview with its own paged SQL)
- **THEN** the refresh goes through the preview path, keeping its descriptor and
  its server-side offset

#### Scenario: Nothing to refresh

- **WHEN** a refresh is requested for a tab that has never run a query
- **THEN** no statement is executed

### Requirement: Refresh targets the requested tab

The system SHALL refresh the tab identified by the refresh request, regardless of
which tab is focused when the refresh happens.

#### Scenario: Refresh requested from a tool tab

- **WHEN** a wizard running in its own tab (data generator, import) finishes and
  requests a refresh of its source tab
- **THEN** the source tab's query is re-run
- **AND** the focused tab's query is not re-run

### Requirement: A new result starts at the top of the grid

The system SHALL show a newly loaded result from its first row, with the grid's
virtualized window and the scroller's real scroll position in agreement.

#### Scenario: New result after a failed query

- **WHEN** a query is run while the grid is scrolled down, it fails and the error
  replaces the grid, and a valid query is then run
- **THEN** the new result's first rows are visible without the user scrolling

#### Scenario: New result while scrolled down

- **WHEN** a new result loads while the previous one was scrolled down
- **THEN** the grid shows the new result from its first row
