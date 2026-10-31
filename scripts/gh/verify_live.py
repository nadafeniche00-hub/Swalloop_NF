# -*- coding: utf-8 -*-
# Runs INSIDE Rhino 8. Opens a saved template canvas the way a user would (the Grasshopper "Open"
# command), lets Grasshopper's own solver run, and then, from a UI timer so the solver has finished,
# reads what the components solved to and writes it next to the golden values.
#
#   Rhino.exe /nosplash /runscript="-_RunPythonScript C:\...\scripts\gh\verify_live.py"
#
# Result: %TEMP%\swalloop-gh-live.json
import json
import os
import traceback

import System
import Rhino
import scriptcontext

REPO = r"C:\Users\nadaf\Desktop\swalloop"
NAME = "skyscraper-manhattan"
OUT = os.path.join(os.environ.get("TEMP", REPO), "swalloop-gh-live.json")
SHOTS = os.path.join(REPO, "docs")
GRASSHOPPER = System.Guid("b45a29b1-4343-4035-989e-044e8580d9cf")
result = {"ok": False, "template": NAME, "steps": []}


def write():
    with open(OUT, "w") as f:
        json.dump(result, f, indent=1)


def capture():
    """Zooms the canvas and the viewport to the content, and saves both as PNG (from inside the process)."""
    import Grasshopper
    import System.Drawing as D
    import System.Windows.Forms as WF
    shots = {}
    editor = Grasshopper.Instances.DocumentEditor
    canvas = Grasshopper.Instances.ActiveCanvas
    try:
        editor.WindowState = WF.FormWindowState.Maximized
        editor.BringToFront()
        names = sorted(set(m.Name for m in canvas.GetType().GetMethods() if "xtent" in m.Name or "ZoomAll" in m.Name))
        result["canvas_zoom_methods"] = names
        for n in names:
            m = [x for x in canvas.GetType().GetMethods() if x.Name == n and len(x.GetParameters()) == 0]
            if m:
                m[0].Invoke(canvas, None)
                result["canvas_zoom_used"] = n
                break
        canvas.Refresh()
        bmp = D.Bitmap(canvas.Width, canvas.Height)
        canvas.DrawToBitmap(bmp, D.Rectangle(0, 0, canvas.Width, canvas.Height))
        p = os.path.join(SHOTS, "gh-canvas-%s.png" % NAME)
        bmp.Save(p)
        shots["canvas"] = p
    except Exception:
        result["canvas_shot_error"] = traceback.format_exc()
    try:
        doc = Rhino.RhinoDoc.ActiveDoc
        view = doc.Views.ActiveView
        # frame whatever the Viewer previews: its tower mesh and floor curves
        box = Rhino.Geometry.BoundingBox.Empty
        gh = canvas.Document
        for o in gh.Objects:
            if o.NickName == "view":
                for pi in (0, 1, 2):
                    for d in o.Params.Output[pi].VolatileData.AllData(True):
                        g = d.Value
                        try:
                            box.Union(g.GetBoundingBox(True))
                        except Exception:
                            pass
        if box.IsValid:
            view.ActiveViewport.ZoomBoundingBox(box)
            view.ActiveViewport.SetCameraDirection(Rhino.Geometry.Vector3d(-1, 1, -0.7), True)
            view.ActiveViewport.ZoomBoundingBox(box)
        view.Redraw()
        vbmp = view.CaptureToBitmap(D.Size(1200, 800))
        p = os.path.join(SHOTS, "gh-viewport-%s.png" % NAME)
        vbmp.Save(p)
        shots["viewport"] = p
        result["preview_box"] = str(box)
    except Exception:
        result["viewport_shot_error"] = traceback.format_exc()
    result["screenshots"] = shots


def collect():
    import Grasshopper
    doc = Grasshopper.Instances.ActiveCanvas.Document if Grasshopper.Instances.ActiveCanvas else None
    if doc is None:
        raise Exception("no active Grasshopper document")
    result["doc_objects"] = doc.ObjectCount
    result["solution_state"] = str(doc.SolutionState)
    byname = {}
    for o in doc.Objects:
        byname[o.NickName] = o
    with open(os.path.join(REPO, "dotnet", "golden", NAME + ".golden.json")) as f:
        gold = json.load(f)["nodes"]

    def out_values(obj, i):
        return [d for d in obj.Params.Output[i].VolatileData.AllData(True)]

    m = byname["metrics"]
    got = []
    for i in range(4):
        vals = out_values(m, i)
        got.append(vals[0].Value if vals else None)
    want = [gold["metrics"]["outputs"][k] for k in ("gfa", "material", "moment", "util")]
    result["metrics"] = got
    result["metrics_expected"] = want
    result["passes"] = byname["end"].Message
    result["errors"] = []
    for name, o in byname.items():
        try:
            for lvl in (Grasshopper.Kernel.GH_RuntimeMessageLevel.Error, Grasshopper.Kernel.GH_RuntimeMessageLevel.Warning):
                for msg in o.RuntimeMessages(lvl):
                    result["errors"].append("%s: %s" % (name, msg))
        except Exception:
            pass
    result["ok"] = all(g is not None and abs(g - w) <= 1e-9 * max(1.0, abs(w)) for g, w in zip(got, want)) and not result["errors"]


try:
    result["steps"].append("plug-in loaded: %s" % Rhino.PlugIns.PlugIn.LoadPlugIn(GRASSHOPPER))
    Rhino.RhinoApp.RunScript("_Grasshopper", False)
    path = os.path.join(REPO, "templates", "grasshopper", NAME + ".gh")
    Rhino.RhinoApp.RunScript('-_Grasshopper _Document _Open "%s" _Enter' % path, False)
    result["steps"].append("open command sent for %s" % path)

    import System.Windows.Forms as WF
    timer = WF.Timer()
    timer.Interval = 9000
    phase = {"n": 0}

    def tick(sender, args):
        phase["n"] += 1
        if phase["n"] == 1:  # solved by now: frame the views, give them time to paint, then read the data
            try:
                capture()
            except Exception:
                result["capture_error"] = traceback.format_exc()
            timer.Interval = 5000
            return
        timer.Stop()
        try:
            collect()
        except Exception:
            result["error"] = traceback.format_exc()
        write()

    timer.Tick += tick
    scriptcontext.sticky["swalloop_live_timer"] = timer
    timer.Start()
except Exception:
    result["error"] = traceback.format_exc()
    write()
