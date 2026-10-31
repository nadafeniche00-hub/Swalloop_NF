# -*- coding: utf-8 -*-
# Runs INSIDE Rhino 8 (IronPython, RunPythonScript). For every template in /templates it builds the
# Grasshopper canvas (one component per node, the same wires), solves it, compares the outputs of
# every node with the golden files from the JavaScript engine, and saves the canvas as a .gh file in
# templates/grasshopper/.
#
#   Rhino.exe /nosplash /runscript="-_RunPythonScript C:\...\scripts\gh\verify_canvases.py"
#
# Result: %TEMP%\swalloop-gh-canvases.json
import json
import os
import traceback

import System
import Rhino

REPO = r"C:\Users\nadaf\Desktop\swalloop"
OUT = os.path.join(os.environ.get("TEMP", REPO), "swalloop-gh-canvases.json")
GRASSHOPPER = System.Guid("b45a29b1-4343-4035-989e-044e8580d9cf")
result = {"ok": False, "steps": [], "templates": []}


def save():
    with open(OUT, "w") as f:
        json.dump(result, f, indent=1)


try:
    result["steps"].append("Grasshopper plug-in loaded: %s" % Rhino.PlugIns.PlugIn.LoadPlugIn(GRASSHOPPER))
    Rhino.RhinoApp.RunScript("_Grasshopper", False)  # loads the libraries (and shows the editor)

    import clr
    asm = [a for a in System.AppDomain.CurrentDomain.GetAssemblies() if a.GetName().Name == "Swalloop"]
    result["steps"].append("Swalloop assembly loaded: %s" % (len(asm) == 1))
    if len(asm) != 1:
        raise Exception("Swalloop.gha is not loaded; run dotnet/install-gha.ps1 and restart Rhino.")
    clr.AddReference(asm[0])
    from Swalloop.GH.Testing import CanvasVerifier

    out_dir = os.path.join(REPO, "templates", "grasshopper")
    report = json.loads(CanvasVerifier.VerifyAll(
        os.path.join(REPO, "templates"), os.path.join(REPO, "dotnet", "golden"), out_dir, True))
    result["templates"] = report
    result["ok"] = len(report) > 0 and all(r.get("ok") for r in report)
    for r in report:
        result["steps"].append("%-28s ok=%-5s nodes=%-3s numbers=%-5s skipped=%s maxAbs=%.1e" % (
            r["template"], r.get("ok"), r.get("nodes"), r.get("compared"), r.get("skipped"), r.get("maxAbs") or 0) +
            "  file reopened: ok=%s numbers=%s" % (r.get("roundTripOk"), r.get("roundTripCompared")))
except Exception:
    result["error"] = traceback.format_exc()
finally:
    save()
