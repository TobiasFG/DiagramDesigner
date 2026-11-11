# Entity files

One entity per file: `<name>.<kind>.yaml`. Kinds: [system](system.md), [module](module.md),
[model](model.md), [logic-unit](logic-unit.md), [api](api.md). One folder per system;
everything in the system lives under it.

## Common keys

```yaml
id: k3x9q0abcd     # required; generated, never edited; unique across all entities and fields
parent: <id>       # every kind except system and model (model uses ownedBy)
name: Order        # display name; defaults to the file name
tags: [internal]
links: [{ label: Docs, url: https://... }]
meta: { owner: team-a }   # string values only
```

Unknown keys are errors. References are always ids, never names.

## CLI (from repo root)

- `npm run sdv -- new path/name.kind.yaml --parent <id>`: create with fresh id.
- `npm run sdv -- id 5`: 5 fresh ids (for model fields).
- `npm run sdv -- validate --root <dir>`: schema + reference checks.
- JSON Schema: `tool/schema/entity.schema.json` (regenerate: `npm --prefix tool run schema`).
- Source of truth: `tool/src/lib/model/schema.ts` (shape), `model.ts` (cross-file rules).
