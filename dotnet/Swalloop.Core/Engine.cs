using System;
using System.Collections.Generic;
using System.Linq;

namespace Swalloop.Core
{
    public sealed class GNode
    {
        public string Id;
        public string Type;
        public double X, Y; // editor layout only
        public Params Params;
    }

    public sealed class GEdge
    {
        public string Source, SourceHandle, Target, TargetHandle;
    }

    /// <summary>What one node produced, or why it could not.</summary>
    public sealed class NodeResult
    {
        public string Error;
        public Dictionary<string, object> Outputs;
        public Dictionary<string, object> Inputs;
        public Params Params;
    }

    public sealed class EvalResult
    {
        public Dictionary<string, NodeResult> Results = new Dictionary<string, NodeResult>();
        /// <summary>Loop End id -> the Loop Start it is paired with.</summary>
        public Dictionary<string, string> Pairs = new Dictionary<string, string>();
    }

    /// <summary>
    /// Evaluation engine. A line-by-line port of src/core/engine.js: the canvas is a DAG, and
    /// Loop Start / Loop End are the deliberate loophole. Loop End re-evaluates everything
    /// between itself and its paired Loop Start, and the value arriving at Loop End becomes the
    /// next output of Loop Start. The wire back is never drawn; the feedback goes through memory.
    /// </summary>
    public static class Engine
    {
        public const int MaxIterations = 5000;
        public const int MaxFrames = 200;

        private sealed class Scope
        {
            public string Start; // the Loop Start this scope belongs to (null at the root)
            public Dictionary<string, object> StartOut;
            public Dictionary<string, NodeResult> Memo = new Dictionary<string, NodeResult>();
            public Scope Parent;
        }

        /// <summary>Would a wire source -> target close a cycle?</summary>
        public static bool WouldCycle(IReadOnlyList<GEdge> edges, string source, string target)
        {
            if (source == target) return true;
            var incoming = new Dictionary<string, List<string>>();
            foreach (var e in edges)
            {
                if (!incoming.TryGetValue(e.Target, out var l)) incoming[e.Target] = l = new List<string>();
                l.Add(e.Source);
            }
            var seen = new HashSet<string>();
            var stack = new Stack<string>();
            stack.Push(source);
            while (stack.Count > 0)
            {
                var id = stack.Pop();
                if (id == target) return true;
                if (!seen.Add(id)) continue;
                if (incoming.TryGetValue(id, out var srcs)) foreach (var s in srcs) stack.Push(s);
            }
            return false;
        }

        /// <summary>Pair every Loop End with the nearest unclaimed Loop Start upstream, inner loops first.</summary>
        public static Dictionary<string, string> PairLoops(IReadOnlyList<GNode> nodes, IReadOnlyList<GEdge> edges)
        {
            var byId = nodes.ToDictionary(n => n.Id);
            var sources = new Dictionary<string, List<string>>();
            foreach (var e in edges)
            {
                if (!byId.ContainsKey(e.Source) || !byId.ContainsKey(e.Target)) continue;
                if (!sources.TryGetValue(e.Target, out var l)) sources[e.Target] = l = new List<string>();
                l.Add(e.Source);
            }

            // breadth-first, remembering the order nodes were reached (a JavaScript Map keeps insertion order)
            List<KeyValuePair<string, int>> Ancestors(string id)
            {
                var order = new List<KeyValuePair<string, int>> { new KeyValuePair<string, int>(id, 0) };
                var dist = new Dictionary<string, int> { { id, 0 } };
                var queue = new Queue<string>();
                queue.Enqueue(id);
                while (queue.Count > 0)
                {
                    var cur = queue.Dequeue();
                    if (!sources.TryGetValue(cur, out var srcs)) continue;
                    foreach (var s in srcs)
                    {
                        if (dist.ContainsKey(s)) continue;
                        dist[s] = dist[cur] + 1;
                        order.Add(new KeyValuePair<string, int>(s, dist[s]));
                        queue.Enqueue(s);
                    }
                }
                return order;
            }

            var pairs = new Dictionary<string, string>();
            var claimed = new HashSet<string>();
            var ends = nodes.Where(n => n.Type == "loopEnd")
                .Select(n => new { Node = n, Anc = Ancestors(n.Id) })
                .OrderBy(x => x.Anc.Count) // stable, like Array.prototype.sort
                .ToList();
            foreach (var x in ends)
            {
                var candidates = x.Anc
                    .Where(kv => byId[kv.Key].Type == "loopStart" && !claimed.Contains(kv.Key))
                    .OrderBy(kv => kv.Value)
                    .ToList();
                if (candidates.Count > 0)
                {
                    pairs[x.Node.Id] = candidates[0].Key;
                    claimed.Add(candidates[0].Key);
                }
            }
            return pairs;
        }

