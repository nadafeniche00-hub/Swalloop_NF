using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Swalloop.Core;

namespace Swalloop.GH.Testing
{
    /// <summary>
    /// Builds each template as a Grasshopper canvas, solves it, and compares the outputs of every node
    /// with the golden files the JavaScript engine wrote. It is how we know the canvases are the
    /// templates: not the same file, but the same numbers, node by node.
    /// </summary>
    public static class CanvasVerifier
    {
        private const double RelTol = 1e-9;
        private const double AbsTol = 1e-9;

        /// <summary>
        /// Builds, solves and checks every *.swalloop.json in templatesDir; saves each canvas to outDir as a .gh.
        /// Returns a JSON report.
        /// </summary>
        public static string VerifyAll(string templatesDir, string goldenDir, string outDir, bool nativeWidgets)
        {
            var report = new List<object>();
            foreach (var file in Directory.GetFiles(templatesDir, "*.swalloop.json").OrderBy(f => f))
            {
                var name = Path.GetFileName(file).Replace(".swalloop.json", "");
                var entry = new Dictionary<string, object> { { "template", name } };
                try
                {
                    var built = TemplateBuilder.Build(file, nativeWidgets);
                    HeadlessSolver.Solve(built.Document);
                    var golden = Path.Combine(goldenDir, name + ".golden.json");
                    var problems = new List<string>(built.Problems);
                    var stats = new Stats();
                    var skipped = NodesWithoutItem(built.Graph);
                    if (File.Exists(golden)) Compare(built.Objects, (Dictionary<string, object>)((Dictionary<string, object>)MiniJson.Parse(File.ReadAllText(golden)))["nodes"], skipped, stats, problems);
                    else problems.Add("no golden file");
                    var errors = new List<string>();
                    var warnings = new List<string>();
                    Messages(built.Document.Objects, errors, warnings);
                    problems.AddRange(errors.Select(e => "runtime error " + e));
                    entry["warnings"] = warnings.Select(w => (object)w).ToList();
                    entry["nodes"] = (double)built.Objects.Count;
                    entry["skipped"] = skipped.OrderBy(x => x).Select(x => (object)x).ToList();
                    entry["compared"] = (double)stats.Numbers;
                    entry["maxAbs"] = stats.MaxAbs;
                    entry["problems"] = problems.Take(12).Select(p => (object)p).ToList();
                    entry["ok"] = problems.Count == 0;
                    if (outDir != null)
                    {
                        var ghPath = Path.Combine(outDir, name + ".gh");
                        var saved = TemplateBuilder.Save(built, ghPath);
                        entry["saved"] = saved;
                        // the file itself: reopen it from disk, solve it, and compare again
                        var reopened = Reopen(ghPath, out var reopenProblem);
                        var rtProblems = new List<string>();
                        if (reopened == null) rtProblems.Add(reopenProblem);
                        else
                        {
                            HeadlessSolver.Solve(reopened.Document);
                            var rtErrors = new List<string>();
                            Messages(reopened.Document.Objects, rtErrors, new List<string>());
                            rtProblems.AddRange(rtErrors.Select(e => "runtime error " + e));
                            var rtStats = new Stats();
                            Compare(reopened.Objects, (Dictionary<string, object>)((Dictionary<string, object>)MiniJson.Parse(File.ReadAllText(golden)))["nodes"], skipped, rtStats, rtProblems);
                            entry["roundTripCompared"] = (double)rtStats.Numbers;
                            if (rtStats.Numbers != stats.Numbers) rtProblems.Add("round trip compared " + rtStats.Numbers + " numbers, the built canvas " + stats.Numbers);
                        }
                        entry["roundTripOk"] = rtProblems.Count == 0;
                        foreach (var p in rtProblems) problems.Add("[reopened file] " + p);
                        entry["ok"] = problems.Count == 0;
                    }
                }
                catch (Exception ex)
                {
                    entry["ok"] = false;
                    entry["problems"] = new List<object> { ex.GetType().Name + ": " + ex.Message };
                }
                report.Add(entry);
            }
            return MiniJson.Serialize(report);
        }

        // Runtime messages of every component on a canvas: errors are problems, warnings are reported.
        private static void Messages(IEnumerable<IGH_DocumentObject> objects, List<string> errors, List<string> warnings)
        {
            foreach (var o in objects)
            {
                var a = o as IGH_ActiveObject;
                if (a == null) continue;
                foreach (var m in a.RuntimeMessages(GH_RuntimeMessageLevel.Error)) errors.Add(o.NickName + ": " + m);
                foreach (var m in a.RuntimeMessages(GH_RuntimeMessageLevel.Warning)) warnings.Add(o.NickName + ": " + m);
            }
        }

        private sealed class Stats { public int Numbers; public double MaxAbs; }

        private sealed class Reopened
        {
            public GH_Document Document;
            public Dictionary<string, IGH_DocumentObject> Objects = new Dictionary<string, IGH_DocumentObject>();
        }

        // A canvas read back from a .gh file; its objects are found by the node id the builder put in the nickname.
        private static Reopened Reopen(string path, out string problem)
        {
            problem = null;
            var io = new GH_DocumentIO();
            if (!io.Open(path) || io.Document == null)
            {
                problem = "the .gh file could not be opened again";
                return null;
            }
            var r = new Reopened { Document = io.Document };
            foreach (var o in io.Document.Objects)
                if (!string.IsNullOrEmpty(o.NickName) && !r.Objects.ContainsKey(o.NickName)) r.Objects[o.NickName] = o;
            return r;
        }

