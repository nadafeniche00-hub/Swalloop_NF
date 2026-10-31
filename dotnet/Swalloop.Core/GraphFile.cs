using System;
using System.Collections.Generic;
using System.Linq;

namespace Swalloop.Core
{
    /// <summary>A canvas read from a *.swalloop.json file. See docs/graph-format.md.</summary>
    public sealed class Graph
    {
        public string Name = "Untitled";
        public string Description = "";
        public string Group = "";
        public bool Featured;
        public List<GNode> Nodes = new List<GNode>();
        public List<GEdge> Edges = new List<GEdge>();
        /// <summary>Wires that were skipped (unknown node or port). Not fatal.</summary>
        public List<string> Problems = new List<string>();
    }

    /// <summary>Reads graph files. A port of src/core/graphFile.js, with the same rules and messages.</summary>
    public static class GraphFile
    {
        public const string Format = "swalloop-graph";
        public const int Version = 1;

        public static Graph Parse(string json, Registry registry)
        {
            var root = MiniJson.Parse(json) as Dictionary<string, object>;
            if (root == null || !(root.TryGetValue("format", out var f) && (f as string) == Format))
                throw new FormatException("Not a Swalloop graph file (expected format \"" + Format + "\").");
            if (!(root.TryGetValue("version", out var ver) && ver is double dv) || dv > Version)
                throw new FormatException("This file is version " + (ver ?? "unknown") + "; this reader understands up to version " + Version + ".");
            if (!(root.GetValueOrNull("nodes") is List<object> rawNodes) || !(root.GetValueOrNull("edges") is List<object> rawEdges))
                throw new FormatException("The file needs \"nodes\" and \"edges\" lists.");

            var nodeDicts = rawNodes.Select(n => n as Dictionary<string, object> ?? new Dictionary<string, object>()).ToList();

            var unknown = nodeDicts.Select(n => n.GetValueOrNull("type") as string)
                .Where(t => t == null || !registry.NodeTypes.ContainsKey(t))
                .Distinct().ToList();
            if (unknown.Count > 0)
                throw new FormatException("Unknown node type" + (unknown.Count > 1 ? "s" : "") + ": " +
                                          string.Join(", ", unknown.Select(u => u ?? "(none)")) + ". A pack may be missing.");

            var ids = new HashSet<string>();
            foreach (var n in nodeDicts)
            {
                var id = n.GetValueOrNull("id") as string;
                if (string.IsNullOrEmpty(id)) throw new FormatException("Every node needs a string \"id\".");
                if (!ids.Add(id)) throw new FormatException("Duplicate node id \"" + id + "\".");
            }

            var g = new Graph
            {
                Name = root.GetValueOrNull("name") as string ?? "Untitled",
                Description = root.GetValueOrNull("description") as string ?? "",
                Group = root.GetValueOrNull("group") as string ?? "",
                Featured = root.GetValueOrNull("featured") is bool b && b,
            };

            foreach (var n in nodeDicts)
            {
                var type = (string)n["type"];
                // defaults first, so a file written before a parameter existed still loads
                var p = registry.DefaultParams(type);
                if (n.GetValueOrNull("params") is Dictionary<string, object> given)
                    foreach (var kv in given) p[kv.Key] = kv.Value;
                var node = new GNode { Id = (string)n["id"], Type = type, Params = p };
                if (n.GetValueOrNull("position") is Dictionary<string, object> pos)
                {
                    node.X = V.Num(pos.GetValueOrNull("x"));
                    node.Y = V.Num(pos.GetValueOrNull("y"));
                }
                g.Nodes.Add(node);
            }

            var byId = g.Nodes.ToDictionary(n => n.Id);
            foreach (var raw in rawEdges)
            {
                var e = raw as Dictionary<string, object> ?? new Dictionary<string, object>();
                var from = e.GetValueOrNull("from") as string ?? "";
                var to = e.GetValueOrNull("to") as string ?? "";
                SplitRef(from, out var source, out var sourceHandle);
                SplitRef(to, out var target, out var targetHandle);
                if (!byId.TryGetValue(source, out var s) || !byId.TryGetValue(target, out var t))
                {
                    g.Problems.Add("Wire " + from + " -> " + to + ": unknown node.");
                    continue;
                }
                var sd = registry.NodeTypes[s.Type];
                var td = registry.NodeTypes[t.Type];
                if (!sd.Outputs.Any(o => o.Id == sourceHandle))
                {
                    g.Problems.Add("Wire " + from + " -> " + to + ": \"" + source + "\" has no output \"" + sourceHandle + "\".");
                    continue;
                }
                var takes = td.Inputs.Any(x => x.Id == targetHandle) || td.Params.Any(x => x.Id == targetHandle && !x.IsSelect);
                if (!takes)
                {
                    g.Problems.Add("Wire " + from + " -> " + to + ": \"" + target + "\" has no input \"" + targetHandle + "\".");
                    continue;
                }
                g.Edges.Add(new GEdge { Source = source, SourceHandle = sourceHandle, Target = target, TargetHandle = targetHandle });
            }
            return g;
        }

        private static void SplitRef(string r, out string node, out string port)
        {
            var i = r.LastIndexOf('.');
            if (i < 0) { node = r; port = ""; }
            else { node = r.Substring(0, i); port = r.Substring(i + 1); }
        }

        private static object GetValueOrNull(this Dictionary<string, object> d, string key)
        {
            return d.TryGetValue(key, out var v) ? v : null;
        }
    }
}
