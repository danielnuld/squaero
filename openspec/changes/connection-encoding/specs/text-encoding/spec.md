## ADDED Requirements

### Requirement: The engine converts the text, not the driver

For every engine whose client library or server can be told to deliver UTF-8, the
driver SHALL ask for UTF-8 when the connection is opened, and SHALL NOT inspect or
transcode the bytes itself. The engine's own conversion tables are more complete
than any the driver could carry.

#### Scenario: PostgreSQL against a non-UTF-8 database

- **WHEN** a connection is opened to a PostgreSQL database whose encoding is not
  UTF-8 — LATIN1, for instance
- **THEN** the driver has requested UTF-8 as the client encoding
- **AND** accented text arrives readable, without the driver inspecting any bytes

#### Scenario: MySQL/MariaDB regardless of client-library default

- **WHEN** a connection is opened to MySQL or MariaDB
- **THEN** the session character set is UTF-8, independent of what the linked
  client library defaults to
- **AND** the same text reads identically whichever client library the build
  linked against

#### Scenario: Informix against a single-byte database

- **WHEN** a connection is opened to an Informix database in a single-byte code
  set — ISO 8859-1, for instance
- **THEN** the driver has asked the client for UTF-8 on the connection itself, not
  through the environment, because the environment is ignored
- **AND** stored accented text arrives as correct UTF-8

#### Scenario: Bytes that are valid UTF-8 by coincidence

- **WHEN** a single-byte database stores two bytes that happen to form a valid
  UTF-8 sequence — 0xC3 0xB1, which in ISO 8859-1 is "Ã±"
- **THEN** the value reads "Ã±"
- **AND** it does NOT read "ñ", which is what treating the bytes as UTF-8 would
  produce

#### Scenario: Bytes with no meaning in the database's code set

- **WHEN** a row holds bytes in the 0x80–0x9F range, which a single-byte code set
  maps to control characters
- **THEN** the row is returned rather than failing
- **AND** a query selecting the whole table returns every row, so one such row
  cannot make the rest of the table unreadable

#### Scenario: The engine refuses the requested encoding

- **WHEN** the server or client library rejects the UTF-8 request — no conversion
  available for that code set, say
- **THEN** the connection fails with the engine's own reason
- **AND** no connection is handed back that would silently deliver mojibake

### Requirement: A connection can override the code set it declares

A connection SHALL be able to override the code set negotiated on its behalf, for
the database whose own code set the client cannot determine. The override SHALL be
optional, and its absence SHALL select the negotiated default.

#### Scenario: Overriding the client code set

- **WHEN** a connection declares a client code set explicitly
- **THEN** that value is what the driver asks the engine for, replacing the default

#### Scenario: Declaring the database's own code set

- **WHEN** the client cannot deduce the database's code set on its own
- **AND** the connection declares it
- **THEN** both values are sent, so the engine knows what to convert from and to

#### Scenario: Default needs no configuration

- **WHEN** a connection declares neither value, including every connection saved
  before this change
- **THEN** UTF-8 is negotiated as the default
- **AND** no saved connection needs editing to keep working

### Requirement: A statement means what the user wrote

Accented text inside a SQL string literal SHALL reach the server as the characters
the user typed, whatever code set the database uses. A query that cannot be sent
faithfully SHALL fail rather than run as a different query.

#### Scenario: An accented literal in a WHERE clause

- **WHEN** the user filters on an accented value stored in a single-byte database —
  `WHERE nota LIKE '%ñada%'` against a row holding "Cañada"
- **THEN** the matching row is returned
- **AND** the result is NOT an empty set, which is what sending the raw bytes
  produced

#### Scenario: An accented literal round-trips

- **WHEN** a statement selects an accented literal
- **THEN** the value returned is the same character that was written
- **AND** the server agrees on its length, so it was received as one character
  rather than as its individual bytes

#### Scenario: Quoting is respected

- **WHEN** a literal contains a doubled quote as well as an accent — `'it''s café'`
- **THEN** the value arrives intact, the escape having been read as an escape

#### Scenario: A character the database cannot store

- **WHEN** a literal holds a character with no representation in the database's code
  set
- **THEN** the statement fails with the engine's own conversion error
- **AND** it does not run with that character silently replaced or dropped

#### Scenario: ASCII statements are untouched

- **WHEN** a statement is pure ASCII, as nearly all are
- **THEN** it is sent exactly as it was before this requirement existed

#### Scenario: A statement the driver cannot send safely

- **WHEN** the driver cannot send a statement's non-ASCII text through the path
  that converts it
- **THEN** it falls back to the path that at worst reproduces the engine's existing
  error
- **AND** it never crashes the process, whatever the client library does with such
  a statement

### Requirement: A failed fetch says why

When iterating a result set fails, the driver SHALL report the engine's own
diagnostic. An error with no reason is not an acceptable outcome.

#### Scenario: The engine refuses a row mid-fetch

- **WHEN** fetching a row fails inside the driver
- **THEN** the error that reaches the user carries the engine's diagnostic text
- **AND** it is not a bare "query failed" with no explanation

### Requirement: Byte inspection survives only as a fallback

A driver MAY keep a heuristic for text whose code set was never negotiated, and it
SHALL be a fallback rather than the primary mechanism.

#### Scenario: Negotiation succeeded

- **WHEN** the connection negotiated UTF-8 successfully
- **THEN** the returned bytes are already valid UTF-8
- **AND** the fallback does not alter them

#### Scenario: Text arrives in an unnegotiated code set

- **WHEN** a driver receives text that is not valid UTF-8
- **THEN** it converts from its documented fallback code set rather than passing
  the bytes on
- **AND** the request completes instead of failing
