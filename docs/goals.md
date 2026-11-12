# Goals

Open goals only. **Remove a goal once it is achieved**; keep this list lean.

## Change impact

- Select a field or model; highlight everything affected across the landscape by following
  `from`, `ref`, `model` and `models` edges in reverse.
- Answer "what breaks if I drop/alter this field": list affected fields, models, modules, systems.

## APIs

- API models use `from` for every field, so impact flows from database to API consumers.

## Authoring

- `sdv derive <model id>`: new model copying the source's fields, each with `from` set, so an
  unchanged copy costs nothing to write.
- In-app editor for small fixes: rename, reconnect a line, add/remove a field, change a type.

## Canvas

- Attach flow, sequence and class/ER diagrams to elements and connections; open on click/zoom.
- Link connections between systems to the data models they carry.
- Remember which boxes are open.

## References

- Route lines round cards instead of across them, so a lit line never runs over another
  card's rows.
- Cardinality at line ends from `required`/`nullable` (1 vs 0..1, crow's foot for `many`).
- Trace the whole `from` chain of a field, upstream and downstream, not just one hop.
- Show all links of a card at once from its name bar, without hovering row by row.
- Keyboard navigation in the inspector: step between linked rows, Enter to follow.
