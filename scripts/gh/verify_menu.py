# -*- coding: utf-8 -*-
# Runs INSIDE Rhino 8. Drives the Swalloop menu in Grasshopper's menu bar like a user: finds the menu,
# lists its items, clicks the featured one (the tower template), waits for Grasshopper's own solver
# and checks the new document against the golden file. Saves a viewport capture.
#
#   Rhino.exe /nosplash /runscript="-_RunPythonScript C:\...\scripts\gh\verify_menu.py"
#
# Result: %TEMP%\swalloop-gh-menu.json
import json
import os
import traceback

import System
import Rhino
import scriptcontext

REPO = r"C:\Users\nadaf\Desktop\swalloop"
OUT = os.path.join(os.environ.get("TEMP", REPO), "swalloop-gh-menu.json")
GRASSHOPPER = System.Guid("b45a29b1-4343-4035-989e-044e8580d9cf")
result = {"ok": False, "steps": []}


def write():
    with open(OUT, "w") as f:
        json.dump(result, f, indent=1)


def walk(items, depth=0):
    out = []
    for it in items:
        out.append("%s%s" % ("  " * depth, it.Text if hasattr(it, "Text") else "-"))
        if hasattr(it, "DropDownItems"):
            out.extend(walk(it.DropDownItems, depth + 1))
    return out


def reflect(obj, words):
    names = set()
    for m in obj.GetType().GetMethods():
        if any(w in m.Name for w in words):
            names.add("%s(%s)" % (m.Name, ",".join(p.ParameterType.Name for p in m.GetParameters())))
    for p in obj.GetType().GetProperties():
        if any(w in p.Name for w in words):
            names.add("prop " + p.Name)
    return sorted(names)


state = {"phase": 0}


def tick(sender, args):
    import Grasshopper
    import System.Drawing as D
    try:
        state["phase"] += 1
        editor = Grasshopper.Instances.DocumentEditor
        if state["phase"] == 1:
            menus = editor.MainMenuStrip.Items.Find("SwalloopMenu", False)
            result["menu_found"] = len(menus) == 1
            if len(menus) != 1:
                raise Exception("Swalloop menu is not in Grasshopper's menu bar")
            root = menus[0]
            result["menu_items"] = walk(root.DropDownItems)
            result["documents_before"] = Grasshopper.Instances.DocumentServer.DocumentCount
            featured = root.DropDownItems.Find("SwalloopFeatured", False)
            result["featured_found"] = len(featured) == 1
            featured[0].PerformClick()
            result["featured_text"] = featured[0].Text
            sender.Interval = 9000
            return
        if state["phase"] == 2:
            doc = Grasshopper.Instances.ActiveCanvas.Document
            result["documents_after"] = Grasshopper.Instances.DocumentServer.DocumentCount
            result["doc_objects"] = doc.ObjectCount
            by = {}
            for o in doc.Objects:
                by[o.NickName] = o
            with open(os.path.join(REPO, "dotnet", "golden", "skyscraper-manhattan.golden.json")) as f:
                gold = json.load(f)["nodes"]
            m = by["metrics"]
            got = []
            for i in range(4):
                vals = list(m.Params.Output[i].VolatileData.AllData(True))
                got.append(vals[0].Value if vals else None)
            want = [gold["metrics"]["outputs"][k] for k in ("gfa", "material", "moment", "util")]
            result["metrics"] = got
            result["metrics_expected"] = want
            result["passes"] = by["end"].Message
            errs = []
            for name, o in by.items():
                try:
                    for msg in o.RuntimeMessages(Grasshopper.Kernel.GH_RuntimeMessageLevel.Error):
                        errs.append("%s: %s" % (name, msg))
                except Exception:
                    pass
            result["errors"] = errs
            result["ok"] = (not errs and all(g is not None and abs(g - w) <= 1e-9 * max(1.0, abs(w)) for g, w in zip(got, want))
                            and result["documents_after"] == result["documents_before"] + 1 and doc.ObjectCount > 10)

            # what the canvas viewport can do, for framing the canvas capture
            cv = Grasshopper.Instances.ActiveCanvas
            result["canvas_members"] = reflect(cv, ["Zoom", "Extent", "Viewport", "Image", "Bitmap"])
            try:
                result["viewport_members"] = reflect(cv.Viewport, ["Zoom", "Extent", "Fit", "Screen", "Translate", "Pan", "Scale", "Centre", "Center", "Map"])
            except Exception:
                result["viewport_members"] = "unavailable"

            # viewport capture: the tower with the grey context
            try:
                view = Rhino.RhinoDoc.ActiveDoc.Views.ActiveView
                box = Rhino.Geometry.BoundingBox.Empty
                for o in doc.Objects:
                    if o.NickName == "view":
                        for pi in (0, 1, 2):
                            for d in o.Params.Output[pi].VolatileData.AllData(True):
                                try:
                                    box.Union(d.Value.GetBoundingBox(True))
                                except Exception:
                                    pass
                if box.IsValid:
                    view.ActiveViewport.ZoomBoundingBox(box)
                    view.ActiveViewport.SetCameraDirection(Rhino.Geometry.Vector3d(-1, 1, -0.7), True)
                    view.ActiveViewport.ZoomBoundingBox(box)
                view.Redraw()
                p = os.path.join(REPO, "docs", "gh-viewport-skyscraper-manhattan.png")
                view.CaptureToBitmap(D.Size(1200, 800)).Save(p)
                result["viewport_png"] = p
            except Exception:
                result["viewport_error"] = traceback.format_exc()
            sender.Stop()
            write()
    except Exception:
        result["error"] = traceback.format_exc()
        sender.Stop()
        write()


try:
    result["steps"].append("plug-in loaded: %s" % Rhino.PlugIns.PlugIn.LoadPlugIn(GRASSHOPPER))
    Rhino.RhinoApp.RunScript("_Grasshopper", False)
    import System.Windows.Forms as WF
    timer = WF.Timer()
    timer.Interval = 9000
    timer.Tick += tick
    scriptcontext.sticky["swalloop_menu_timer"] = timer
    timer.Start()
except Exception:
    result["error"] = traceback.format_exc()
    write()
