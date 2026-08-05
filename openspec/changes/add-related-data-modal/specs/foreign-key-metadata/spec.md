## ADDED Requirements

### Requirement: Foreign keys read from the engine catalog

The system SHALL obtain foreign-key relationships from each engine's catalog
(MySQL/MariaDB, PostgreSQL, SQLite, Informix), never inferring them from column
names, and SHALL be able to scope the query to a working database or schema.

#### Scenario: Engine with a foreign-key catalog

- **WHEN** the foreign keys of a database are requested on MySQL, PostgreSQL,
  SQLite or Informix
- **THEN** the system returns a supported query plan yielding rows shaped as
  `(from_table, from_column, to_table, to_column)` plus the identity of their
  constraint

#### Scenario: Engine without foreign keys

- **WHEN** foreign keys are requested on MongoDB
- **THEN** the system returns an unsupported plan carrying a readable reason
- **AND** no query is sent to the server

#### Scenario: SQLite is queried table by table

- **WHEN** the engine is SQLite
- **THEN** the plan is flagged `perTable` and the source table is injected while
  parsing each result, because `PRAGMA foreign_key_list` does not echo it

### Requirement: Grouping by constraint

The system SHALL group the column pairs of a foreign key by their constraint, so
a composite key is handled as a single relationship carrying every column in the
order the catalog declares.

#### Scenario: Composite key

- **WHEN** a table references another through a four-column key
- **THEN** the system reports ONE relationship with its four ordered column
  pairs, not four one-column relationships

#### Scenario: Two distinct keys to the same table

- **WHEN** a table references the same target table twice through different
  constraints
- **THEN** the system reports two separate, distinguishable relationships

### Requirement: Inbound direction

The system SHALL be able to query, for a given table, the foreign keys that
**point at it** (its dependents), in addition to those leaving it.

#### Scenario: Scoping by referenced table

- **WHEN** the inbound relationships of table `cuadernos` are requested
- **THEN** the catalog query is scoped to constraints whose referenced table is
  `cuadernos`
- **AND** the result excludes the foreign keys leaving `cuadernos`

#### Scenario: Table with no dependents

- **WHEN** no table references the queried table
- **THEN** the system returns an empty list, without an error

#### Scenario: Inbound direction on SQLite

- **WHEN** the engine is SQLite, whose `PRAGMA` only answers per child table
- **THEN** the system walks the known tables of the database and keeps the
  relationships pointing at the queried table

### Requirement: Multi-column resolution on Informix

The system SHALL resolve Informix foreign keys over every column of the index
(`part1` through `part16`), on both the referencing and the referenced side.

#### Scenario: Composite Informix foreign key

- **WHEN** the foreign keys of an Informix schema holding a five-column
  constraint are read
- **THEN** the reported relationship carries its five column pairs matched by
  position

#### Scenario: Single-column key

- **WHEN** the Informix constraint uses a single column
- **THEN** the relationship carries exactly one column pair, with no empty rows
  for the unused positions

### Requirement: Truncated catalog result

The system SHALL report when the catalog query hit the row cap that `query.run`
applies, because an incomplete list of relationships leads to concluding that a
row has no dependents when it does.

#### Scenario: The catalog returns more rows than the cap

- **WHEN** the foreign-key query is truncated
- **THEN** the system marks the result as truncated so its consumer can warn the
  user
