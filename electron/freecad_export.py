# Runs inside FreeCADCmd. Rebuilds the tower and its context from the JSON
# written by the Swalloop app and saves FCStd, STEP and IFC files.
#
#   SWALLOOP_IN   path of the input JSON  { tower, context }
#   SWALLOOP_OUT  output directory
#
# Units: the app works in metres, FreeCAD in millimetres.
import json
import math
import os
import traceback

import FreeCAD
import Part
import Arch

M = 1000.0
src = json.load(open(os.environ["SWALLOOP_IN"]))
out = os.environ["SWALLOOP_OUT"]
os.makedirs(out, exist_ok=True)

tower = src["tower"]
context = src.get("context") or {"buildings": []}
floors = tower["floors"]
h = tower["h"]
V = FreeCAD.Vector

doc = FreeCAD.newDocument("SwalloopTower")


RING_N = 64  # keep in sync with src/geometry.js


def super_exponent(r):
    return 2 + 18 * (1 - min(1.0, max(0.0, r))) ** 1.5


def sgn(v):
    return (v > 0) - (v < 0)


def ring(f):
    """Closed superellipse outline of one floor, same maths as the app."""
    e = 2.0 / super_exponent(f.get("round", 0))
    c, s = math.cos(f["rot"]), math.sin(f["rot"])
    pts = []
    for k in range(RING_N):
        t = 2 * math.pi * k / RING_N
        ct, st = math.cos(t), math.sin(t)
        x = f["w"] / 2 * sgn(ct) * abs(ct) ** e
        y = f["d"] / 2 * sgn(st) * abs(st) ** e
        pts.append((f["cx"] + x * c - y * s, f["cy"] + x * s + y * c))
    return pts


def polygon(points, z):
    """Straight-segment outline: the IFC exporter cannot read spline profiles."""
    pts = [V(x * M, y * M, z * M) for x, y in points]
    return Part.makePolygon(pts + [pts[0]])


def curve(points, z):
    """A closed, periodic B-spline through the outline points."""
    bs = Part.BSplineCurve()
    bs.interpolate([V(x * M, y * M, z * M) for x, y in points], PeriodicFlag=True)
    return Part.Wire(bs.toShape())


# --- the tower as one smooth loft through every floor curve -----------------
sections = [curve(ring(f), f["z"]) for f in floors]
sections.append(curve(ring(floors[-1]), floors[-1]["z"] + h))
shell = Part.makeLoft(sections, True, False)
shaft = doc.addObject("Part::Feature", "TowerMass")
shaft.Shape = shell

# --- BIM: one slab per floor, grouped in a level, in a building ------------
slabs = []
for i, f in enumerate(floors):
    face = Part.Face(polygon(ring(f), f["z"]))
    solid = face.extrude(V(0, 0, 0.35 * M))
    base = doc.addObject("Part::Feature", "FloorPlate%02d" % i)
    base.Shape = solid
    s = Arch.makeStructure(base, name="Slab%02d" % i)
    s.IfcType = "Slab"
    s.Label = "Floor %d" % i
    slabs.append(s)
level = Arch.makeFloor(slabs)
level.Label = "Tower floors"

ctx_objs = []
for i, b in enumerate(context["buildings"]):
    box = Part.makeBox(b["w"] * M, b["d"] * M, b["h"] * M, V((b["x"] - b["w"] / 2) * M, (b["y"] - b["d"] / 2) * M, 0))
    o = doc.addObject("Part::Feature", "Context%03d" % i)
    o.Shape = box
    s = Arch.makeStructure(o, name="Neighbour%03d" % i)
    s.IfcType = "Building Element Proxy"
    s.Label = "Neighbour %d" % i
    ctx_objs.append(s)

site_group = Arch.makeFloor(ctx_objs)
site_group.Label = "Neighbourhood"
building = Arch.makeBuilding([level, site_group])
building.Label = "Swalloop tower study"
doc.recompute()

doc.saveAs(os.path.join(out, "tower.FCStd"))
Part.export([shaft], os.path.join(out, "tower_mass.step"))

result = {"fcstd": True, "step": True, "ifc": False}
try:
    from importers import exportIFC
    exportIFC.export([building], os.path.join(out, "tower.ifc"))
    result["ifc"] = True
except Exception as e:  # IFC is best effort; STEP and FCStd are already saved
    result["ifc_error"] = str(e)
    result["ifc_trace"] = traceback.format_exc()[-1500:]
json.dump(result, open(os.path.join(out, "export_result.json"), "w"))
print("SWALLOOP_EXPORT_DONE", json.dumps(result))
