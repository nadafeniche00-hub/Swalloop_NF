using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Swalloop.Core;

namespace Swalloop.GH
{
    /// <summary>
    /// Rebuilds the part of a Grasshopper definition that feeds a component as an engine graph.
    ///
    /// Swalloop components upstream become engine nodes, joined by the same wires. Anything else
    /// (a slider, a panel, a native component) becomes a constant holding the value it solved to.
    /// A Loop End hands the result to the engine, which pairs it with its Loop Start and iterates the
    /// body internally: Grasshopper's canvas stays a plain graph with no feedback wire, and the
    /// components between Start and End show a single pass.
    /// </summary>
    public static class GraphExtractor
    {
        public static Graph Extract(NodeComponent end, out string endId)
        {
            var graph = new Graph { Name = end.NickName };
            var ids = new Dictionary<NodeComponent, string>();
            var constants = 0;

            string Visit(NodeComponent c)
            {
                if (ids.TryGetValue(c, out var known)) return known;
                var id = "n" + ids.Count;
                ids[c] = id;
                var meta = c.Meta;
                var node = new GNode { Id = id, Type = meta.Id, Params = Catalog.Engine.DefaultParams(meta.Id) };
                graph.Nodes.Add(node);

                for (var k = 0; k < meta.InputCount; k++)
                {
                    var param = c.Params.Input[k];
                    var portId = meta.InputId(k);
                    var isParam = k >= meta.Inputs.Length;
                    var def = isParam ? meta.Params[k - meta.Inputs.Length] : null;
                    var portType = isParam ? "number" : meta.Inputs[k].Type;

                    if (param.SourceCount == 0)
                    {
                        // not wired: a parameter keeps the value it holds (its default, or what the user typed)
                        if (isParam) SetParam(node, def, FirstValue(param));
                        continue;
                    }

                    // the Swalloop output wired in, if any
                    var sources = param.Sources;
                    var swalloop = sources
                        .Select(s => new { s, owner = OwnerOf(s) as NodeComponent })
                        .FirstOrDefault(x => x.owner != null);

                    if (swalloop != null && !(isParam && def.IsSelect))
                    {
                        var srcId = Visit(swalloop.owner);
                        var outIndex = swalloop.owner.Params.Output.IndexOf(swalloop.s);
                        if (outIndex >= 0 && outIndex < swalloop.owner.Meta.Outputs.Length)
                        {
                            graph.Edges.Add(new GEdge
                            {
                                Source = srcId,
                                SourceHandle = swalloop.owner.Meta.Outputs[outIndex].Id,
                                Target = id,
                                TargetHandle = portId,
                            });
                            continue;
                        }
                    }

                    // external data: take what the sources solved to
                    var kind = NodeComponent.KindOf(portType);
                    var value = kind == Kind.List ? (object)AllValues(sources)
                        : kind == Kind.Generic && !isParam ? WholeValue(sources)
                        : FirstValue(sources);
                    if (isParam)
                    {
                        SetParam(node, def, value);
                    }
                    else
                    {
                        var cid = "k" + constants++;
                        var cp = Catalog.Engine.DefaultParams("const");
                        cp["value"] = value;
                        graph.Nodes.Add(new GNode { Id = cid, Type = "const", Params = cp });
                        graph.Edges.Add(new GEdge { Source = cid, SourceHandle = "value", Target = id, TargetHandle = portId });
                    }
                }
                return id;
            }

            endId = Visit(end);
            return graph;
        }

        private static void SetParam(GNode node, ParamMeta def, object value)
        {
            if (value == null) return;
            if (def.IsSelect)
            {
                if (value is string s && s.Trim().Length > 0) node.Params[def.Id] = s.Trim();
            }
            else if (value is double d) node.Params[def.Id] = d;
            else if (value is bool b) node.Params[def.Id] = b ? 1.0 : 0.0;
        }

        private static IGH_DocumentObject OwnerOf(IGH_Param p)
        {
            return p.Attributes?.GetTopLevel?.DocObject;
        }

        private static IEnumerable<IGH_Goo> Items(IGH_Param p)
        {
            foreach (var o in p.VolatileData.AllData(true))
                if (o is IGH_Goo g) yield return g;
        }

        private static object FirstValue(IGH_Param p)
        {
            foreach (var g in Items(p)) return Interop.FromGoo(g);
            return null;
        }

        private static object FirstValue(IEnumerable<IGH_Param> sources)
        {
            foreach (var s in sources)
            {
                var v = FirstValue(s);
                if (v != null) return v;
            }
            return null;
        }

        // what a generic input receives: one item is a single value, several are the list of them
        private static object WholeValue(IEnumerable<IGH_Param> sources)
        {
            var goos = new List<IGH_Goo>();
            foreach (var s in sources) goos.AddRange(Items(s));
            return Interop.ValueFromGoos(goos);
        }

        // every item from every source, flattened: a list-typed input
        private static List<object> AllValues(IEnumerable<IGH_Param> sources)
        {
            var goos = new List<IGH_Goo>();
            foreach (var s in sources) goos.AddRange(Items(s));
            return Interop.ListFromGoos(goos);
        }
    }
}
