# Swalloop for Grasshopper

The Grasshopper side of Swalloop. The engine is [`Swalloop.Core`](../Swalloop.Core), the same one the
desktop editor's JavaScript engine is tested against; this project turns it into components and
canvases.

## What you get

- **One component per node type** (35 of them, tab *Swalloop*), generated from the editor's own
  registry, so ports, parameter names and defaults are the editor's. Numeric parameters are inputs
  with a default (wire a slider into them); select parameters are text inputs.
- **Loop Start and Loop End.** Grasshopper refuses a wire that feeds a result back into its own
  inputs, so the loop is not drawn. When Loop End solves, it walks the wires upstream, rebuilds what
  feeds it as an engine graph, and the engine pairs it with its Loop Start and iterates the body
  internally. The canvas stays a plain graph; the components between Start and End show one pass,
  and Loop End shows the settled result and a *"150 passes"* badge.
- **Viewer** (the tower as a vertex-coloured mesh, its floor outlines, the context as boxes),
  **Inspector** (numbers and lists as Grasshopper data, anything with a shape as curves or meshes),
  **Readout** (the number on the component).
- **A Swalloop menu in Grasshopper's menu bar**: *Open the skyscraper form-finding template* at the top
  (the featured template, like the desktop app's start button), then every template grouped as on the
  start screen. A click builds the canvas and opens it as a new document. The templates are embedded
  in the plugin, so nothing has to be on disk.
- **Swalloop Template**: runs a whole `*.swalloop.json` inside one component (floors, metrics, passes).
- **The templates as real canvases**: [`templates/grasshopper/`](../../templates/grasshopper) holds
  every template as a `.gh` file, one component per node, native sliders and panels, the same
  wires. Open one in Grasshopper and it solves.

## Install

```powershell
powershell -ExecutionPolicy Bypass -File dotnet/install-gha.ps1
```

Close Rhino first (a loaded `.gha` is locked), restart Rhino, and the **Swalloop** tab appears.
Rhino 8 runs plugins on .NET Framework by default; if you switched it to .NET 8 (`SetDotNetRuntime`),
use `-Framework net7.0-windows`.

## How it is checked

All of it runs inside Rhino 8 and compares with the golden files from the JavaScript engine.

| Command | What it proves |
|---|---|
| `npm run gha:verify` | The *Swalloop Template* component gives the app's floors, metrics and pass counts. |
| `npm run gha:canvases` | Every template, built as a Grasshopper canvas, matches the golden file **node by node** (every output of every component), with no component errors. Then each saved `.gh` is **reopened from disk**, solved and compared again. |
| `scripts/gh/verify-live.ps1` | Opens a `.gh` in the real editor with Grasshopper's own solver and compares the result; saves a viewport capture. |
| `npm run gha:menu` | Clicks *Open the skyscraper form-finding template* in the Swalloop menu like a user: a new document opens, Grasshopper's solver runs, the metrics match the golden file, no errors. |

Currently: 15 of 15 canvases and 15 of 15 reopened files match (to about 1e-11); the real solver
gives zero errors and the golden metrics.

One thing the comparison deliberately skips: components that read a Loop Start's *Item* are solved
outside any loop on the canvas, where Item has no value. The JavaScript engine feeds *undefined*
into the maths there and gets `NaN`; Grasshopper uses the parameter's default. Neither is a result,
so those few nodes (listed in the report) are not compared, while the loop's own result is.

## Regenerating

```bash
node scripts/gen-gh-catalog.mjs   # after changing a node definition: Catalog.g.cs and Components.g.cs
```

Components are marked `[NodeType("id")]`; the catalog JSON carries titles, ports, parameters,
defaults and a stable GUID per node type (a hash of its id), so GUIDs never change between builds.

## Layout

| File | Purpose |
|---|---|
| `Catalog.cs`, `Catalog.g.cs` | The node catalog, generated from the JavaScript registry |
| `NodeComponent.cs`, `Components.g.cs` | The component base class and the 31 generated components |
| `LoopEndComponent.cs`, `GraphExtractor.cs` | Loop End, and how the wires become an engine graph |
| `ViewComponents.cs`, `Geometry.cs` | Inspector, Readout, Viewer and the Rhino geometry they produce |
| `Interop.cs` | Engine values on Grasshopper wires |
| `TemplateBuilder.cs`, `CanvasVerifier.cs` | Template file to canvas, and the node-by-node check |
| `TemplateLibrary.cs`, `SwalloopMenu.cs` | The embedded templates and the menu that opens them |
| `TemplateRunnerComponent.cs`, `SwalloopInfo.cs`, `Icons.cs` | The runner, the plugin identity, the icons (drawn in code) |

Targets `net48` and `net7.0-windows` against the Grasshopper 8.0 package (loads on every Rhino 8.x).
