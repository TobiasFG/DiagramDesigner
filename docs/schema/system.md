# system

Top-level application (ERP, Webshop). No `parent`. Own folder; children live under it.

```yaml
id: fghfo41tiv
name: ERP
models: [<model id>]   # optional: models owned elsewhere, drawn inside as dashed references
```

Children: modules, apis (listed on a rail across the right border), models (via `ownedBy`), models stored here (via their `storedIn`).
