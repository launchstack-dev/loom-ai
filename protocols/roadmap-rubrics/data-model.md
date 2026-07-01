# Rubric: Data Model

The Data Model (Conceptual) section names the entities, their key fields, and their relationships at the entity-relationship level — not the full typed schema. A strong conceptual model lists every entity referenced by at least one feature, declares cardinality on every relationship with standard notation (1:1, 1:N, M:N), and has no orphans (entities defined but never referenced, or relationships pointing at undefined entities). The conceptual model is the bridge between feature behaviors and the fully typed schema produced by plan generation.

## Green

> "### Entities
>
> | Entity | Key Fields | Description |
> |--------|-----------|-------------|
> | User | id, name, email, passwordHash | Account holder |
> | Board | id, title, ownerId | Collection of tasks owned by one user |
> | Task | id, title, status, boardId, assigneeId | Work item within a board |
>
> ### Relationships
>
> | From | To | Type | Description |
> |------|-----|------|-------------|
> | User | Board | 1:N | A user owns many boards |
> | Board | Task | 1:N | A board contains many tasks |
> | User | Task | 1:N | A user can be assigned many tasks |"

This is green because every entity has a name, key fields including foreign keys, and a description tying it to a feature concept. Every relationship uses standard cardinality notation, names both endpoints, and describes the semantics. Foreign keys (`ownerId`, `boardId`, `assigneeId`) are present in the entity table so the relationship rows can be derived from them — no orphan relationships. A reviewer can immediately check that every entity is referenced by at least one feature in the Features section.

## Yellow

> "### Entities
>
> | Entity | Description |
> |--------|-------------|
> | User | The user |
> | Board | A board |
> | Task | Tasks |
> | AuditLog | Audit records |
>
> ### Relationships
>
> Users have boards. Boards have tasks."

This is yellow because the entities exist but key fields are missing (a downstream contracts-agent cannot generate a typed schema without them), the descriptions are tautological ("The user", "A board"), and AuditLog appears to be an orphan — no feature references it. The relationships are prose instead of typed rows with cardinality, so a reviewer cannot run the relationship-endpoints-exist check. Reviewer should echo: "add a Key Fields column to every entity, convert relationships to the typed table with cardinality, and either reference AuditLog from a feature or remove it as an orphan."

## Red

> "We will have users and stuff."

This is red because no entities are enumerated, no key fields are named, no relationships exist, and nothing the Features section references can be validated against this model. Stage 4 of validation (Data Model Coverage) cannot run because there is no data model to compare against. Reviewer must mark as blocking — the entire downstream pipeline (contracts-agent type generation, plan-builder-agent schema expansion, criteria-planner test design) is starved of input.


## Prescribe-to-10

If this dimension scored below 10, the reviewer MUST include specific prescriptive text: "To reach 10, this roadmap should <specific action>." No vague guidance — name the exact fix.
