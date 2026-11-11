# model

Any data structure: database table, code class/aggregate, API DTO. Drawn as a table.

```yaml
id: llns90zy3d
ownedBy: d8mg4xc8ef    # required; system or module. Never `parent`.
name: Order
fields:
  - { id: jxhrrx2cmz, name: id, type: uuid, pk: true }
  - { id: xbsmlwkerd, name: customerId, type: uuid, required: true, ref: wpbo4l3k21 }
  - { id: wmzkfdam0u, name: total, type: decimal, constraints: [min 0] }
indexes:
  - { name: ix_order_customer, fields: [xbsmlwkerd], unique: false }
```

Other entities show a model owned elsewhere by listing it in their `models`.

## Field keys

| key | meaning |
| --- | --- |
| `id` | required; unique across everything (`sdv id`) |
| `name` | required; unique within the model |
| `type` | primitive type, free text (`uuid`, `string`, `decimal`...) |
| `model` | id of a model this field holds (composition). Exactly one of `type`/`model`. |
| `many` | holds a list of `type`/`model` |
| `required` | must be given on create |
| `nullable` | may hold null (independent of `required`) |
| `pk` / `pi` | part of primary key / primary index. A `pk` field cannot be nullable. |
| `constraints` | free text: `[positive, max 200]` |
| `ref` | foreign key: id of a model or field it holds the key of. Not with `model`. |
| `from` | lineage: ids of fields (any model) this value comes from |
| `derived` | free text: how the value is computed/changed from `from` |

`indexes[].fields` are field ids of the same model.

## Table vs code object

- Table: flat `type` fields, `ref` for foreign keys, keys and indexes.
- Code object: `model` (+ `many`) for nested objects; skip keys/indexes.

```yaml
name: Order Aggregate
fields:
  - { id: g881dimd1e, name: customer, model: li65oa3wga, from: [xbsmlwkerd] }   # Customer object, was customerId
  - { id: eqibk7xt0j, name: lines, model: ahwod9ofrf, many: true }              # OrderLine[]
```

## Lineage (`from`)

Every field in a derived model (aggregate, DTO) should say where it comes from, so change
impact can be traced.

- unchanged/renamed: one `from`
- modified: `from` + `derived`
- calculated: several `from` (or none) + `derived`
- dropped: source field with nothing pointing at it
- new source data: no `from`

```yaml
- { id: f5pyjr5xh9, name: summary, type: string, from: [qxc7jxeb84], derived: first 160 chars }
```

`from` must name fields, never models; cycles are errors.

## Rendering

- `ref` to a sibling table: arrow line. `model` to a sibling table: line with a diamond at
  the holder. Targets elsewhere show as text.
- Type column shows `Customer` / `OrderLine[]`; Source column shows `from` + `derived`.
