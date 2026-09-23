## ADDED Requirements

### Requirement: The agent is on-device, optional and off by default

The agent SHALL run only on Apple's on-device model (Foundation Models), SHALL be off until the user turns
it on, and SHALL NOT appear on devices without Apple Intelligence. Nothing the agent sees SHALL leave the
device.

#### Scenario: An unsupported device

- **WHEN** the app runs on a device without Apple Intelligence or below iOS 26
- **THEN** no agent control is shown anywhere

#### Scenario: Turning it on

- **WHEN** the user turns the agent on in Ajustes
- **THEN** the app explains that it runs on the iPhone and sees the schema and the results it is asked about

### Requirement: The agent only reads

The agent's tools SHALL be read-only: search the schema, describe a table, and run a `SELECT` with a row
limit. It SHALL NOT run `INSERT`, `UPDATE`, `DELETE`, DDL or anything that changes data; a change it proposes
SHALL go through the same preview and Face ID as a change made by hand.

#### Scenario: The agent proposes an UPDATE

- **WHEN** the user asks the agent to mark an audience as held
- **THEN** the agent fills in the edit and opens the change preview, and nothing runs until the user confirms
  with Face ID

#### Scenario: A statement that is not a SELECT

- **WHEN** the model produces a statement other than a `SELECT` for its query tool
- **THEN** the tool refuses it and the agent says it cannot run it

### Requirement: Filtering by asking

On a table's rows, the agent SHALL turn a request in plain language into the server-side filters of that
table, shown as chips the user can edit or remove.

#### Scenario: A filter in plain Spanish

- **WHEN** the user asks "solo las programadas de mañana"
- **THEN** the filters `estado = 'programada'` and the date of tomorrow appear as chips, and the list reloads

### Requirement: Explaining errors and queries

The agent SHALL explain a failed query's error in plain language and suggest a fix, and SHALL explain what a
query or snippet does before it runs.

#### Scenario: An Informix error

- **WHEN** a query fails with `SQLCODE -217` on column `fecah`
- **THEN** the agent says the column does not exist and suggests `fecha`, from the table's real columns

### Requirement: Asking for data in plain language

The agent SHALL write a `SELECT` for a question in plain language, in the dialect of the connection's
engine, using only tables and columns it looked up, and SHALL show the SQL before running it.

#### Scenario: A question with an aggregate

- **WHEN** the user asks "¿cuántas audiencias hay por sala esta semana?"
- **THEN** the agent shows a `SELECT ... GROUP BY sala` for the week, and runs it when the user accepts

#### Scenario: A schema too large for the model

- **WHEN** the connection has hundreds of tables
- **THEN** the agent searches the schema through its tool instead of receiving it whole
