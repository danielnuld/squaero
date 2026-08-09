## ADDED Requirements

### Requirement: The tree reflects objects created by executed DDL

The system SHALL re-read the object catalog after a successful execution whose
SQL changes it, so an object created, renamed or dropped from the SQL editor
appears — or disappears — without a manual refresh.

#### Scenario: Table created from the editor

- **WHEN** the user runs `CREATE TABLE …` in a query tab with the target database
  expanded in the tree
- **THEN** the new table appears under that database's Tablas folder

#### Scenario: View and stored routine

- **WHEN** the user runs `CREATE VIEW …` or `CREATE PROCEDURE …`
- **THEN** the new object appears under its own folder (Vistas, Procedimientos)
  once that folder is listed

#### Scenario: Dropped object

- **WHEN** the user runs `DROP TABLE …`
- **THEN** the table is gone from the tree

#### Scenario: A query changes nothing

- **WHEN** the user runs a `SELECT`, an `INSERT`, an `UPDATE` or a `DELETE`
- **THEN** the tree is not re-read

#### Scenario: Failed DDL

- **WHEN** a `CREATE TABLE` fails with an error
- **THEN** the tree is not re-read

#### Scenario: DDL run from a SQL notebook

- **WHEN** the catalog-changing statement runs from a notebook cell instead of a
  query tab
- **THEN** the tree is re-read the same way

### Requirement: An automatic re-read keeps the user's place

The system SHALL preserve the tree's expansion state, filter and scroll position
when it re-reads the catalog on its own.

#### Scenario: Expanded containers after a create

- **WHEN** the tree has several databases expanded and a `CREATE TABLE` runs
- **THEN** those containers stay expanded, listing their objects again
- **AND** the tree is not collapsed to its roots

#### Scenario: Manual refresh keeps its current behavior

- **WHEN** the user asks for a refresh explicitly (the tree button, its context
  menu, or the refresh shortcut)
- **THEN** the tree reloads from the root and collapses, as it does today
