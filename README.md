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

- **One canvas, one model.** Elements nest (system › container › component). Zooming in
  opens a box to show its children. Relationships between hidden children are folded into a
  single line between the visible parents, and split up again as you zoom in.
- **Detail on demand.** Behavioural and data diagrams (flow, sequence, class, ER) are not
  part of the landscape layout. They attach to the element or connection they describe and
  open when you click or zoom in on it. If something sends an "Order", you can open the
  Order class/ER diagram from there.
- **Data models live in their own place.** Class/ER models are kept together and can be
  focused by domain in a separate view. The canvas references them, so one model can be
  linked from many places and is edited in one place.
- **AI generates, people fix.** The model is structured, validated text that an AI can
  produce or patch. The editor covers the small corrections people make without re-prompting:
  rename, reconnect a wrong line, add or remove a field, change a type.
- **Automatic layout.** Nobody positions boxes by hand. Layout is computed per level, and
  dragging a box is an optional override that pins it.
- **Deployment is a property, not a separate view.** Hosting (for example "Azure Container
  App") is detail on an application or service. Deeper infrastructure views can come later.

## Status

- **Working:** the home page is a single canvas over the whole model. The layout is computed
  once, and zooming only moves the camera: detail fades in and out in place. The deepest box
  under the centre is the focus. Everything unrelated to it fades, and only its connections
  are drawn. A consumer in focus shows the specific APIs it calls. A provider in focus shows
  lines from its APIs to the consuming systems. Clicking a box or a line flies there.
  `npm run dev:commerce` opens the development landscape in `examples/commerce/`: one file
  per entity (`<name>.<kind>.yaml`), one folder per system.
- **Not yet:** attaching flow, sequence and class/ER diagrams to elements and connections;
  linking connections to data models; saving which boxes are open.
- **Still the earlier prototype:** the six separate diagram types (component, class, object,
  flow, pipeline, sequence) remain available as individual views at `/views`. Which of them
  survive, and how, is undecided.

## How it works

The YAML files under `design/` are the source of truth. The canvas and a text editor are
two equal ways of changing them, and every canvas edit is written back to the files with
comments and formatting intact.

```
design/            model, views and layout — edit by hand or on the canvas
docs/diagrams/     generated exports (Mermaid, SVG, PNG)
tool/              the SvelteKit app and the `sdv` CLI
sdv.config.ts      paths, export formats, theme, snap grid
```

The schema in `tool/src/lib/model/schema.ts` is the reference for the model format, and
`design/` contains a working example.

## Quick start

Requires Node 22.12+.

```sh
npm install          # also installs tool/
npm run dev          # http://localhost:5173
npm run dev:commerce # the same, on examples/commerce
npm run validate     # schema and reference checks
npm run export       # regenerate docs/diagrams
npm test
```

PNG export and the end-to-end tests need Chromium once:
`npx --prefix tool playwright install chromium`.
