# System Design Viewer

One large, interactive canvas for a system's architecture. It opens on the application
landscape and lets you zoom in to reveal more detail, from applications down to services
and components. Each level is the same model shown in more detail, so it is not a separate
diagram.

```
Application landscape
  ↓
System interaction / integration landscape
  ↓
Application architecture
  ↓
Component / service architecture
  ↓
Technical / deployment architecture
```

## Vision

- **One canvas, one model.** Entities nest (system › module › logic-unit, model). Zooming in
  opens a box to show its children. Relationships between hidden children are folded into a
  single line between the visible parents, and split up again as you zoom in.
- **Detail on demand.** Behavioural and data diagrams (flow, sequence, class, ER) are not
  part of the landscape layout. They attach to the element or connection they describe and
  open when you click or zoom in on it. If something sends an "Order", you can open the
  Order class/ER diagram from there.
- **Models are defined once.** A model (table, code object, API shape) has one owner and is
  referenced elsewhere, so it is edited in one place.
- **Change impact.** Fields record where their values come from, so altering or dropping a
  field shows everything it affects across the landscape.
- **AI generates, people fix.** The model is structured, validated text that an AI can
  produce or patch. The editor covers the small corrections people make without re-prompting:
  rename, reconnect a wrong line, add or remove a field, change a type.
- **Automatic layout.** Nobody positions boxes by hand. Layout is computed per level, and
  dragging a box is an optional override that pins it.
- **Deployment is a property, not a separate view.** Hosting (for example "Azure Container
  App") is detail on an application or service. Deeper infrastructure views can come later.

## Status

- **Working:** one canvas over the whole model. Layout is computed once; zooming only moves
  the camera and fades detail in and out (systems › modules › models). Models render as
  classes where they are owned (grouped with the models they alone hold) and as stored
  tables where they are stored, with keys, foreign-key and composition lines, and field
  lineage. Clicking selects.
- **Open goals:** [docs/goals.md](docs/goals.md).

## How it works

The design is a folder of YAML entity files, one per entity (`<name>.<kind>.yaml`), with
one folder per system. They are the source of truth. The canvas is read-only: edit the files
and the canvas updates on save.

```
examples/commerce/ development landscape (ERP, PIM, Webshop)
docs/schema/       format reference, one cookbook per entity kind
docs/goals.md      open goals
tool/              the SvelteKit app and the `sdv` CLI
sdv.config.ts      design root (examples/commerce by default), theme
```

`tool/src/lib/model/schema.ts` defines the format; `docs/schema/` explains it.

## Quick start

Requires Node 22.12+.

```sh
npm install          # also installs tool/
npm run dev          # http://localhost:5173, on examples/commerce
npm run validate     # schema and reference checks
npm test
```
