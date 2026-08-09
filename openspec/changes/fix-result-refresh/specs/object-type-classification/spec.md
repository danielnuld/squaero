## ADDED Requirements

### Requirement: Object type is reported as an unpadded contract value

Catalog listings SHALL report an object's type as exactly `table` or `view`, with
no padding or surrounding whitespace, on every engine.

#### Scenario: Informix view in the object tree

- **WHEN** an Informix database containing views is expanded in the object tree
- **THEN** each view appears under the Vistas folder with the view icon
- **AND** no view appears under the Tablas folder

#### Scenario: Informix view in the object list

- **WHEN** an Informix database is opened as an object list
- **THEN** the Vistas filter counts and shows its views
- **AND** the type column reads `view` for them

#### Scenario: Engine returning a fixed-width type column

- **WHEN** an engine returns the type as a fixed-width character value padded to
  the longest branch of its `CASE` (Informix `CHAR(5)`, so `view ` for a view)
- **THEN** the listing still classifies the object as a view

### Requirement: Classification tolerates surrounding whitespace

The system SHALL normalize the received type value before classifying it, so a
value carrying padding is not silently downgraded to the default kind.

#### Scenario: Padded value from an unknown engine

- **WHEN** a `schema.tree` row carries a type value with leading or trailing
  whitespace
- **THEN** it is classified by its trimmed value

#### Scenario: Unrecognized value

- **WHEN** a row's type value is neither `table` nor `view` after trimming
- **THEN** it is classified as a table, as before
