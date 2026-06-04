# Research capability — delta for Garden

## ADDED Requirements

### Requirement: Dependency edges in the dataset
Every research node (validated, watching, and backlog) SHALL declare a `requires` array of prerequisite
hypothesis ids, and the published dataset SHALL expose a computed `research.garden` object containing the
nodes and the derived edges.

#### Scenario: Edges derived from requires
- GIVEN a node `A1` whose `requires` is `["E1"]`
- WHEN the pipeline builds the garden structure
- THEN `research.garden.edges` contains an edge `{ from: "E1", to: "A1" }`
- AND every edge in `research.garden.edges` maps to exactly one node's `requires` entry

#### Scenario: Root nodes
- GIVEN a node `E1` whose `requires` is empty
- WHEN the garden structure is built
- THEN `E1` has `tier` 0
- AND no edge points to `E1`

### Requirement: Node state derivation
Each node SHALL carry a derived `state` of `locked`, `available`, `watching`, or `validated`, computed from
its source tier and whether all of its prerequisites are validated.

#### Scenario: Validated node
- GIVEN a node in the `validated` set
- WHEN the garden structure is built
- THEN its `state` is `validated`

#### Scenario: Backlog node with all prerequisites validated
- GIVEN a backlog node whose `requires` ids are all in the validated set
- WHEN the garden structure is built
- THEN its `state` is `available`

#### Scenario: Node with an unmet prerequisite
- GIVEN a backlog node that requires another backlog (not-yet-validated) node
- WHEN the garden structure is built
- THEN its `state` is `locked`

### Requirement: Garden skill-tree page
The site SHALL serve a prerendered `/research/garden` page rendering `research.garden` as a layered
dependency DAG (skill-tree), using lib-free inline SVG, where node appearance reflects its `state`.

#### Scenario: Default render
- GIVEN the research dataset is published
- WHEN the Garden page renders
- THEN nodes appear positioned by `tier` with edges drawn from each prerequisite to its dependent
- AND validated, watching, available, and locked nodes are each visually distinct

#### Scenario: Unlock reading
- GIVEN a validated node with a dependent that is `available`
- WHEN a viewer reads the tree
- THEN the edge from the validated node to the available node is shown, conveying the unlock relationship

### Requirement: Signal not colour-only
Node state and progress SHALL be conveyed by shape, glyph, and text in addition to colour; the page SHALL
meet WCAG-AA with keyboard navigation and reduced-motion support, using only the existing design tokens.

#### Scenario: Colour-independent reading
- GIVEN a user who cannot distinguish the state colours
- WHEN they read a watching node
- THEN its progress is legible from the `n=k/threshold` text and the meter shape
- AND a locked node is identifiable by its padlock glyph and greyed shape alone

### Requirement: Responsive layout
The Garden SHALL render as a horizontal layered DAG on wide viewports and collapse to vertical tier-stacked
sections below 880px without horizontal scroll.

#### Scenario: Narrow viewport
- GIVEN a viewport narrower than 880px
- WHEN the Garden page renders
- THEN nodes are stacked in vertical tier sections
- AND the page has no horizontal scroll
