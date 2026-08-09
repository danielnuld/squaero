## ADDED Requirements

### Requirement: A context menu opens fully inside the window

The system SHALL place an open context menu so that its whole box lies inside the
window, moving it in from the click position when it would not fit.

#### Scenario: Click near the right edge

- **WHEN** a menu is opened from a control at the right edge of the window (the
  export button of a wide result)
- **THEN** the menu's right side stays inside the window
- **AND** every item is readable without scrolling the page

#### Scenario: Click near the bottom edge

- **WHEN** a menu is opened near the bottom of the window
- **THEN** the menu's bottom stays inside the window

#### Scenario: Menu larger than the window

- **WHEN** the menu is taller or wider than the window itself
- **THEN** it is placed at the margin, top-left first, rather than off-screen

#### Scenario: Room to spare

- **WHEN** the click is far from every edge
- **THEN** the menu opens exactly at the click position, as before
