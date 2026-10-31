using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Swalloop.Core.Packs;

namespace Swalloop.Core.Tests
{
    // Runs the C# port against the JavaScript engine's own results ("golden" files written by
    // scripts/dump-golden.mjs) for every template in /templates, plus the file-format rules.
    //   dotnet run --project dotnet/Swalloop.Core.Tests
    public static class Program
    {
        private static int _failed, _passed;

        // Numbers must agree to this relative / absolute tolerance. JavaScript and .NET use different
        // implementations of sin, cos, pow and tan, so agreement to the last bit is not expected.
        private const double RelTol = 1e-9;
        private const double AbsTol = 1e-9;

        public static int Main(string[] args)
        {
            var root = FindRoot();
            Console.WriteLine("repo: " + root);
            var registry = Registry.CreateDefault();

            Section("golden: the C# engine reproduces the JavaScript engine on every template");
            var files = Directory.GetFiles(Path.Combine(root, "templates"), "*.swalloop.json").OrderBy(f => f).ToList();
            Check("template files found", files.Count >= 10, files.Count + " files");
            foreach (var file in files)
            {
                var name = Path.GetFileName(file).Replace(".swalloop.json", "");
                GoldenCase(name, GraphFile.Parse(File.ReadAllText(file), registry), Path.Combine(root, "dotnet", "golden", name + ".golden.json"), registry);
            }

            Section("golden cases: parameter overrides on a template (limits, twist cap, refined search, adopted start...)");
            var cases = (List<object>)MiniJson.Parse(File.ReadAllText(Path.Combine(root, "dotnet", "golden", "cases.json")));
            Check("cases found", cases.Count >= 8, cases.Count + " cases");
            foreach (Dictionary<string, object> c in cases)
            {
                var graph = GraphFile.Parse(File.ReadAllText(Path.Combine(root, "templates", (string)c["template"] + ".swalloop.json")), registry);
                foreach (var perNode in (Dictionary<string, object>)c["over"])
                {
                    var node = graph.Nodes.First(n => n.Id == perNode.Key);
                    foreach (var p in (Dictionary<string, object>)perNode.Value) node.Params[p.Key] = p.Value;
                }
                var cname = (string)c["name"];
                GoldenCase("case: " + cname, graph, Path.Combine(root, "dotnet", "golden", "case-" + cname + ".golden.json"), registry);
            }

            Section("graph file format");
            FormatTests(registry);

            Section("engine rules");
            EngineTests(registry);

            Console.WriteLine();
            Console.WriteLine(_failed == 0 ? "all " + _passed + " passed" : _failed + " FAILED, " + _passed + " passed");
            return _failed == 0 ? 0 : 1;
        }

        // ---- golden -------------------------------------------------------------------------

        private sealed class Stats
        {
            public int Numbers;
            public double MaxAbs, MaxRel;
        }

        private static void GoldenCase(string name, Graph graph, string goldenPath, Registry registry)
        {
            if (!File.Exists(goldenPath))
            {
                Check(name, false, "no golden file; run `node scripts/dump-golden.mjs`");
                return;
            }
            var sw = Stopwatch.StartNew();
            var result = Engine.Evaluate(graph.Nodes, graph.Edges, registry);
            sw.Stop();

            var golden = (Dictionary<string, object>)((Dictionary<string, object>)MiniJson.Parse(File.ReadAllText(goldenPath)))["nodes"];
            var stats = new Stats();
            var problems = new List<string>();

            if (graph.Problems.Count > 0) problems.Add("skipped wires: " + graph.Problems[0]);
            foreach (var kv in golden)
            {
                var id = kv.Key;
                var g = (Dictionary<string, object>)kv.Value;
                if (!result.Results.TryGetValue(id, out var r)) { problems.Add("node " + id + " missing"); continue; }
                if (g.ContainsKey("error"))
                {
                    if (r.Error == null) problems.Add(id + ": JS errored (" + g["error"] + ") but C# did not");
                    continue;
                }
                if (r.Error != null) { problems.Add(id + ": C# error: " + r.Error); continue; }
                var expected = (Dictionary<string, object>)g["outputs"];
                object resultValue = null;
                r.Outputs?.TryGetValue("result", out resultValue);
                foreach (var port in expected)
                {
                    object actualRaw = null;
                    if (r.Outputs == null || !r.Outputs.TryGetValue(port.Key, out actualRaw))
                    {
                        if (port.Value != null) problems.Add(id + "." + port.Key + ": missing output");
                        continue;
                    }
                    var actual = Normalizer.Output(port.Key, actualRaw, resultValue);
                    Compare(id + "." + port.Key, port.Value, actual, stats, problems);
                }
            }
            var detail = string.Format("{0} numbers, max abs {1:E1}, max rel {2:E1}, {3:F0} ms",
                stats.Numbers, stats.MaxAbs, stats.MaxRel, sw.Elapsed.TotalMilliseconds);
            Check(name, problems.Count == 0, problems.Count == 0 ? detail : string.Join("; ", problems.Take(4)) + " | " + detail);
        }

