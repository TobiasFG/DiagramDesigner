# module

Part of a system (service, component, database). Modules nest.

```yaml
id: iatbgcla3c
parent: fghfo41tiv     # system or module
name: Database
models: [li65oa3wga]   # optional: models owned elsewhere, drawn inside as dashed references
```

Children: modules, logic-units, apis, models (via `ownedBy`).
Listing a model this module already owns is a warning.