        /// <summary>
        /// Nodes that read a Loop Start's Item and are solved outside any loop (the canvas shows one pass of
        /// the body). There Item has no value: the JavaScript engine feeds undefined into the maths and gets
        /// NaN or an artefact of it, and Grasshopper uses the parameter's default instead. Neither is a
        /// result, so they are not compared. The loop's result is: Loop End is never skipped.
        /// </summary>
        private static HashSet<string> NodesWithoutItem(Graph g)
        {
            var type = g.Nodes.ToDictionary(n => n.Id, n => n.Type);
            var skipped = new HashSet<string>();
            var queue = new Queue<string>(g.Edges
                .Where(e => e.SourceHandle == "item" && type[e.Source] == "loopStart" && type[e.Target] != "loopEnd")
                .Select(e => e.Target));
            while (queue.Count > 0)
            {
                var id = queue.Dequeue();
                if (!skipped.Add(id)) continue;
                foreach (var e in g.Edges)
                    if (e.Source == id && type[e.Target] != "loopEnd") queue.Enqueue(e.Target);
            }
            return skipped;
        }

        private static void Compare(IDictionary<string, IGH_DocumentObject> objects, Dictionary<string, object> golden, HashSet<string> skipped, Stats stats, List<string> problems)
        {
            foreach (var kv in golden)
            {
                if (skipped.Contains(kv.Key)) continue;
                var g = (Dictionary<string, object>)kv.Value;
                if (g.ContainsKey("error") || !g.TryGetValue("outputs", out var outsRaw)) continue;
                if (!objects.TryGetValue(kv.Key, out var obj)) { problems.Add(kv.Key + ": missing on the canvas"); continue; }

                // the result first: a loop's history is compared through it
                object resultValue = null;
                var expected = (Dictionary<string, object>)outsRaw;
                if (expected.ContainsKey("result")) resultValue = Read(obj, "result", out _);
                foreach (var port in expected)
                {
                    var actual = Read(obj, port.Key, out var found);
                    if (!found) continue; // a port the canvas object does not have (a panel, a slider's extras)
                    if (actual == null && port.Value != null) { problems.Add(kv.Key + "." + port.Key + ": no data"); continue; }
                    CompareTree(kv.Key + "." + port.Key, port.Value, Normalizer.Output(port.Key, actual, resultValue), stats, problems);
                }
            }
        }

        // an output of a canvas object as an engine value
        private static object Read(IGH_DocumentObject obj, string port, out bool found)
        {
            found = false;
            IGH_Param p;
            var isList = false;
            if (obj is NodeComponent c)
            {
                var i = c.Meta.OutputIndex(port);
                if (i < 0 || i >= c.Params.Output.Count) return null;
                p = c.Params.Output[i];
                isList = c.Meta.Outputs[i].Type == "list";
            }
            else if (obj is IGH_Param single && port == "value") p = single;
            else return null;
            found = true;
            var items = new List<IGH_Goo>();
            foreach (var o in p.VolatileData.AllData(true)) if (o is IGH_Goo g) items.Add(g);
            if (isList) return items.Select(x => Interop.FromGoo(x)).ToList();
            return items.Count > 0 ? Interop.FromGoo(items[0]) : null;
        }

        private static void CompareTree(string path, object expected, object actual, Stats s, List<string> problems)
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
                if (abs > s.MaxAbs) s.MaxAbs = abs;
                if (abs > AbsTol + RelTol * Math.Max(Math.Abs(e), Math.Abs(a)))
                    problems.Add(path + ": expected " + e.ToString("R", CultureInfo.InvariantCulture) + ", got " + a.ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            if (expected is List<object> le && actual is List<object> la)
            {
                if (le.Count != la.Count) { problems.Add(path + ": length " + la.Count + ", expected " + le.Count); return; }
                for (var i = 0; i < le.Count; i++) CompareTree(path + "[" + i + "]", le[i], la[i], s, problems);
                return;
            }
            if (expected is Dictionary<string, object> de && actual is Dictionary<string, object> da)
            {
                foreach (var k in de.Keys.Union(da.Keys))
                {
                    de.TryGetValue(k, out var ev);
                    da.TryGetValue(k, out var av);
                    CompareTree(path + "." + k, ev, av, s, problems);
                }
                return;
            }
            if (!expected.Equals(actual)) problems.Add(path + ": expected " + Show(expected) + ", got " + Show(actual));
        }

        private static string Show(object v) { return v == null ? "null" : MiniJson.Serialize(v); }
    }

    /// <summary>
    /// Solves a definition in dependency order on the calling thread. A canvas-less document does not
    /// reliably schedule its own solution when it is built from a script, so tests and the template
    /// builder's checks drive it directly. On a real canvas Grasshopper does this itself.
    /// </summary>
    public static class HeadlessSolver
    {
        public static void Solve(GH_Document doc)
        {
            var done = new HashSet<IGH_DocumentObject>();
            foreach (var o in doc.Objects.ToList()) SolveObject(o, done);
        }

        private static void SolveObject(IGH_DocumentObject obj, HashSet<IGH_DocumentObject> done)
        {
            if (!done.Add(obj)) return;
            IEnumerable<IGH_Param> inputs = obj is IGH_Component c ? c.Params.Input : obj is IGH_Param p ? new[] { p } : new IGH_Param[0];
            foreach (var input in inputs)
                foreach (var src in input.Sources)
                {
                    var owner = src.Attributes?.GetTopLevel?.DocObject;
                    if (owner != null) SolveObject(owner, done);
                }
            if (obj is IGH_Component comp)
            {
                comp.ClearData();
                comp.CollectData();
                comp.ComputeData();
            }
            else if (obj is IGH_Param par)
            {
                par.ClearData();
                par.CollectData();
                par.ComputeData();
            }
        }
    }
}
