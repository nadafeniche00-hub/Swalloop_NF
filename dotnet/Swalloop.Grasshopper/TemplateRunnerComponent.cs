using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Swalloop.Core;
using Swalloop.Core.Packs;

namespace Swalloop.GH
{
    /// <summary>
    /// Runs a whole Swalloop template (*.swalloop.json) inside one component: the same file the
    /// desktop editor opens, evaluated by the same engine (Swalloop.Core, checked against the
    /// JavaScript engine by golden files). Loops iterate internally, so a 150-pass tower is one solve.
    /// </summary>
    public class TemplateRunnerComponent : GH_Component
    {
        public TemplateRunnerComponent()
            : base("Swalloop Template", "SwalTemplate",
                "Runs a Swalloop template file (*.swalloop.json): the loops, the nodes and the wiring of the desktop editor, evaluated inside one component.",
                "Swalloop", "Templates")
        {
        }

        public override Guid ComponentGuid => new Guid("a8298212-0f96-4e6d-ab2b-439d1309a94d");
        protected override Bitmap Icon => Icons.Cycle(24);
        public override GH_Exposure Exposure => GH_Exposure.primary;

        protected override void RegisterInputParams(GH_InputParamManager pManager)
        {
            pManager.AddTextParameter("File", "F", "Path to a Swalloop template file (*.swalloop.json).", GH_ParamAccess.item);
            pManager.AddTextParameter("Overrides", "O",
                "Optional parameter changes, one per item, as node.param=value (for example stream.aspect=2.6 or end.iterations=60).",
                GH_ParamAccess.list);
            pManager[1].Optional = true;
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pManager)
        {
            pManager.AddCurveParameter("Floors", "C", "One closed outline per floor of the final tower (the Viewer node's tower).", GH_ParamAccess.list);
            pManager.AddNumberParameter("Metrics", "M", "Floor area, structure volume, base moment, max utilisation (the Metrics node).", GH_ParamAccess.list);
            pManager.AddIntegerParameter("Passes", "N", "How many passes the first loop ran before it stopped.", GH_ParamAccess.item);
            pManager.AddTextParameter("Log", "L", "Readouts, wire problems and node errors.", GH_ParamAccess.list);
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            string path = null;
            if (!DA.GetData(0, ref path) || string.IsNullOrWhiteSpace(path))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Give the path of a *.swalloop.json template.");
                return;
            }
            if (!File.Exists(path))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "File not found: " + path);
                return;
            }
            var overrides = new List<string>();
            DA.GetDataList(1, overrides);

            var log = new List<string>();
            var registry = Registry.CreateDefault();
            Graph graph;
            try
            {
                graph = GraphFile.Parse(File.ReadAllText(path), registry);
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
                return;
            }
            log.AddRange(graph.Problems);

            foreach (var line in overrides.Where(o => !string.IsNullOrWhiteSpace(o)))
            {
                var problem = ApplyOverride(graph, line.Trim());
                if (problem != null)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, problem);
                    log.Add(problem);
                }
            }

            var result = Engine.Evaluate(graph.Nodes, graph.Edges, registry);
            foreach (var n in graph.Nodes)
            {
                var r = result.Results[n.Id];
                if (r.Error != null) log.Add(n.Id + " (" + n.Type + "): " + r.Error);
                else if (n.Type == "readout" && r.Inputs != null && r.Inputs.TryGetValue("value", out var v))
                    log.Add(n.Id + " = " + Format(v));
            }

            // the tower that reaches the Viewer, or the result of the first loop for tower templates without one
            Tower tower = null;
            var viewer = graph.Nodes.FirstOrDefault(n => n.Type == "viewer");
            if (viewer != null && result.Results[viewer.Id].Inputs != null &&
                result.Results[viewer.Id].Inputs.TryGetValue("tower", out var tv)) tower = tv as Tower;
            if (tower == null)
            {
                var loop = graph.Nodes.FirstOrDefault(n => n.Type == "loopEnd");
                if (loop != null && result.Results[loop.Id].Outputs != null &&
                    result.Results[loop.Id].Outputs.TryGetValue("result", out var lr)) tower = lr as Tower;
            }

            var curves = new List<Curve>();
            if (tower != null)
            {
                foreach (var f in tower.Floors)
                {
                    var ring = TowerGeometry.RingPoints(f);
                    var pts = new List<Point3d>(ring.Length + 1);
                    foreach (var p in ring) pts.Add(new Point3d(p[0], p[1], f.Z));
                    pts.Add(pts[0]);
                    curves.Add(new PolylineCurve(pts));
                }
            }

            var metrics = new List<double>();
            var mNode = graph.Nodes.FirstOrDefault(n => n.Type == "metrics");
            if (mNode != null && result.Results[mNode.Id].Outputs != null)
            {
                var o = result.Results[mNode.Id].Outputs;
                foreach (var key in new[] { "gfa", "material", "moment", "util" })
                    if (o.TryGetValue(key, out var mv)) metrics.Add(V.Num(mv));
            }

            var passes = 0;
            var end = graph.Nodes.FirstOrDefault(n => n.Type == "loopEnd");
            if (end != null && result.Results[end.Id].Outputs != null &&
                result.Results[end.Id].Outputs.TryGetValue("count", out var c)) passes = (int)V.Num(c);

            DA.SetDataList(0, curves);
            DA.SetDataList(1, metrics);
            DA.SetData(2, passes);
            DA.SetDataList(3, log);
            Message = graph.Name;
        }

        // "node.param=value": numbers become numbers, everything else stays text (select parameters).
        private static string ApplyOverride(Graph graph, string line)
        {
            var eq = line.IndexOf('=');
            var dot = line.IndexOf('.');
            if (eq < 0 || dot < 0 || dot > eq) return "Override \"" + line + "\" is not node.param=value.";
            var nodeId = line.Substring(0, dot).Trim();
            var param = line.Substring(dot + 1, eq - dot - 1).Trim();
            var text = line.Substring(eq + 1).Trim();
            var node = graph.Nodes.FirstOrDefault(n => n.Id == nodeId);
            if (node == null) return "Override \"" + line + "\": no node \"" + nodeId + "\" in the template.";
            if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) node.Params[param] = d;
            else node.Params[param] = text;
            return null;
        }

        private static string Format(object v)
        {
            if (v is double d) return d.ToString("0.####", CultureInfo.InvariantCulture);
            return v?.ToString() ?? "null";
        }
    }
}
