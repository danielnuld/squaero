## ADDED Requirements

### Requirement: Finding a snippet by typing

The system SHALL offer a keyboard-driven search over the saved snippets that
filters as the user types, without opening a tab over the editor.

#### Scenario: Filtering

- **WHEN** the user opens the snippet search and types part of a snippet's name
- **THEN** only the matching snippets are listed, best match first

#### Scenario: No snippets saved

- **WHEN** the set is empty
- **THEN** the search says so instead of showing an empty list

#### Scenario: Nothing matches

- **WHEN** what the user typed matches no snippet
- **THEN** the search says nothing matched, and no action is offered

### Requirement: Seeing a snippet before using it

The system SHALL show the body of the highlighted snippet while searching, so it
is not chosen by name alone.

#### Scenario: Moving through the results

- **WHEN** the user moves the highlight from one result to another
- **THEN** the shown body is the highlighted snippet's

### Requirement: Using a snippet three ways

The system SHALL let the highlighted snippet be inserted at the cursor, executed,
or opened in a new query tab, from the search itself.

#### Scenario: Insert at the cursor

- **WHEN** the user confirms the highlighted snippet
- **THEN** its body is inserted at the editor's cursor, replacing any selection
- **AND** the search closes

#### Scenario: Execute it

- **WHEN** the user takes the execute action on the highlighted snippet
- **THEN** its body runs against the active tab's connection and the result shows
  in the grid

#### Scenario: Open it in a new tab

- **WHEN** the user takes the new-tab action on the highlighted snippet
- **THEN** a query tab opens holding its body
- **AND** the tab the user was in keeps its own text

#### Scenario: No connection

- **WHEN** the execute action is taken with no usable connection
- **THEN** the failure is reported the same way a query run without a connection
  is, rather than silently doing nothing
