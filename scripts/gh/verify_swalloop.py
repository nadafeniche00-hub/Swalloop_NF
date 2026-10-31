# -*- coding: utf-8 -*-
# Runs INSIDE Rhino 8 (IronPython, RunPythonScript). Loads Grasshopper, instantiates the Swalloop
# Template component for every skyscraper template, solves it, and compares floors / metrics / passes
# with the golden files the JavaScript engine wrote (scripts/dump-golden.mjs).
#
#   Rhino.exe /nosplash /runscript="-_RunPythonScript C:\...\scripts\gh\verify_swalloop.py"
#
# The result goes to %TEMP%\swalloop-gh-verify.json. Not a unit test for Rhino itself: it proves that the
# .gha loads, the component is registered, and that Grasshopper produces the same numbers as the app.
import json
import os
import traceback

import System
import Rhino

REPO = r"C:\Users\nadaf\Desktop\swalloop"
OUT = os.path.join(os.environ.get("TEMP", REPO), "swalloop-gh-verify.json")
GRASSHOPPER = System.Guid("b45a29b1-4343-4035-989e-044e8580d9cf")
TEMPLATES = ["skyscraper-manhattan", "skyscraper-dubai", "skyscraper-manhattan-tuned", "skyscraper-dubai-tuned"]

result = {"ok": False, "steps": [], "cases": {}}


def step(msg):
    result["steps"].append(msg)


def save():
    with open(OUT, "w") as f:
        json.dump(result, f, indent=1)


def golden(name):
    with open(os.path.join(REPO, "dotnet", "golden", name + ".golden.json")) as f:
        return json.load(f)["nodes"]


try:
    plugin_loaded = Rhino.PlugIns.PlugIn.LoadPlugIn(GRASSHOPPER)
    step("Grasshopper plug-in loaded: %s" % plugin_loaded)
    Rhino.RhinoApp.RunScript("_Grasshopper", False)  # opens the editor, so the libraries are loaded for real
    import Grasshopper
    from Grasshopper.Kernel import GH_Document
    from Grasshopper.Kernel.Types import GH_String

    server = Grasshopper.Instances.ComponentServer
    proxies = [p for p in server.ObjectProxies if p.Desc.Name == "Swalloop Template"]
    step("component registered: %s (of %d objects)" % (len(proxies) == 1, len(list(server.ObjectProxies))))
    assemblies = [a.Name for a in server.Libraries if "Swalloop" in a.Name]
    step("libraries: %s" % assemblies)
    if len(proxies) != 1:
        raise Exception("Swalloop Template component not found; is Swalloop.gha in the Libraries folder?")

    for name in TEMPLATES:
        doc = GH_Document()
        comp = proxies[0].CreateInstance()
        comp.CreateAttributes()
        doc.AddObject(comp, False)
        path = os.path.join(REPO, "templates", name + ".swalloop.json")
        comp.Params.Input[0].PersistentData.Append(GH_String(path))
        # A document without a canvas does not reliably schedule a solution for a component added from a
        # script, so drive the component directly: collect its inputs, then compute.
        comp.ClearData()
        comp.CollectData()
        comp.ComputeData()
        diag = {
            "input_persistent": comp.Params.Input[0].PersistentData.DataCount,
            "input_volatile": comp.Params.Input[0].VolatileData.DataCount,
            "solution_state": str(doc.SolutionState),
            "component_message": comp.Message,
            "all_messages": [
                "%s: %s" % (lvl, m)
                for lvl in (Grasshopper.Kernel.GH_RuntimeMessageLevel.Error,
                            Grasshopper.Kernel.GH_RuntimeMessageLevel.Warning,
                            Grasshopper.Kernel.GH_RuntimeMessageLevel.Remark)
                for m in comp.RuntimeMessages(lvl)
            ],
            "log": [str(d) for d in comp.Params.Output[3].VolatileData.AllData(True)],
        }
        result.setdefault("diagnostics", {})[name] = diag

        floors = comp.Params.Output[0].VolatileData.AllData(True)
        metrics = [d.Value for d in comp.Params.Output[1].VolatileData.AllData(True)]
        passes = [d.Value for d in comp.Params.Output[2].VolatileData.AllData(True)]
        gold = golden(name)
        g_metrics = [gold["metrics"]["outputs"][k] for k in ("gfa", "material", "moment", "util")]
        g_floors = len(gold["end"]["outputs"]["result"]["floors"])
        g_passes = gold["end"]["outputs"]["count"]

        worst = max(abs(a - b) / max(1.0, abs(b)) for a, b in zip(metrics, g_metrics)) if metrics else 1.0
        case = {
            "floors": len(list(floors)),
            "floors_expected": g_floors,
            "metrics": metrics,
            "metrics_expected": g_metrics,
            "worst_relative_difference": worst,
            "passes": passes[0] if passes else None,
            "passes_expected": g_passes,
            "messages": [str(m) for m in comp.RuntimeMessages(Grasshopper.Kernel.GH_RuntimeMessageLevel.Error)],
        }
        case["ok"] = (case["floors"] == g_floors and worst < 1e-9 and case["passes"] == g_passes and not case["messages"])
        result["cases"][name] = case
        step("%s: ok=%s floors=%d metrics worst diff=%.2e" % (name, case["ok"], case["floors"], worst))

    result["ok"] = all(c["ok"] for c in result["cases"].values())
except Exception:
    result["error"] = traceback.format_exc()
finally:
    save()
