using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Swalloop.Core;

namespace Swalloop.GH
{
    internal enum Kind { Number, Boolean, List, Text, Generic }

    /// <summary>
    /// One Grasshopper component for one engine node type. Ports, parameter names and defaults come
    /// from the catalog (generated from the editor's registry); the maths is the engine's own
    /// compute function, the same one the loops and the editor run. Numeric parameters are inputs
    /// with a default (wire a slider into them), select parameters are text inputs.
    /// </summary>
    public abstract class NodeComponent : GH_Component
    {
        public NodeMeta Meta { get; }

        protected NodeComponent(string id)
            : base(Catalog.For(id).Title, Catalog.For(id).Nick, Catalog.Describe(Catalog.For(id)), "Swalloop", Catalog.For(id).Category)
        {
            Meta = Catalog.For(id);
        }

        public override GH_Exposure Exposure { get { return Meta.Exposure; } }
        protected override Bitmap Icon { get { return Icons.ForCategory(Meta.Category); } }

        internal static Kind KindOf(string type)
        {
            switch (type)
            {
                case "number": return Kind.Number;
                case "boolean": return Kind.Boolean;
                case "list": return Kind.List;
                case "text": return Kind.Text;
                default: return Kind.Generic;
            }
        }

        // ---- ports ------------------------------------------------------------------------------

        protected override void RegisterInputParams(GH_InputParamManager pm)
        {
            // Called while the base constructor runs, so it reads the catalog through the class attribute.
            var m = Catalog.ForComponent(GetType());
            foreach (var p in m.Inputs)
            {
                int i;
                var desc = p.Label + (p.Optional ? " (optional)" : "");
                switch (KindOf(p.Type))
                {
                    case Kind.Number: i = pm.AddNumberParameter(p.Label, p.Id, desc, GH_ParamAccess.item); break;
                    case Kind.Boolean: i = pm.AddBooleanParameter(p.Label, p.Id, desc, GH_ParamAccess.item); break;
                    case Kind.List: i = pm.AddGenericParameter(p.Label, p.Id, desc, GH_ParamAccess.list); break;
                    case Kind.Text: i = pm.AddTextParameter(p.Label, p.Id, desc, GH_ParamAccess.item); break;
                    // list access, not item access: a list wired into an "any" input is one value (a list), not
                    // 60 solutions of the component. One item stays a single value, see ReadInput.
                    default: i = pm.AddGenericParameter(p.Label, p.Id, desc, GH_ParamAccess.list); break;
                }
                pm[i].Optional = p.Optional;
            }
            foreach (var q in m.Params)
            {
                int i;
                if (q.IsSelect)
                    i = pm.AddTextParameter(q.Label, q.Id, q.Label + ": " + string.Join(" / ", q.Options), GH_ParamAccess.item, (string)q.Default);
                else
                    i = pm.AddNumberParameter(q.Label, q.Id, q.Label + " (parameter; wire a slider to change it)", GH_ParamAccess.item, V.Num(q.Default));
                pm[i].Optional = true;
            }
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pm)
        {
            var m = Catalog.ForComponent(GetType());
            foreach (var p in m.Outputs)
            {
                switch (KindOf(p.Type))
                {
                    case Kind.Number: pm.AddNumberParameter(p.Label, p.Id, p.Label, GH_ParamAccess.item); break;
                    case Kind.Boolean: pm.AddBooleanParameter(p.Label, p.Id, p.Label, GH_ParamAccess.item); break;
                    case Kind.List: pm.AddGenericParameter(p.Label, p.Id, p.Label, GH_ParamAccess.list); break;
                    case Kind.Text: pm.AddTextParameter(p.Label, p.Id, p.Label, GH_ParamAccess.item); break;
                    default: pm.AddGenericParameter(p.Label, p.Id, p.Label, GH_ParamAccess.item); break;
                }
            }
        }

        // ---- solving ----------------------------------------------------------------------------

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            try
            {
                var inputs = new Dictionary<string, object>();
                var p = Catalog.Engine.DefaultParams(Meta.Id);
                for (var k = 0; k < Meta.Inputs.Length; k++)
                {
                    var port = Meta.Inputs[k];
                    if (ReadInput(DA, k, port.Type, out var v)) inputs[port.Id] = v;
                    else if (!port.Optional)
                    {
                        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Input \"" + port.Label + "\" has no data.");
                        return;
                    }
                }
                for (var j = 0; j < Meta.Params.Length; j++)
                {
                    var q = Meta.Params[j];
                    var k = Meta.Inputs.Length + j;
                    if (q.IsSelect)
                    {
                        string s = null;
                        if (DA.GetData(k, ref s) && s != null) p[q.Id] = s.Trim();
                    }
                    else
                    {
                        double d = 0;
                        if (DA.GetData(k, ref d)) p[q.Id] = d;
                    }
                }
                var outs = Catalog.Engine.NodeTypes[Meta.Id].Compute(inputs, p);
                Publish(DA, outs);
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
            }
        }

        private bool ReadInput(IGH_DataAccess DA, int k, string type, out object v)
        {
            v = null;
            switch (KindOf(type))
            {
                case Kind.Number:
                {
                    double d = 0;
                    if (!DA.GetData(k, ref d)) return false;
                    v = d;
                    return true;
                }
                case Kind.Boolean:
                {
                    bool b = false;
                    if (!DA.GetData(k, ref b)) return false;
                    v = b;
                    return true;
                }
                case Kind.Text:
                {
                    string s = null;
                    if (!DA.GetData(k, ref s)) return false;
                    v = s;
                    return true;
                }
                case Kind.List:
                {
                    var goos = new List<Grasshopper.Kernel.Types.IGH_Goo>();
                    if (!DA.GetDataList(k, goos) || goos.Count == 0) return false;
                    v = Interop.ListFromGoos(goos);
                    return true;
                }
                default:
                {
                    var goos = new List<Grasshopper.Kernel.Types.IGH_Goo>();
                    if (!DA.GetDataList(k, goos) || goos.Count == 0) return false;
                    v = Interop.ValueFromGoos(goos);
                    return v != null;
                }
            }
        }

        /// <summary>Writes the engine's outputs to the component's output parameters, by position.</summary>
        protected void Publish(IGH_DataAccess DA, IDictionary<string, object> outs)
        {
            for (var i = 0; i < Meta.Outputs.Length; i++)
            {
                var port = Meta.Outputs[i];
                if (outs == null || !outs.TryGetValue(port.Id, out var v) || v == null) continue;
                switch (KindOf(port.Type))
                {
                    case Kind.Number: DA.SetData(i, V.Num(v)); break;
                    case Kind.Boolean: DA.SetData(i, V.Truthy(v)); break;
                    case Kind.Text: DA.SetData(i, v as string ?? v.ToString()); break;
                    case Kind.List:
                        if (v is List<object> l) DA.SetDataList(i, l.Select(x => Interop.ToGoo(x)));
                        break;
                    default: DA.SetData(i, Interop.ToGoo(v)); break;
                }
            }
        }
    }
}
