using System;
using System.Collections.Generic;

namespace Swalloop.Core
{
    /// <summary>Domain-free nodes. Port of src/core/nodes.js.</summary>
    public static class CoreNodes
    {
        public static readonly string[] LoopKinds = { "Repeat", "While", "Fold", "For each" };
        public static readonly string[] OpNames = { "+", "-", "×", "÷", "|a-b|", "min", "max", "pow" };
        private static readonly string[] CompareNames = { "<", "<=", ">", ">=", "==", "!=" };

        private static Dictionary<string, object> Out(string id, object value)
        {
            return new Dictionary<string, object> { { id, value } };
        }

        public static double Op(string op, double a, double b)
        {
            switch (op)
            {
                case "+": return a + b;
                case "-": return a - b;
                case "×": return a * b;
                case "÷": return a / b;
                case "|a-b|": return Math.Abs(a - b);
                case "min": return Math.Min(a, b);
                case "max": return Math.Max(a, b);
                case "pow": return Math.Pow(a, b);
                default: throw new InvalidOperationException("OPS[p.op] is not a function");
            }
        }

        private static bool Cmp(string op, double a, double b)
        {
            switch (op)
            {
                case "<": return a < b;
                case "<=": return a <= b;
                case ">": return a > b;
                case ">=": return a >= b;
                case "==": return a == b;
                case "!=": return a != b;
                default: throw new InvalidOperationException("COMPARE[p.op] is not a function");
            }
        }

        public static IEnumerable<NodeType> All()
        {
            yield return new NodeType
            {
                Id = "inspect",
                Inputs = new[] { new Port("value", "Value"), new Port("history", "History", true) },
            };

            yield return new NodeType
            {
                Id = "number",
                Outputs = new[] { new Port("value", "Value") },
                Params = new[] { ParamDef.Num("value", 5), ParamDef.Num("min", 0), ParamDef.Num("max", 10) },
                Compute = (i, p) => Out("value", p.Raw("value")),
            };

            yield return new NodeType
            {
                Id = "range",
                Outputs = new[] { new Port("list", "List") },
                Params = new[] { ParamDef.Num("count", 10), ParamDef.Num("start", 1), ParamDef.Num("step", 1) },
                Compute = (i, p) =>
                {
                    var n = (int)Math.Max(0, Math.Floor(p.Num("count")));
                    var list = new List<object>(n);
                    for (var k = 0; k < n; k++) list.Add(p.Num("start") + k * p.Num("step"));
                    return Out("list", list);
                },
            };

            yield return new NodeType
            {
                Id = "math",
                Outputs = new[] { new Port("result", "Result") },
                Params = new[] { ParamDef.Select("op", "+", OpNames), ParamDef.Num("a", 0), ParamDef.Num("b", 0) },
                Compute = (i, p) => Out("result", Op(p.Str("op"), p.Num("a"), p.Num("b"))),
            };

            yield return new NodeType
            {
                Id = "compare",
                Outputs = new[] { new Port("result", "True?") },
                Params = new[] { ParamDef.Select("op", "<", CompareNames), ParamDef.Num("a", 0), ParamDef.Num("b", 1) },
                Compute = (i, p) => Out("result", Cmp(p.Str("op"), p.Num("a"), p.Num("b"))),
            };

            yield return new NodeType
            {
                Id = "logic",
                Inputs = new[] { new Port("a", "A"), new Port("b", "B", true) },
                Outputs = new[] { new Port("result", "Result") },
                Params = new[] { ParamDef.Select("op", "and", "and", "or", "not") },
                Compute = (i, p) =>
                {
                    i.TryGetValue("a", out var a);
                    i.TryGetValue("b", out var b);
                    var op = p.Str("op");
                    var r = op == "not" ? !V.Truthy(a) : op == "or" ? (V.Truthy(a) || V.Truthy(b)) : (V.Truthy(a) && V.Truthy(b));
                    return Out("result", r);
                },
            };

            yield return new NodeType
            {
                Id = "loopStart",
                Inputs = new[] { new Port("initial", "Initial", true) },
                Outputs = new[] { new Port("state", "State"), new Port("index", "Index"), new Port("item", "Item") },
                // only runs when evaluated outside a loop
                Compute = (i, p) =>
                {
                    i.TryGetValue("initial", out var init);
                    return new Dictionary<string, object> { { "state", init }, { "index", 0.0 }, { "item", null } };
                },
            };

            // Executed by the engine (see Engine.cs); compute is never called.
            yield return new NodeType
            {
                Id = "loopEnd",
                Inputs = new[] { new Port("result", "Result"), new Port("condition", "Condition", true), new Port("items", "Items", true) },
                Outputs = new[] { new Port("result", "Result"), new Port("history", "History"), new Port("count", "Iterations"), new Port("delta", "Last change") },
                Params = new[]
                {
                    ParamDef.Select("kind", "Repeat", LoopKinds),
                    ParamDef.Num("iterations", 150),
                    ParamDef.Num("tolerance", 0.002),
                },
            };

            // A value from outside the graph (a Grasshopper slider, a panel...). Not part of the editor's
            // palette or the JavaScript registry: hosts use it to hand fixed data to the engine.
            yield return new NodeType
            {
                Id = "const",
                Outputs = new[] { new Port("value", "Value") },
                Params = new[] { new ParamDef { Id = "value", Default = null } },
                Compute = (i, p) => Out("value", p.Raw("value")),
            };

            yield return new NodeType
            {
                Id = "readout",
                Inputs = new[] { new Port("value", "Value") },
            };
        }
    }
}
