# Entity files

One entity per file: `<name>.<kind>.yaml`. Kinds: [module](module.md),
[model](model.md), [logic-unit](logic-unit.md), [api](api.md), [trigger](trigger.md),
[channel](channel.md), [flag](flag.md). Pending changes over the design
live in [scenario](scenario.md) files. A module with no parent is a
root, drawn as a system; one folder per root, and everything in it lives under it.

## Common keys

```yaml
id: k3x9q0abcd     # required; generated, never edited; unique across all entities and fields
parent: <id>       # every kind except model (ownedBy); optional on modules (none = root)
name: Order        # display name; defaults to the file name
tags: [internal]
links: [{ label: Docs, url: https://... }]
meta: { owner: team-a }   # string values only
```

Unknown keys are errors. References are always ids, never names.

## CLI (from repo root)

- `npm run sdv -- new path/name.kind.yaml --parent <id>`: create with fresh id.
- `npm run sdv -- id 5`: 5 fresh ids (for model fields).
- `npm run sdv -- validate --root <dir>`: schema + reference checks, and stale scenario changes.
- `npm run sdv -- impact <file.scenario.yaml>`: what a scenario changes and breaks, as markdown.
- JSON Schema: `tool/schema/entity.schema.json` (regenerate: `npm --prefix tool run schema`).
- Source of truth: `tool/src/lib/model/schema.ts` (shape), `model.ts` (cross-file rules).

## Connections

Every link between two fields, models, logic units, apis or api fields is one connection,
drawn by one standard (`tool/src/lib/landscape/connections.ts`):

- **Direction:** the arrow points at what the start depends on: a `ref` at its key, `from` at
  its source, a unit's reads and writes at the model, a call at the callee, an api at the unit
  handling it and at the models its bodies use, a send at the channel, a trigger's event
  line at the channel's port, model or field it listens to. Every line starts in a dot on what
  depends and ends in an arrow on what it depends on; a held model (`model`) starts in a UML
  diamond at the holder instead of the dot. So change impact follows arrows backwards.
- **Style:** solid for structure (ref, holds, reads, writes, bodies), dashed for lineage,
  dotted for calls and handles, dashed for events. Grey at rest, the kind's colour when lit; widths stay the
  same on screen at any zoom.
- **Module Dependency Lines (at rest):** which module depends on which. Every connection whose
  ends are owned by different modules counts, whatever its kind, and so does a model stored in
  another module than its owner's (the store depends on the owner). Where a thing is owned
  decides, not where it is drawn. Each end is lifted to the child of the module both ends share,
  and one grey line between the two modules' name bars says that one depends on the other,
  however many connections make it (hover for them). So a line never crosses a border, and two entities in one module are never joined at rest. Lines between top-level
  modules always show; those inside a module once it covers a share of the view (25% by
  default, in Settings › Lines), and all of them in a focus.
- **Hover a module** (or click to pin it): its incoming and outgoing Module Dependency Lines
  light up blue, and so do the lines of the modules round it that carry its dependencies,
  shown even where the share hides them. The modules at the far ends stay bright, only those
  really depended on inside a far box; the lines inside the module stay as they are; the rest
  is toned down.
- **Flow Lines (hover anything else):** an entity (a card or rail) lights the connections of
  everything in it, an element (a row or rail api) only its own, one hop each way, to the far
  row, each on its own route. A card also shows lineage between its own rows, round its right
  side. Module Dependency Lines and everything the flows don't reach are toned down. **Click**
  pins them (a row or api opens its inspector, which lists the same connections); Esc unpins.
  An end off screen gets a wedge on the canvas edge; click it to go there.
- The **key** lists each kind; click one to hide it everywhere.
