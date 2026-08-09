## ADDED Requirements

### Requirement: Saving a query from the editor

The system SHALL let the user save the query they are writing as a snippet from
the editor itself, without opening another tab or losing sight of the text.

#### Scenario: Save the whole document

- **WHEN** the editor holds one statement and the user asks to save (the toolbar
  button or the shortcut)
- **THEN** a name field appears in the editor's own toolbar, already focused
- **AND** confirming it stores the whole editor text as a snippet

#### Scenario: Save only the selection

- **WHEN** part of the editor text is selected and the user asks to save
- **THEN** only the selected text is stored

#### Scenario: Save the statement under the cursor

- **WHEN** nothing is selected, the document holds several statements, and the
  user asks to save
- **THEN** only the statement under the cursor is stored

#### Scenario: The user is told what was captured

- **WHEN** a snippet is saved
- **THEN** the confirmation names the scope that was stored — selection,
  statement or document

#### Scenario: Cancelling

- **WHEN** the name field is open and the user cancels it
- **THEN** nothing is saved and the editor text is untouched

#### Scenario: Nothing to save

- **WHEN** the resolved text is empty or only whitespace
- **THEN** no snippet is created and the user is told why

### Requirement: A proposed name

The system SHALL propose a name for the snippet so accepting takes one key, and
SHALL let the user replace it before confirming.

#### Scenario: Query that reads one table

- **WHEN** the captured text is a single-table `SELECT`
- **THEN** the proposed name is derived from that table's name

#### Scenario: Query with no identifiable table

- **WHEN** the captured text is a join, an aggregation or DDL
- **THEN** a neutral proposed name is offered, still editable

#### Scenario: The user types their own

- **WHEN** the user replaces the proposed name before confirming
- **THEN** the snippet is stored under the typed name

### Requirement: A repeated name never destroys a snippet

The system SHALL keep both snippets when the confirmed name already exists,
storing the new one under a distinct name and saying so.

#### Scenario: Saving twice under the same name

- **WHEN** the user confirms a name that an existing snippet already carries
- **THEN** the existing snippet keeps its body
- **AND** the new one is stored under a numbered variant of that name
- **AND** the confirmation shows the name that was actually used

### Requirement: Undoing a save

The system SHALL offer to undo the save from its confirmation, so a mistaken
capture does not have to be hunted down and deleted.

#### Scenario: Undo right after saving

- **WHEN** the user takes the undo action on the confirmation
- **THEN** the snippet just created is removed
- **AND** the rest of the set is untouched
