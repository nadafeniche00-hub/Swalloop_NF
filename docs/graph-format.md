# Swalloop graph files

A canvas is one JSON file (`*.swalloop.json`). Templates are the same files: the skyscraper
case lives in [`templates/`](../templates) like every other example, and a pack only lists
which files it owns. Any host can read them (the Electron editor today, a Grasshopper
plugin next): the file says *what is wired to what*, never how the editor draws it.

```json
{
  "format": "swalloop-graph",
  "version": 1,
  "name": "Manhattan block",
  "description": "One tower in a dense Manhattan-like block...",
  "group": "Skyscraper form-finding",
  "featured": true,
  "nodes": [
    { "id": "tower", "type": "tower", "position": { "x": 0, "y": 0 },
      "params": { "floors": 60, "floorH": 4, "width": 36, "depth": 36, "twist": 0, "round": 0.2, "source": "Initial" } }
  ],
  "edges": [
    { "from": "tower.tower", "to": "start.initial" }
  ]
}
```

| Field | Meaning |
|---|---|
| `format`, `version` | Must be `swalloop-graph`. A reader refuses a `version` newer than it knows. |
| `name`, `description` | Shown on the start screen and as the canvas title. |
| `group` | Start-screen section. `featured: true` makes the file the primary button (one per app). |
| `nodes[].id` | Unique string within the file. |
| `nodes[].type` | A node type id from a pack (or the core). Unknown types make the file unreadable and are named in the error. |
| `nodes[].params` | Every parameter of the node, by id. Missing ones take the node's default, so older files keep opening when a parameter is added. |
| `nodes[].position` | Editor layout only. Optional. |
| `edges[].from`, `to` | `nodeId.portId`. An output port to an input port, or to a **numeric** parameter (a wire overrides the widget). Select parameters take no wires. |

## Rules a reader must follow

1. **A wire to a missing node or port is skipped and reported**, not fatal. A missing node *type* is fatal.
2. **Wires never form a cycle**, except through a Loop Start / Loop End pair, whose feedback is carried by memory and is never drawn.
3. **A Loop End pairs with the nearest unclaimed Loop Start upstream**, inner loops first.
4. **Loop End kinds**: `Repeat`, `While`, `Fold`, `For each` (see the README for their exact behaviour).
5. **Adopted results** are stored as the `snapshot` parameter on the node that feeds Loop Start (the Tower node does this today); it is not listed in the node type's parameters, and a reader may ignore it.

## What is in the box

| Pack | Node types |
|---|---|
| core | `number`, `readout`, `range`, `math`, `compare`, `logic`, `loopStart`, `loopEnd`, `inspect` |
| math | `newton`, `logistic` |
| skyscraper | `context`, `tower`, `wind`, `orient`, `structure`, `sun`, `metrics`, `viewer`, and the adapters `profile`, `outline`, `splats` |
| analysis | `listMath`, `pack`, `integrate`, `logWind`, `fourier`, `fourierCurve`, `splatField`, `affine`, `matmul`, `matpow`, `applyMatrix`, `polygon`, `pca` |

Pure functions: every node's `compute(inputs, params)` returns new values and never mutates its inputs.
That is what lets a loop re-run a body any number of times, and what a port to another language has to preserve.
