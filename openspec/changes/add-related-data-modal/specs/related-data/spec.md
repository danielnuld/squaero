## ADDED Requirements

### Requirement: Opening from a referenced column

The system SHALL offer the related-data action from a grid cell whose column is
referenced by at least one inbound foreign key, and SHALL anchor the modal to
that column and its value.

#### Scenario: Cell of a referenced column

- **WHEN** the user opens the context menu over a cell of a column that other
  tables reference
- **THEN** the menu includes an action naming that column and value
- **AND** activating it opens the modal titled `<table>.<column> = <value>`

#### Scenario: Cell of a column nobody references

- **WHEN** the user opens the context menu over a cell whose column takes part in
  no inbound foreign key
- **THEN** the related-data action is not offered

#### Scenario: Referenced columns are marked in the grid

- **WHEN** a result carries columns referenced by inbound foreign keys
- **THEN** those columns are marked in the grid header, so the user can tell
  where the action is available without probing cell by cell

#### Scenario: Result without a source table

- **WHEN** the result comes from a query whose table cannot be identified (a
  join, an aggregation)
- **THEN** the action is not offered

#### Scenario: Engine without foreign keys

- **WHEN** the connection runs an engine that does not expose foreign keys
- **THEN** the modal explains that the engine does not expose them
- **AND** it shows no relationships invented from column names

### Requirement: List of inbound relationships

The modal SHALL list every relationship whose referenced key includes the anchor
column in a narrow side column, leaving the rest of the modal to the result. The
filter SHALL carry every column of the relationship's key, not only the anchor
column, and SHALL be readable for the selected relationship.

#### Scenario: Relationship through a composite key

- **WHEN** the modal is opened from one column of a five-column key and a
  dependent table references it through all five
- **THEN** the filter shown for that relationship carries the five equalities
  with the selected row's values, not only the anchor column's

### Requirement: Row count per relationship

The modal SHALL show how many dependent rows each relationship has, without the
user opening it, since answering "does this record have dependents?" is the point
of the feature. Counts SHALL NOT block the modal: it opens and stays usable while
they arrive.

#### Scenario: Counts on opening

- **WHEN** the modal opens with its relationships listed
- **THEN** each one gets a count of the rows matching the row's filter
- **AND** relationships with no dependents are visibly distinct from those with
  dependents

#### Scenario: Counting is still in flight

- **WHEN** the counts have not arrived yet
- **THEN** the list shows them as pending and the user can already select a
  relationship

#### Scenario: A count fails

- **WHEN** the count of one relationship returns an engine error
- **THEN** that relationship shows its count as unknown
- **AND** the remaining counts and the modal keep working

#### Scenario: No relationships

- **WHEN** no table references the source table
- **THEN** the modal says so explicitly instead of showing an empty list

#### Scenario: The row does not project the key columns

- **WHEN** the result omits one of the columns a relationship needs to filter
- **THEN** that relationship is shown disabled, naming the missing column
- **AND** the system does not run a query with an incomplete filter

### Requirement: Query and result of a relationship

On choosing a relationship, the system SHALL run its query against the connection
of the source result and show the returned rows along with the generated SQL.

#### Scenario: The relationship has rows

- **WHEN** the user chooses a relationship that has dependents
- **THEN** the modal shows the resulting rows in a grid as its main content, with
  the generated SQL visible below it
- **AND** it states how many rows were returned

#### Scenario: The relationship has no rows

- **WHEN** the query returns no rows
- **THEN** the modal states it clearly, making visible that the record has no
  dependents through that relationship

#### Scenario: The query fails

- **WHEN** the query returns an engine error
- **THEN** the modal shows the error message without closing
- **AND** the user can choose another relationship

#### Scenario: NULL values in the key

- **WHEN** one of the row values forming the filter is NULL
- **THEN** the generated condition uses `IS NULL` instead of an equality

#### Scenario: Engine identifiers and literals

- **WHEN** the SQL of a relationship is generated
- **THEN** identifiers are quoted per engine and values are emitted as safe
  literals, with numeric ones unquoted

### Requirement: Carrying the work out of the modal

The modal SHALL let the user take the result further without losing context:
opening it in its own tab or sending its SQL to the editor.

#### Scenario: Open in a tab

- **WHEN** the user opens the shown relationship in a tab
- **THEN** a query tab is opened with that SQL, bound to the same connection
- **AND** the tab is titled after the dependent table

#### Scenario: Send to the editor

- **WHEN** the user sends the relationship to the editor
- **THEN** the generated SQL lands in the query editor without running

#### Scenario: Walking the relationships

- **WHEN** the user moves to the next or previous relationship
- **THEN** the modal shows that relationship without closing or losing the source
  row
