# Goals

Open goals only. **Remove a goal once it is achieved**; keep this list lean.

## Change impact

- Select a field or model; highlight everything affected across the landscape by following
  `from`, `ref`, `model` and `models` edges in reverse.
- Answer "what breaks if I drop/alter this field": list affected fields, models, modules, systems.
- Draw `from` lineage as lines between fields (today only the Source column shows it).

## APIs

- APIs own or list their request/response models (today models can only be owned by a system
  or module).
- API models use `from` for every field, so impact flows from database to API consumers.

## Authoring

- `sdv derive <model id>`: new model copying the source's fields, each with `from` set, so an
  unchanged copy costs nothing to write.
- In-app editor for small fixes: rename, reconnect a line, add/remove a field, change a type.

## Canvas

- Attach flow, sequence and class/ER diagrams to elements and connections; open on click/zoom.
- Link connections between systems to the data models they carry.
- Remember which boxes are open.
- Hosting (e.g. "Azure Container App") as a property of an application or service.