        private static void Compare(string path, object expected, object actual, Stats s, List<string> problems)
        {
            if (problems.Count > 8) return;
            if (expected == null || actual == null)
            {
                if (!(expected == null && actual == null)) problems.Add(path + ": expected " + Show(expected) + ", got " + Show(actual));
                return;
            }
            if (expected is double e && actual is double a)
            {
                s.Numbers++;
                var abs = Math.Abs(e - a);
                var rel = abs / Math.Max(Math.Max(Math.Abs(e), Math.Abs(a)), 1e-300);
                if (abs > s.MaxAbs) s.MaxAbs = abs;
                if (rel > s.MaxRel && abs > AbsTol) s.MaxRel = rel;
                if (abs > AbsTol + RelTol * Math.Max(Math.Abs(e), Math.Abs(a)))
                    problems.Add(path + ": expected " + e.ToString("R") + ", got " + a.ToString("R"));
                return;
            }
            if (expected is List<object> le && actual is List<object> la)
            {
                if (le.Count != la.Count) { problems.Add(path + ": list length " + la.Count + ", expected " + le.Count); return; }
                for (var i = 0; i < le.Count; i++) Compare(path + "[" + i + "]", le[i], la[i], s, problems);
                return;
            }
            if (expected is Dictionary<string, object> de && actual is Dictionary<string, object> da)
            {
                foreach (var k in de.Keys.Union(da.Keys))
                {
                    de.TryGetValue(k, out var ev);
                    da.TryGetValue(k, out var av);
                    Compare(path + "." + k, ev, av, s, problems);
                }
                return;
            }
            if (!expected.Equals(actual)) problems.Add(path + ": expected " + Show(expected) + ", got " + Show(actual));
        }

        private static string Show(object v) { return v == null ? "null" : MiniJson.Serialize(v); }

        // ---- file format --------------------------------------------------------------------

        private static string Base(string extraNode = null, string extraEdge = null)
        {
            return "{\"format\":\"swalloop-graph\",\"version\":1,\"name\":\"t\",\"nodes\":[" +
                   "{\"id\":\"x0\",\"type\":\"number\",\"params\":{\"value\":1}}," +
                   "{\"id\":\"start\",\"type\":\"loopStart\",\"params\":{}}," +
                   "{\"id\":\"step\",\"type\":\"newton\",\"params\":{\"a\":2}}," +
                   "{\"id\":\"end\",\"type\":\"loopEnd\",\"params\":{\"iterations\":20,\"tolerance\":0}}" +
                   (extraNode != null ? "," + extraNode : "") + "]," +
                   "\"edges\":[{\"from\":\"x0.value\",\"to\":\"start.initial\"},{\"from\":\"start.state\",\"to\":\"step.x\"},{\"from\":\"step.x\",\"to\":\"end.result\"}" +
                   (extraEdge != null ? "," + extraEdge : "") + "]}";
        }

