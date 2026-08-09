## ADDED Requirements

### Requirement: No driver text crosses the IPC boundary as invalid UTF-8

Every string a driver hands to the core SHALL be valid UTF-8 by the time it is
serialized into an IPC response. The core SHALL NOT rely on the JSON encoder to
enforce this, because it does not: cJSON copies the bytes it is given.

#### Scenario: A cell value is not valid UTF-8

- **WHEN** a driver returns a cell whose bytes are not valid UTF-8
- **THEN** the response is still a well-formed, valid-UTF-8 IPC frame
- **AND** the frontend receives a reply for that request rather than waiting
  forever

#### Scenario: A column name is not valid UTF-8

- **WHEN** a driver reports a column name whose bytes are not valid UTF-8
- **THEN** the column still appears in the result, under a valid-UTF-8 name

#### Scenario: An error message is not valid UTF-8

- **WHEN** a driver's `last_error` text is not valid UTF-8 — a database engine
  reporting a localized message in a legacy code set, for instance
- **THEN** the error still reaches the user as a readable message
- **AND** it is not swallowed by a corrupted frame

#### Scenario: Text that is already valid passes through byte for byte

- **WHEN** a driver returns text that is already valid UTF-8, including
  multi-byte characters and text containing NUL-free control bytes
- **THEN** the value delivered to the frontend is byte-for-byte identical to what
  the driver returned

#### Scenario: Empty and boundary inputs

- **WHEN** the text is empty, or a lone continuation byte, or a truncated
  multi-byte sequence at the very end of the buffer
- **THEN** the sanitizer terminates and produces valid UTF-8 without reading past
  the end of the input

### Requirement: Repair is lossy but never silent about it

When invalid bytes must be repaired at the boundary, the repair SHALL be
deterministic and SHALL preserve the valid parts of the text. It SHALL NOT
discard the whole value.

#### Scenario: Partially invalid text

- **WHEN** a value mixes valid UTF-8 with a few undecodable bytes
- **THEN** the valid characters survive unchanged
- **AND** each undecodable byte is replaced by a single replacement character

#### Scenario: The boundary is a net, not the conversion layer

- **WHEN** a driver already knows the code set of its text
- **THEN** that driver converts the text itself, so the boundary sanitizer finds
  nothing to repair
- **AND** the sanitizer's repair path is reserved for the cases no driver
  claimed
