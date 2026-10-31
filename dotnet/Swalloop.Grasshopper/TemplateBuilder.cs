using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Special;
using Grasshopper.Kernel.Types;
using Swalloop.Core;

namespace Swalloop.GH
{
    /// <summary>
    /// Turns a Swalloop template file into a real Grasshopper definition: one component per node, the
    /// same wires, the same parameter values, the same layout (scaled). Number nodes become native
    /// number sliders and readouts become panels, so the canvas feels like any other Grasshopper file.
    /// </summary>
    public static class TemplateBuilder
    {
        public sealed class Built
        {
            public GH_Document Document;
            public Graph Graph;
            /// <summary>Engine node id to the object that stands for it on the canvas.</summary>
            public Dictionary<string, IGH_DocumentObject> Objects = new Dictionary<string, IGH_DocumentObject>();
            public List<string> Problems = new List<string>();
        }

        private const float ScaleX = 0.8f;
        private const float ScaleY = 0.9f;

        public static Built Build(string path, bool nativeWidgets = true)
        {
            return BuildFromJson(File.ReadAllText(path), nativeWidgets);
        }

        public static Built BuildFromJson(string json, bool nativeWidgets = true)
        {
            var graph = GraphFile.Parse(json, Catalog.Engine);
            var doc = new GH_Document();
            var built = new Built { Document = doc, Graph = graph };
            built.Problems.AddRange(graph.Problems);

            foreach (var n in graph.Nodes)
            {
                IGH_DocumentObject obj;
                var at = new PointF((float)n.X * ScaleX, (float)n.Y * ScaleY);
                if (nativeWidgets && n.Type == "number") obj = Slider(n, at);
                else if (nativeWidgets && n.Type == "readout") obj = Panel("", at, new SizeF(110, 28));
                else
                {
                    var meta = Catalog.For(n.Type);
                    obj = Instances.ComponentServer.EmitObject(meta.Guid);
                    if (obj == null) throw new InvalidOperationException("Component for \"" + n.Type + "\" is not registered (is Swalloop.gha loaded?).");
                    obj.CreateAttributes();
                    obj.Attributes.Pivot = at;
                    if (obj is NodeComponent c) SetParams(c, n);
                }
                obj.NickName = n.Id;
                doc.AddObject(obj, false);
                built.Objects[n.Id] = obj;
            }

            foreach (var e in graph.Edges)
            {
                var source = OutputParam(built.Objects[e.Source], e.SourceHandle);
                var target = InputParam(built.Objects[e.Target], e.TargetHandle);
                if (source == null || target == null)
                {
                    built.Problems.Add("Wire " + e.Source + "." + e.SourceHandle + " -> " + e.Target + "." + e.TargetHandle + ": no such port on the canvas.");
                    continue;
                }
                target.AddSource(source);
            }

            if (graph.Name != "Untitled" || graph.Description.Length > 0)
            {
                var title = Panel(graph.Name + (graph.Description.Length > 0 ? "\n\n" + graph.Description : ""), new PointF(0, -230), new SizeF(560, 150));
                title.NickName = "about";
                doc.AddObject(title, false);
            }
            return built;
        }

        public static bool Save(Built built, string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
            return new GH_DocumentIO(built.Document).SaveQuiet(path);
        }

        // ---- objects ----------------------------------------------------------------------------

        private static GH_NumberSlider Slider(GNode n, PointF at)
        {
            var value = n.Params.Num("value");
            var min = n.Params.Num("min");
            var max = n.Params.Num("max");
            if (double.IsNaN(min)) min = 0;
            if (double.IsNaN(max) || max <= min) max = min + 10;
            if (value < min) min = value;
            if (value > max) max = value;
            var s = new GH_NumberSlider();
            s.CreateAttributes();
            s.Slider.Minimum = (decimal)min;
            s.Slider.Maximum = (decimal)max;
            s.Slider.DecimalPlaces = 3;
            s.SetSliderValue((decimal)value);
            s.Attributes.Pivot = at;
            return s;
        }

        private static GH_Panel Panel(string text, PointF at, SizeF size)
        {
            var p = new GH_Panel();
            p.CreateAttributes();
            p.UserText = text;
            p.Attributes.Pivot = at;
            p.Attributes.Bounds = new RectangleF(at, size);
            return p;
        }

        private static void SetParams(NodeComponent c, GNode n)
        {
            var meta = c.Meta;
            for (var j = 0; j < meta.Params.Length; j++)
            {
                var q = meta.Params[j];
                if (!n.Params.TryGetValue(q.Id, out var val) || val == null) continue;
                var input = c.Params.Input[meta.Inputs.Length + j];
                if (input is Param_String ps && val is string s)
                {
                    ps.PersistentData.Clear();
                    ps.PersistentData.Append(new GH_String(s));
                }
                else if (input is Param_Number pn && val is double d)
                {
                    pn.PersistentData.Clear();
                    pn.PersistentData.Append(new GH_Number(d));
                }
            }
        }

        private static IGH_Param OutputParam(IGH_DocumentObject obj, string port)
        {
            if (obj is NodeComponent c)
            {
                var i = c.Meta.OutputIndex(port);
                return i >= 0 && i < c.Params.Output.Count ? c.Params.Output[i] : null;
            }
            return obj as IGH_Param; // a slider: its one output is itself
        }

        private static IGH_Param InputParam(IGH_DocumentObject obj, string port)
        {
            if (obj is NodeComponent c)
            {
                var i = c.Meta.InputIndex(port);
                return i >= 0 && i < c.Params.Input.Count ? c.Params.Input[i] : null;
            }
            return obj as IGH_Param; // a panel
        }
    }
}