        private static void FormatTests(Registry reg)
        {
            Throws("a wrong format is refused", () => GraphFile.Parse("{\"format\":\"nope\"}", reg), "Not a Swalloop graph file");
            Throws("a newer version is refused", () => GraphFile.Parse(Base().Replace("\"version\":1", "\"version\":2"), reg), "version");
            Throws("missing lists are refused", () => GraphFile.Parse("{\"format\":\"swalloop-graph\",\"version\":1,\"nodes\":[]}", reg), "nodes\" and \"edges");
            Throws("an unknown node type is named", () => GraphFile.Parse(Base("{\"id\":\"z\",\"type\":\"teleporter\",\"params\":{}}"), reg), "Unknown node type: teleporter");
            Throws("duplicate ids are refused", () => GraphFile.Parse(Base("{\"id\":\"x0\",\"type\":\"number\",\"params\":{}}"), reg), "Duplicate node id");
            Throws("text that is not JSON is refused", () => GraphFile.Parse("this is not json", reg), "Invalid JSON");

            var bad = GraphFile.Parse(Base(null, "{\"from\":\"nope.x\",\"to\":\"start.initial\"},{\"from\":\"x0.value\",\"to\":\"start.zzz\"},{\"from\":\"x0.zzz\",\"to\":\"start.initial\"}"), reg);
            Check("bad wires are skipped and reported, not fatal", bad.Problems.Count == 3 && bad.Edges.Count == 3, bad.Problems.Count + " problems, " + bad.Edges.Count + " edges");

            var ok = GraphFile.Parse(Base(null, "{\"from\":\"x0.value\",\"to\":\"step.a\"}"), reg);
            Check("a wire into a numeric parameter is accepted", ok.Problems.Count == 0);
            var sel = GraphFile.Parse("{\"format\":\"swalloop-graph\",\"version\":1,\"nodes\":[{\"id\":\"x0\",\"type\":\"number\"},{\"id\":\"m\",\"type\":\"math\"}],\"edges\":[{\"from\":\"x0.value\",\"to\":\"m.op\"}]}", reg);
            Check("a wire into a select parameter is not", sel.Problems.Count == 1);

            var noParams = GraphFile.Parse("{\"format\":\"swalloop-graph\",\"version\":1,\"nodes\":[{\"id\":\"o\",\"type\":\"orient\"}],\"edges\":[]}", reg);
            Check("missing parameters take their defaults", noParams.Nodes[0].Params.Num("rate") == 0.2 && noParams.Nodes[0].Params.Str("search") == "Grid");
        }

        // ---- engine rules --------------------------------------------------------------------

