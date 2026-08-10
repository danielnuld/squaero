## ADDED Requirements

### Requirement: A test drives the real stack, not a substitute

An end-to-end test SHALL exercise the shipped frontend against the real C core,
the real driver plugins and a real database. No layer between the browser and the
database may be replaced by a mock, stub or fake.

#### Scenario: The bridge reaches the real core

- **WHEN** a test performs an action that queries the database
- **THEN** the request travels through the same JSON-RPC contract the native shell
  uses
- **AND** the answer comes from the driver plugin talking to the database, not from
  fixture data held in the test

#### Scenario: The frontend under test is the shipped artifact

- **WHEN** the suite runs
- **THEN** it drives the built frontend, not a variant assembled for testing
- **AND** no production source is modified to make the tests pass

#### Scenario: Each test gets a clean bridge

- **WHEN** two tests run in the same suite
- **THEN** neither can observe connections, transactions or state left behind by
  the other

### Requirement: An unavailable engine skips instead of failing

The suite SHALL be runnable on a machine that has only some of the engines. A
missing database or an unloadable driver SHALL skip that engine's tests with a
stated reason, and SHALL NOT fail them.

#### Scenario: A database is not running

- **WHEN** an engine's database cannot be reached
- **THEN** that engine's tests are reported as skipped, naming the engine and why
- **AND** the other engines still run and still report their own result

#### Scenario: A driver plugin is not present

- **WHEN** the driver for an engine did not load
- **THEN** that engine's tests skip for that reason rather than failing on a
  confusing "unknown driver"

#### Scenario: No engine is available

- **WHEN** nothing can be reached
- **THEN** the run reports every engine as skipped
- **AND** the outcome is distinguishable from a run where the tests passed

#### Scenario: A required engine must not silently vanish

- **WHEN** the suite is asked to require a specific engine
- **THEN** that engine skipping is a failure, so a CI job cannot go green by
  quietly testing nothing

### Requirement: Fixture data is deterministic and seeded outside the UI

Each engine SHALL start every run from a known dataset, created through the core
rather than through the interface, so that a broken interface cannot prevent the
suite from setting itself up.

#### Scenario: Seeding does not depend on the interface

- **WHEN** the suite prepares an engine's data
- **THEN** the data is in place before any page is opened

#### Scenario: A run does not depend on the previous one

- **WHEN** the suite runs twice in a row
- **AND** the first run inserted, updated and deleted rows
- **THEN** the second run sees exactly the same starting data as the first

#### Scenario: Fixtures include the text that has broken before

- **WHEN** an engine's fixture is created
- **THEN** it contains accented values, a value whose bytes are valid UTF-8 for a
  different character than they mean in the database's own code set, and a value
  holding bytes that a single-byte code set maps to control characters

#### Scenario: Tests do not write to anything but their own fixture

- **WHEN** a test modifies data
- **THEN** it touches only the objects the suite created

### Requirement: Text assertions do not depend on the machine

The suite SHALL fix every environment input that would otherwise change what the
interface displays.

#### Scenario: Locale is pinned

- **WHEN** the suite opens the application
- **THEN** the interface language is the one the suite chose, whatever the
  machine's own language is

#### Scenario: Client-side state starts empty

- **WHEN** a test begins
- **THEN** saved connections, history, snippets, notebooks and preferences are in a
  known state rather than whatever a previous run or a real user left behind

### Requirement: Locators prefer what a user can perceive

Tests SHALL locate elements by role, accessible name or visible text. When an
element cannot be reached that way, the gap SHALL be recorded rather than worked
around silently.

#### Scenario: An element has an accessible name

- **WHEN** a test needs to act on a control
- **THEN** it addresses it the way a user or a screen reader would

#### Scenario: An element cannot be addressed accessibly

- **WHEN** no role or accessible name identifies the element
- **THEN** the missing affordance is written down as work to do on the component
- **AND** the test does not depend on a CSS class or DOM position that refactoring
  would break
