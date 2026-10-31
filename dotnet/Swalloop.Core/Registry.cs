using System;
using System.Collections.Generic;

namespace Swalloop.Core
{
    /// <summary>An input or output port of a node type.</summary>
    public sealed class Port
    {
        public string Id;
        public string Label;
        public bool Optional;

        public Port(string id, string label = null, bool optional = false)
        {
            Id = id;
            Label = label ?? id;
            Optional = optional;
        }
    }

    /// <summary>
    /// A parameter. Numeric parameters double as inputs (a wire overrides the widget);
    /// select parameters take a fixed list of strings and no wire.
    /// </summary>
    public sealed class ParamDef
    {
        public string Id;
        public object Default;
        public string[] Options; // null for a number

        public bool IsSelect { get { return Options != null; } }

        public static ParamDef Num(string id, double def) { return new ParamDef { Id = id, Default = def }; }

        public static ParamDef Select(string id, string def, params string[] options)
        {
            return new ParamDef { Id = id, Default = def, Options = options };
        }
    }

    public delegate Dictionary<string, object> ComputeFn(Dictionary<string, object> inputs, Params p);

    /// <summary>One kind of node: its ports, parameters and a pure compute function.</summary>
    public sealed class NodeType
    {
        public string Id;
        public string Pack; // null for core
        public Port[] Inputs = new Port[0];
        public Port[] Outputs = new Port[0];
        public ParamDef[] Params = new ParamDef[0];
        public ComputeFn Compute = (i, p) => new Dictionary<string, object>();
    }

    public sealed class DataType
    {
        public string Name;
        public Func<object, bool> Is;
        public Func<object, object, double> Distance;
    }

    /// <summary>Which node types and data types exist. Mirrors src/core/registry.js.</summary>
    public sealed class Registry
    {
        public readonly Dictionary<string, NodeType> NodeTypes = new Dictionary<string, NodeType>();
        public readonly List<DataType> DataTypes = new List<DataType>();

        public void Register(string pack, IEnumerable<NodeType> types)
        {
            foreach (var t in types)
            {
                if (NodeTypes.ContainsKey(t.Id)) throw new InvalidOperationException("Node type \"" + t.Id + "\" already exists");
                t.Pack = pack;
                NodeTypes[t.Id] = t;
            }
        }

        public Params DefaultParams(string type)
        {
            var p = new Params();
            foreach (var d in NodeTypes[type].Params) p[d.Id] = d.Default;
            return p;
        }

        /// <summary>
        /// How much a loop state changed. A data type from a pack may supply its own distance;
        /// numbers, lists and records are compared recursively; anything else is "different".
        /// </summary>
        public double Distance(object a, object b)
        {
            foreach (var t in DataTypes)
                if (t.Is(a) && t.Is(b)) return t.Distance(a, b);
            if (a is double x && b is double y) return Math.Abs(x - y);
            if (ReferenceEquals(a, b)) return 0;
            if (a is bool ba && b is bool bb) return ba == bb ? 0 : double.PositiveInfinity;
            if (a is string sa && b is string sb) return sa == sb ? 0 : double.PositiveInfinity;
            if (a is List<object> la && b is List<object> lb)
            {
                if (la.Count != lb.Count) return double.PositiveInfinity;
                double m = 0;
                for (var i = 0; i < la.Count; i++) m = Math.Max(m, Distance(la[i], lb[i]));
                return m;
            }
            if (a is Dictionary<string, object> da && b is Dictionary<string, object> db)
            {
                double m = 0;
                var keys = new HashSet<string>(da.Keys);
                keys.UnionWith(db.Keys);
                foreach (var k in keys)
                {
                    da.TryGetValue(k, out var va);
                    db.TryGetValue(k, out var vb);
                    m = Math.Max(m, Distance(va, vb));
                }
                return m;
            }
            return double.PositiveInfinity;
        }

        /// <summary>The registry with the core nodes and both packs, as the editor registers them.</summary>
        public static Registry CreateDefault()
        {
            var r = new Registry();
            r.Register(null, CoreNodes.All());
            r.Register("skyscraper", Packs.SkyscraperNodes.All());
            r.DataTypes.Add(Packs.SkyscraperNodes.TowerDataType());
            r.Register("math", Packs.MathNodes.All());
            r.Register("analysis", Packs.AnalysisNodes.All());
            return r;
        }
    }
}
