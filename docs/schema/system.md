# system

Top-level application (ERP, Webshop). No `parent`. Own folder; children live under it.

```yaml
id: fghfo41tiv
name: ERP
models: [<model id>]   # optional: models owned elsewhere, drawn inside as dashed references
```

Children: modules, apis, models (via `ownedBy`).
