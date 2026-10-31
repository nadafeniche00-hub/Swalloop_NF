using System.Collections.Generic;

namespace Swalloop.Core.Packs
{
    /// <summary>A tiny second pack: the loop does not care what it iterates. Port of src/packs/math/pack.js.</summary>
    public static class MathNodes
    {
        public static IEnumerable<NodeType> All()
        {
            // Newton step for sqrt(a): x -> (x + a/x) / 2
            yield return new NodeType
            {
                Id = "newton",
                Inputs = new[] { new Port("x", "x") },
                Outputs = new[] { new Port("x", "x") },
                Params = new[] { ParamDef.Num("a", 2) },
                Compute = (i, p) =>
                {
                    var x = V.Num(i["x"]);
                    return new Dictionary<string, object> { { "x", (x + p.Num("a") / x) / 2 } };
                },
            };

            yield return new NodeType
            {
                Id = "logistic",
                Inputs = new[] { new Port("x", "x") },
                Outputs = new[] { new Port("x", "x") },
                Params = new[] { ParamDef.Num("r", 3.7) },
                Compute = (i, p) =>
                {
                    var x = V.Num(i["x"]);
                    return new Dictionary<string, object> { { "x", p.Num("r") * x * (1 - x) } };
                },
            };
        }
    }
}