        private static List<object> Thin(List<object> frames)
        {
            if (frames.Count <= MaxFrames) return frames;
            var stride = (frames.Count - 1) / (double)(MaxFrames - 1);
            var thinned = new List<object>(MaxFrames);
            for (var i = 0; i < MaxFrames; i++) thinned.Add(frames[(int)V.JsRound(i * stride)]);
            return thinned;
        }

        public static EvalResult Evaluate(IReadOnlyList<GNode> nodes, IReadOnlyList<GEdge> edges, Registry registry)
        {
            var byId = nodes.ToDictionary(n => n.Id);
            // nodeId -> (targetHandle -> edge); a later wire to the same handle replaces the earlier one
            var incoming = new Dictionary<string, Dictionary<string, GEdge>>();
            foreach (var e in edges)
            {
                if (!byId.ContainsKey(e.Source) || !byId.ContainsKey(e.Target)) continue;
                if (!incoming.TryGetValue(e.Target, out var m)) incoming[e.Target] = m = new Dictionary<string, GEdge>();
                m[e.TargetHandle] = e;
            }
            Dictionary<string, GEdge> Wires(string id)
            {
                return incoming.TryGetValue(id, out var m) ? m : new Dictionary<string, GEdge>();
            }

            var depMemo = new Dictionary<string, bool>();
            bool DependsOn(string id, string startId)
            {
                if (id == startId) return true;
                var key = id + "|" + startId;
                if (depMemo.TryGetValue(key, out var hit)) return hit;
                depMemo[key] = false; // guards against cycles in malformed input
                var r = false;
                foreach (var e in Wires(id).Values)
                    if (DependsOn(e.Source, startId)) { r = true; break; }
                depMemo[key] = r;
                return r;
            }

            var pairs = PairLoops(nodes, edges);
            var root = new Scope();

            NodeResult EvalNode(string id, Scope ctx)
            {
                // the owning scope is the innermost loop whose Start this node depends on
                var scope = ctx;
                while (scope.Start != null && !DependsOn(id, scope.Start) && scope.Parent != null) scope = scope.Parent;

                if (scope.Memo.TryGetValue(id, out var memo)) return memo;
                if (scope.Start == id) return new NodeResult { Outputs = scope.StartOut, Inputs = new Dictionary<string, object>() };

                var node = byId[id];
                var def = registry.NodeTypes[node.Type];
                NodeResult result;
                try
                {
                    if (node.Type == "loopEnd") result = RunLoop(node, scope);
                    else
                    {
                        var g = Gather(node, scope, null);
                        result = g.Error != null
                            ? new NodeResult { Error = g.Error }
                            : new NodeResult { Outputs = def.Compute(g.Inputs, g.Params), Inputs = g.Inputs, Params = g.Params };
                    }
                }
                catch (Exception ex)
                {
                    result = new NodeResult { Error = ex.Message };
                }
                scope.Memo[id] = result;
                return result;
            }

            (string Error, Dictionary<string, object> Inputs, Params Params) Gather(GNode node, Scope scope, string[] skip)
            {
                var def = registry.NodeTypes[node.Type];
                var wires = Wires(node.Id);
                var inputs = new Dictionary<string, object>();
                var p = node.Params.Clone();
                foreach (var port in def.Inputs)
                {
                    if (skip != null && Array.IndexOf(skip, port.Id) >= 0) continue;
                    if (!wires.TryGetValue(port.Id, out var e))
                    {
                        if (!port.Optional) return ("Missing input \"" + port.Label + "\"", null, null);
                        continue;
                    }
                    var r = EvalNode(e.Source, scope);
                    if (r.Error != null) return ("Upstream error", null, null);
                    r.Outputs.TryGetValue(e.SourceHandle, out var v);
                    inputs[port.Id] = v;
                }
                foreach (var pd in def.Params)
                {
                    if (!wires.TryGetValue(pd.Id, out var e) || pd.IsSelect) continue;
                    var r = EvalNode(e.Source, scope);
                    if (r.Error != null) return ("Upstream error", null, null);
                    r.Outputs.TryGetValue(e.SourceHandle, out var v);
                    p[pd.Id] = v;
                }
                return (null, inputs, p);
            }

            // Loop kinds: Repeat, While, Fold, For each. The optional Condition is evaluated inside
            // the loop body's scope at the start of each iteration, so it sees the current state.
            NodeResult RunLoop(GNode node, Scope scope)
            {
                if (!pairs.TryGetValue(node.Id, out var startId)) return new NodeResult { Error = "No Loop Start upstream" };
                var g = Gather(node, scope, new[] { "result", "condition", "items" });
                if (g.Error != null) return new NodeResult { Error = g.Error };
                var wires = Wires(node.Id);
                if (!wires.TryGetValue("result", out var resultWire)) return new NodeResult { Error = "Missing input \"Result\"" };
                wires.TryGetValue("condition", out var condWire);
                var kind = g.Params.Str("kind") ?? "Repeat";
                var perItem = kind == "Fold" || kind == "For each";
                var mapping = kind == "For each";

                List<object> items = null;
                if (perItem)
                {
                    if (!wires.TryGetValue("items", out var itemsWire))
                        return new NodeResult { Error = "\"" + kind + "\" needs a list on Items" };
                    var r = EvalNode(itemsWire.Source, scope);
                    if (r.Error != null) return new NodeResult { Error = "Upstream error" };
                    r.Outputs.TryGetValue(itemsWire.SourceHandle, out var raw);
                    items = raw as List<object>;
                    if (items == null) return new NodeResult { Error = "Items must be a list" };
                }
                if (!mapping && !(Wires(startId).ContainsKey("initial")))
                    return new NodeResult { Error = "Loop Start needs an Initial value" };

                object state = null;
                if (!mapping)
                {
                    var init = EvalNode(startId, scope);
                    if (init.Error != null) return new NodeResult { Error = "Upstream error" };
                    init.Outputs.TryGetValue("state", out state);
                }

                double limit = perItem
                    ? Math.Min(items.Count, MaxIterations)
                    : Math.Min(MaxIterations, Math.Max(0, Math.Floor(g.Params.Num("iterations"))));
                var tol = perItem ? 0 : g.Params.Num("tolerance");
                var results = new List<object>();
                var stride = limit > 0 ? Math.Max(1, (int)Math.Ceiling(limit / MaxFrames)) : 1; // NaN: the loop never runs
                var history = new List<object> { mapping ? (object)new List<object>() : state };
                var delta = double.PositiveInfinity;
                var done = 0;

                for (var i = 0; i < limit; i++)
                {
                    var child = new Scope
                    {
                        Start = startId,
                        StartOut = new Dictionary<string, object>
                        {
                            { "state", state },
                            { "index", (double)i },
                            { "item", items != null ? items[i] : null },
                        },
                        Parent = scope,
                    };
                    if (condWire != null)
                    {
                        var c = EvalNode(condWire.Source, child);
                        if (c.Error != null) return new NodeResult { Error = "Error in the condition" };
                        c.Outputs.TryGetValue(condWire.SourceHandle, out var raw);
                        var flag = V.Truthy(raw);
                        if (kind == "While" ? !flag : flag) break;
                    }
                    var r = EvalNode(resultWire.Source, child);
                    if (r.Error != null) return new NodeResult { Error = "Error inside the loop body" };
                    r.Outputs.TryGetValue(resultWire.SourceHandle, out var next);
                    done++;
                    if (mapping)
                    {
                        results.Add(next);
                        if (done % stride == 0 || i == limit - 1) history.Add(new List<object>(results));
                        continue;
                    }
                    delta = registry.Distance(state, next);
                    state = next;
                    history.Add(state);
                    if (tol > 0 && delta <= tol) break;
                }

                return new NodeResult
                {
                    Outputs = new Dictionary<string, object>
                    {
                        { "result", mapping ? (object)results : state },
                        {
                            "history", new Dictionary<string, object>
                            {
                                { "frames", Thin(history) },
                                { "count", (double)done },
                                { "max", limit },
                            }
                        },
                        { "count", (double)done },
                        { "delta", double.IsInfinity(delta) || double.IsNaN(delta) ? 0.0 : delta },
                    },
                    Inputs = g.Inputs,
                };
            }

            var res = new EvalResult { Pairs = pairs };
            foreach (var n in nodes) res.Results[n.Id] = EvalNode(n.Id, root);
            return res;
        }
    }
}