        private static void EngineTests(Registry reg)
        {
            var g = GraphFile.Parse(Base(), reg);
            var r = Engine.Evaluate(g.Nodes, g.Edges, reg);
            var x = V.Num(r.Results["end"].Outputs["result"]);
            Check("Newton from 1 reaches sqrt(2) in 20 passes", Math.Abs(x - Math.Sqrt(2)) < 1e-12 && V.Num(r.Results["end"].Outputs["count"]) == 20);

            Check("a loop is paired with the nearest Loop Start", r.Pairs["end"] == "start");

            // nested: outer start/end around an inner start/end; inner pairs first
            var nested = GraphFile.Parse(
                "{\"format\":\"swalloop-graph\",\"version\":1,\"nodes\":[" +
                "{\"id\":\"x\",\"type\":\"number\",\"params\":{\"value\":0}}," +
                "{\"id\":\"s1\",\"type\":\"loopStart\"},{\"id\":\"s2\",\"type\":\"loopStart\"}," +
                "{\"id\":\"inc\",\"type\":\"math\",\"params\":{\"op\":\"+\",\"b\":1}}," +
                "{\"id\":\"e2\",\"type\":\"loopEnd\",\"params\":{\"iterations\":3,\"tolerance\":0}}," +
                "{\"id\":\"e1\",\"type\":\"loopEnd\",\"params\":{\"iterations\":4,\"tolerance\":0}}]," +
                "\"edges\":[{\"from\":\"x.value\",\"to\":\"s1.initial\"},{\"from\":\"s1.state\",\"to\":\"s2.initial\"}," +
                "{\"from\":\"s2.state\",\"to\":\"inc.a\"},{\"from\":\"inc.result\",\"to\":\"e2.result\"},{\"from\":\"e2.result\",\"to\":\"e1.result\"}]}", reg);
            var nr = Engine.Evaluate(nested.Nodes, nested.Edges, reg);
            Check("nested loops pair inner first and compose (4 x 3 increments = 12)",
                nr.Pairs["e2"] == "s2" && nr.Pairs["e1"] == "s1" && V.Num(nr.Results["e1"].Outputs["result"]) == 12,
                "result " + Show(nr.Results["e1"].Outputs?["result"]));

            var cyc = new List<GEdge>
            {
                new GEdge { Source = "a", SourceHandle = "o", Target = "b", TargetHandle = "i" },
                new GEdge { Source = "b", SourceHandle = "o", Target = "c", TargetHandle = "i" },
            };
            Check("a wire that would close a cycle is detected", Engine.WouldCycle(cyc, "c", "a") && !Engine.WouldCycle(cyc, "a", "c"));

            var tree = MiniJson.Parse("{\"a\":[1,2.5,true,null,\"x\\n\"],\"b\":{\"c\":-3e2}}");
            var again = MiniJson.Parse(MiniJson.Serialize(tree));
            Check("JSON reads and writes back to the same tree", Normalizer.TreeEquals(tree, again));

            // adopt: a loop result is frozen into the Tower node's snapshot and thawed back identically
            var sky = GraphFile.Parse(File.ReadAllText(Path.Combine(FindRoot(), "templates", "skyscraper-manhattan.swalloop.json")), reg);
            var sr = Engine.Evaluate(sky.Nodes, sky.Edges, reg);
            var result = (Tower)sr.Results["end"].Outputs["result"];
            var towerNode = sky.Nodes.First(n => n.Id == "tower");
            towerNode.Params["snapshot"] = SkyscraperNodes.Freeze(result);
            towerNode.Params["source"] = "Adopted";
            var adopted = (Tower)reg.NodeTypes["tower"].Compute(new Dictionary<string, object>(), towerNode.Params)["tower"];
            var same = adopted.Floors.Count == result.Floors.Count &&
                       adopted.Floors.Zip(result.Floors, (p, q) => p.W == q.W && p.D == q.D && p.Rot == q.Rot && p.Round == q.Round && p.Z == q.Z).All(b => b) &&
                       adopted.Floors.All(f => f.Util == 0 && f.WindF == 0);
            Check("Adopt: the tower node returns the stored floors, derived values reset", same);
        }

        // ---- helpers ------------------------------------------------------------------------

        private static void Section(string title)
        {
            Console.WriteLine();
            Console.WriteLine("== " + title);
        }

        private static void Check(string name, bool ok, string detail = null)
        {
            if (ok) _passed++; else _failed++;
            Console.WriteLine((ok ? "ok   " : "FAIL ") + name + (detail != null ? "  [" + detail + "]" : ""));
        }

        private static void Throws(string name, Action action, string contains)
        {
            try
            {
                action();
                Check(name, false, "did not throw");
            }
            catch (Exception ex)
            {
                Check(name, ex.Message.Contains(contains), ex.Message.Length > 90 ? ex.Message.Substring(0, 90) : ex.Message);
            }
        }

        private static string FindRoot()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !(Directory.Exists(Path.Combine(dir.FullName, "templates")) && Directory.Exists(Path.Combine(dir.FullName, "dotnet"))))
                dir = dir.Parent;
            if (dir == null) throw new InvalidOperationException("Could not find the repository root (a folder with templates/ and dotnet/).");
            return dir.FullName;
        }
    }
}
