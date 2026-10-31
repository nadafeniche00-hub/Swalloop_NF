using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Swalloop.Core;
using Swalloop.Core.Packs;

namespace Swalloop.GH
{
    /// <summary>
    /// Inspector: shows whatever flows in. Numbers, text and number lists come out as Grasshopper's own
    /// data; anything with a shape (a tower, a context, outlines, a splat field) also comes out as
    /// Rhino geometry. The component's message names what it received.
    /// </summary>
    [NodeType("inspect")]
    public sealed class InspectComponent : NodeComponent
    {
        public InspectComponent() : base("inspect") { }
        public override Guid ComponentGuid { get { return Catalog.For("inspect").Guid; } }

        protected override void RegisterInputParams(GH_InputParamManager pm)
        {
            pm.AddGenericParameter("Value", "value", "Anything from a Swalloop component.", GH_ParamAccess.list);
            var h = pm.AddGenericParameter("History", "history", "A loop's history (not drawn here).", GH_ParamAccess.item);
            pm[h].Optional = true;
            var dz = pm.AddNumberParameter("Spacing", "dz", "Height between outlines when a list of outlines is shown as stacked floors (m).", GH_ParamAccess.item, 4.0);
            pm[dz].Optional = true;
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pm)
        {
            pm.AddGenericParameter("Value", "value", "The value in Grasshopper's own types where there are any.", GH_ParamAccess.list);
            pm.AddGeometryParameter("Geometry", "geometry", "Curves or meshes for anything that has a shape.", GH_ParamAccess.list);
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            try
            {
                var items = new List<IGH_Goo>();
                if (!DA.GetDataList(0, items) || items.Count == 0) return;
                var v = Interop.ValueFromGoos(items);
                if (v == null) return;
                double dz = 4;
                DA.GetData(2, ref dz);

                var values = new List<IGH_Goo>();
                if (Interop.IsNumberList(v)) values.AddRange(((List<object>)v).Select(x => (IGH_Goo)new GH_Number((double)x)));
                else values.Add(Interop.ToGoo(v));
                DA.SetDataList(0, values);

                var geo = Geo.Of(v, dz).Select(x => x is Curve c ? (IGH_Goo)new GH_Curve(c) : new GH_Mesh((Mesh)x)).ToList();
                DA.SetDataList(1, geo);
                Message = Interop.TypeName(v);
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
            }
        }
    }

    /// <summary>Readout: shows a number on the component itself.</summary>
    [NodeType("readout")]
    public sealed class ReadoutComponent : NodeComponent
    {
        public ReadoutComponent() : base("readout") { }
        public override Guid ComponentGuid { get { return Catalog.For("readout").Guid; } }

        protected override void RegisterOutputParams(GH_OutputParamManager pm) { }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            double d = 0;
            if (DA.GetData(0, ref d)) Message = d.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);
        }
    }

    /// <summary>
    /// Viewer: the tower as a vertex-coloured mesh (colour by a per-floor quantity), its floor outlines,
    /// and the context as boxes.
    /// </summary>
    [NodeType("viewer")]
    public sealed class ViewerComponent : NodeComponent
    {
        private System.Collections.Generic.List<Mesh> _context = new System.Collections.Generic.List<Mesh>();
        private static readonly Rhino.Display.DisplayMaterial Grey =
            new Rhino.Display.DisplayMaterial(System.Drawing.Color.FromArgb(165, 170, 176), 0.72);

        public ViewerComponent() : base("viewer")
        {
            // The context is drawn by the component itself in neutral grey, so the tower's colours read.
            // The raw mesh output stays available for baking, it just does not preview on its own.
            if (Params.Output.Count > 2 && Params.Output[2] is IGH_PreviewObject po) po.Hidden = true;
        }

        public override Guid ComponentGuid { get { return Catalog.For("viewer").Guid; } }

        public override BoundingBox ClippingBox
        {
            get
            {
                var box = base.ClippingBox;
                foreach (var m in _context) box.Union(m.GetBoundingBox(false));
                return box;
            }
        }

        public override void DrawViewportMeshes(IGH_PreviewArgs args)
        {
            base.DrawViewportMeshes(args);
            foreach (var m in _context) args.Display.DrawMeshShaded(m, Grey);
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pm)
        {
            pm.AddMeshParameter("Tower", "tower", "The tower as a coloured mesh.", GH_ParamAccess.item);
            pm.AddCurveParameter("Floors", "floors", "One closed outline per floor.", GH_ParamAccess.list);
            pm.AddMeshParameter("Context", "context", "The neighbouring buildings as boxes.", GH_ParamAccess.list);
        }

        private static double Value(string metric, Floor f)
        {
            switch (metric)
            {
                case "Height": return f.Z;
                case "Wind load": return f.WindF;
                case "Wind exposure": return f.Wind;
                case "Sun exposure": return f.Sun;
                case "Plate area": return TowerGeometry.PlateArea(f);
                case "Rotation": return f.Rot * 180 / Math.PI;
                case "Roundness": return f.Round;
                case "Aspect": return Math.Max(f.W, f.D) / Math.Min(f.W, f.D);
                case "None": return 0;
                default: return f.Util; // Utilisation, and the facade metrics, which need a facade not a floor
            }
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            try
            {
                var towers = new List<IGH_Goo>();
                if (!DA.GetDataList(0, towers) || !(Interop.ValueFromGoos(towers) is Tower tower)) return;

                string color = "Utilisation", range = "Auto", reverse = "No";
                double min = 0, max = 1;
                var k = Meta.Inputs.Length; // parameters follow the three inputs: color, cmap, range, min, max, reverse
                DA.GetData(k, ref color);
                DA.GetData(k + 2, ref range);
                DA.GetData(k + 3, ref min);
                DA.GetData(k + 4, ref max);
                DA.GetData(k + 5, ref reverse);

                var values = tower.Floors.Select(f => Value(color.Trim(), f)).ToArray();
                double lo = values.Length > 0 ? values.Min() : 0, hi = values.Length > 0 ? values.Max() : 1;
                if (range.Trim() == "Manual") { lo = min; hi = max; }

                DA.SetData(0, Geo.LoftMesh(tower, values, lo, hi, reverse.Trim() == "Yes"));
                DA.SetDataList(1, Geo.FloorCurves(tower));
                var contexts = new List<IGH_Goo>();
                _context = new List<Mesh>();
                if (DA.GetDataList(1, contexts) && Interop.ValueFromGoos(contexts) is Context ctx)
                {
                    _context = Geo.ContextBoxes(ctx);
                    DA.SetDataList(2, _context);
                }
                Message = color.Trim() + " " + lo.ToString("0.##") + " to " + hi.ToString("0.##");
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
            }
        }
    }
}
