# module

Part of a system (service, component, database). Modules nest.

```yaml
id: iatbgcla3c
parent: fghfo41tiv     # system or module
name: Database
models: [li65oa3wga]   # optional: models owned elsewhere, drawn inside as dashed references
```

Children: modules, logic-units, apis (listed on a rail across the right border), models (via `ownedBy`, drawn as classes), and models
stored here (via their `storedIn`, drawn as stored tables).
Listing a model this module already owns or stores is a warning.
