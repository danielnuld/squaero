## ADDED Requirements

### Requirement: Opening a snippet never disturbs the query being written

The system SHALL open a saved snippet in its own query tab, leaving the text of
every other tab untouched.

#### Scenario: Opening from the palette

- **WHEN** the user activates a snippet in the snippet palette
- **THEN** a query tab named after the snippet opens with its body loaded
- **AND** it becomes the active tab
- **AND** the tab the user came from keeps its text exactly as it was

#### Scenario: Opening the same snippet twice

- **WHEN** a snippet is opened while its tab is already open
- **THEN** that tab is focused instead of a second one appearing

#### Scenario: Two different snippets

- **WHEN** two different snippets are opened
- **THEN** each gets its own tab

#### Scenario: No query tab is open

- **WHEN** the user opens a snippet with no query tab open at all
- **THEN** the snippet's tab opens and shows its body

#### Scenario: Inserting at the cursor is still available

- **WHEN** the user asks explicitly to insert a snippet at the cursor
- **THEN** the body is inserted into the editor at the current selection
- **AND** if the last query tab it would insert into no longer exists, the
  snippet opens in a tab of its own rather than doing nothing

### Requirement: Tabs are reachable by name and by keyboard

The system SHALL expose the tab bar as a tab list, so that which tab is open and
which one is selected can be perceived without seeing the screen.

#### Scenario: The selected tab is identifiable

- **WHEN** the tab bar holds several tabs
- **THEN** each tab is exposed with its title as its accessible name
- **AND** exactly one is marked as selected

#### Scenario: Moving between tabs from the keyboard

- **WHEN** focus is on a tab and the user presses the left or right arrow
- **THEN** the neighbouring tab is selected, wrapping around the ends

### Requirement: Editing a snippet and saving it back

The system SHALL let the user change a snippet's body from the tab it was opened
in, and save the change back to the snippet it came from.

#### Scenario: Saving back under the same name

- **WHEN** the user edits the body in a snippet's tab and asks to save
- **THEN** the name field is offered already filled with that snippet's name
- **AND** confirming it unchanged replaces that snippet's body
- **AND** no second snippet is created

#### Scenario: Saving as a new snippet instead

- **WHEN** the user changes the offered name before confirming
- **THEN** a new snippet is stored under the new name
- **AND** the original snippet keeps its body

#### Scenario: Undoing an update

- **WHEN** the user undoes a save that replaced a body
- **THEN** the previous body is restored and the snippet still exists

#### Scenario: Unsaved changes are visible

- **WHEN** a snippet's tab holds a body different from the stored one
- **THEN** the tab shows that it has unsaved changes
- **AND** says so in its accessible name, not only through a symbol

### Requirement: Finding a snippet among many

The system SHALL let the user search the saved set by name and by body.

#### Scenario: Searching by name

- **WHEN** the user types part of a snippet's name in the library's search field
- **THEN** only the snippets whose name or body contains it are listed

#### Scenario: Searching by what the query does

- **WHEN** the user types a fragment that appears only inside snippet bodies
- **THEN** the snippets containing it are listed, even though no name matches

#### Scenario: Case does not matter

- **WHEN** the search text differs from the stored text only in case
- **THEN** the snippet still matches

#### Scenario: Nothing saved versus nothing matching

- **WHEN** the library is empty
- **THEN** it says nothing has been saved yet
- **WHEN** the library has snippets but none match the search
- **THEN** it says nothing matches, which is a different message

### Requirement: Managing the saved set

The system SHALL offer rename, duplicate, insert-at-cursor and delete for a
stored snippet, and import/export for the whole set.

#### Scenario: Duplicating

- **WHEN** the user duplicates a snippet
- **THEN** a copy is stored under a free name derived from the original
- **AND** the original is unchanged

#### Scenario: The library never edits bodies in place

- **WHEN** the user wants to change a snippet's body from the library
- **THEN** the library offers to open it, and the change is made in the editor
