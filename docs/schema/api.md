# api

One endpoint a system or module exposes. Drawn as a port on its parent's border, not as a
box.

```yaml
id: a2uivekzaq
parent: d8mg4xc8ef           # system or module
name: Place order            # shown on hover and in the inspector
method: POST                 # required: GET POST PUT PATCH DELETE HEAD OPTIONS
path: /orders/{orderNo}      # required; starts with /
auth: bearer                 # free text, optional
params:                      # path, query and header params (not the body)
  - { name: orderNo, in: path, type: string }
  - { name: dryRun, in: query, type: bool, required: false, description: validate only }
request: { model: llns90zy3d, many: false, contentType: application/json }   # the body
responses:
  - { status: 201, model: llns90zy3d, description: Created }
  - { status: 400, description: Invalid order }             # no model: no body
```

- Every `{name}` in `path` needs a `path` param, and every `path` param must be in `path`.
  Path params are always required.
- `request.model` and `responses[].model` are model ids, owned anywhere. `many: true` means
  a list. `contentType` defaults to `application/json`.
- A status is listed once.

Request/response shapes that differ from the stored model are their own models, usually owned
by the api's parent, with `from` lineage (see [model](model.md)).

## Rendering

- A chip straddling the top border of its parent's box, right-aligned: method (coloured) and
  path. If the parent is hidden (inside a closed box), the chip moves to the nearest shown
  box round it, so a closed system carries every api inside it.
- Click a chip: the inspector shows params, request and responses; click a model to fly to it.
