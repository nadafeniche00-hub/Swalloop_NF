using System;
using System.Collections.Generic;
using System.Linq;

namespace Swalloop.Core.Packs
{
    /// <summary>
    /// The analysis pack: integrals, logarithms, Fourier, Gaussian splatting and linear algebra. A port
    /// of src/packs/analysis/nodes.js. Values are the same plain shapes the JavaScript engine uses:
    /// a list is List&lt;object&gt; of double, points are lists of [x, y], a matrix is a list of rows,
    /// splats are records, and a grid is { kind: "grid", n, extent, values }.
    /// </summary>
    public static class AnalysisNodes
    {
        // ---- conversions between the plain value shapes and arrays ---------------------------------

        public static double[] ToDoubles(object v)
        {
            var l = (List<object>)v;
            var a = new double[l.Count];
            for (var i = 0; i < a.Length; i++) a[i] = V.Num(l[i]);
            return a;
        }

        public static List<object> FromDoubles(IEnumerable<double> v)
        {
            return v.Select(x => (object)x).ToList();
        }

        public static double[][] ToMatrix(object v)
        {
            return ((List<object>)v).Select(r => ToDoubles(r)).ToArray();
        }

        public static List<object> FromMatrix(double[][] m)
        {
            return m.Select(r => (object)FromDoubles(r)).ToList();
        }

        public static List<double[]> ToPoints(object v)
        {
            return ((List<object>)v).Select(p => ToDoubles(p)).ToList();
        }

        public static List<object> FromPoints(IEnumerable<double[]> pts)
        {
            return pts.Select(p => (object)new List<object> { p[0], p[1] }).ToList();
        }

        private static double Area(IList<double[]> pts)
        {
            double s = 0;
            for (var i = 0; i < pts.Count; i++)
            {
                var a = pts[i];
                var b = pts[(i + 1) % pts.Count];
                s += a[0] * b[1] - b[0] * a[1];
            }
            return Math.Abs(s) / 2;
        }

        private static object In(Dictionary<string, object> inputs, string id)
        {
            return inputs.TryGetValue(id, out var v) ? v : null;
        }

        private static Port P(string id, string label, bool optional = false) { return new Port(id, label, optional); }

        public static IEnumerable<NodeType> All()
        {
            // element-wise arithmetic on lists: a (op) b, or a (op) s when there is no b
            yield return new NodeType
            {
                Id = "listMath",
                Inputs = new[] { P("a", "A"), P("b", "B", true) },
                Outputs = new[] { P("result", "Result") },
                Params = new[] { ParamDef.Select("op", "×", CoreNodes.OpNames), ParamDef.Num("s", 1) },
                Compute = (i, p) =>
                {
                    var a = ToDoubles(i["a"]);
                    var bRaw = In(i, "b");
                    var b = bRaw != null ? ToDoubles(bRaw) : null;
                    if (b != null && b.Length != a.Length)
                        throw new InvalidOperationException("Lists differ in length (" + a.Length + " and " + b.Length + ")");
                    var op = p.Str("op");
                    var s = p.Num("s");
                    var r = new double[a.Length];
                    for (var k = 0; k < a.Length; k++) r[k] = CoreNodes.Op(op, a[k], b != null ? b[k] : s);
                    return new Dictionary<string, object> { { "result", FromDoubles(r) } };
                },
            };

            // gathers up to four values into one list
            yield return new NodeType
            {
                Id = "pack",
                Inputs = new[] { P("a", "A"), P("b", "B", true), P("c", "C", true), P("d", "D", true) },
                Outputs = new[] { P("list", "List") },
                Compute = (i, p) =>
                {
                    var list = new List<object>();
                    foreach (var k in new[] { "a", "b", "c", "d" })
                        if (i.TryGetValue(k, out var v) && v != null) list.Add(v);
                    return new Dictionary<string, object> { { "list", list } };
                },
            };

            // integral of y(x): trapezoid or composite Simpson; "x·f" weights the samples by x
            yield return new NodeType
            {
                Id = "integrate",
                Inputs = new[] { P("y", "y"), P("x", "x", true) },
                Outputs = new[] { P("integral", "Integral"), P("cumulative", "Running") },
                Params = new[]
                {
                    ParamDef.Select("method", "Trapezoid", "Trapezoid", "Simpson"),
                    ParamDef.Select("weight", "f", "f", "x·f"),
                    ParamDef.Num("x0", 0),
                    ParamDef.Num("dx", 1),
                },
                Compute = (i, p) =>
                {
                    var y = ToDoubles(i["y"]);
                    var xRaw = In(i, "x");
                    double[] xs;
                    if (xRaw != null) xs = ToDoubles(xRaw);
                    else
                    {
                        xs = new double[y.Length];
                        for (var k = 0; k < y.Length; k++) xs[k] = p.Num("x0") + k * p.Num("dx");
                    }
                    if (xs.Length != y.Length)
                        throw new InvalidOperationException("x and y differ in length (" + xs.Length + " and " + y.Length + ")");
                    var ys = y;
                    if (p.Str("weight") == "x·f")
                    {
                        ys = new double[y.Length];
                        for (var k = 0; k < y.Length; k++) ys[k] = y[k] * xs[k];
                    }
                    var integral = Numeric.Integrate(xs, ys, p.Str("method"), out var cumulative);
                    return new Dictionary<string, object> { { "integral", integral }, { "cumulative", FromDoubles(cumulative) } };
                },
            };

            // logarithmic wind profile and the power-law exponent that fits it (through the reference point)
            yield return new NodeType
            {
                Id = "logWind",
                Inputs = new[] { P("z", "Heights (m)") },
                Outputs = new[] { P("speed", "Speed (m/s)"), P("alpha", "Power-law exponent") },
                Params = new[] { ParamDef.Num("vRef", 40), ParamDef.Num("zRef", 10), ParamDef.Num("z0", 1) },
                Compute = (i, p) =>
                {
                    var z = ToDoubles(i["z"]);
                    var vRef = p.Num("vRef");
                    var zRef = p.Num("zRef");
                    var z0 = p.Num("z0");
                    var denom = Math.Log(zRef / z0);
                    var speed = new double[z.Length];
                    for (var k = 0; k < z.Length; k++) speed[k] = vRef * Math.Log(Math.Max(z[k], z0) / z0) / denom;
                    double sxy = 0, sxx = 0;
                    for (var k = 0; k < z.Length; k++)
                    {
                        if (!(z[k] > z0) || !(speed[k] > 0)) continue;
                        var x = Math.Log(z[k] / zRef);
                        var y = Math.Log(speed[k] / vRef);
                        sxy += x * y;
                        sxx += x * x;
                    }
                    return new Dictionary<string, object>
                    {
                        { "speed", FromDoubles(speed) },
                        { "alpha", sxx > 0 ? sxy / sxx : 0.0 },
                    };
                },
            };

            // low-pass a signal; Mirror reflects it first so there is no wrap-around at the ends
            yield return new NodeType
            {
                Id = "fourier",
                Inputs = new[] { P("signal", "Signal") },
                Outputs = new[] { P("smooth", "Smoothed"), P("amplitudes", "Amplitudes"), P("retained", "Energy kept") },
                Params = new[] { ParamDef.Num("keep", 3), ParamDef.Select("edge", "Mirror", "Mirror", "Periodic") },
                Compute = (i, p) =>
                {
                    var signal = ToDoubles(i["signal"]);
                    var n = signal.Length;
                    var keep = (int)Math.Max(0, Math.Floor(p.Num("keep")));
                    double[] ext;
                    if (p.Str("edge") == "Mirror")
                    {
                        ext = new double[n * 2];
                        for (var k = 0; k < n; k++) ext[k] = signal[k];
                        for (var k = 0; k < n; k++) ext[n + k] = signal[n - 1 - k];
                    }
                    else ext = signal;
                    var m = ext.Length;
                    if (m == 0)
                        return new Dictionary<string, object>
                        {
                            { "smooth", new List<object>() }, { "amplitudes", new List<object>() }, { "retained", 1.0 },
                        };
                    Numeric.Dft(ext, new double[m], -1, out var fre, out var fim);
                    Numeric.Lowpass(fre, fim, keep, out var lre, out var lim, out var retained);
                    Numeric.Dft(lre, lim, +1, out var ire, out _);
                    var smooth = new double[n];
                    for (var k = 0; k < n; k++) smooth[k] = ire[k] / m;
                    var amplitudes = new List<double>();
                    for (var k = 0; k <= m / 2; k++)
                    {
                        var mag = Math.Sqrt(fre[k] * fre[k] + fim[k] * fim[k]);
                        amplitudes.Add(k == 0 ? fre[0] / m : (m % 2 == 0 && k == m / 2 ? mag / m : 2 * mag / m));
                    }
                    return new Dictionary<string, object>
                    {
                        { "smooth", FromDoubles(smooth) }, { "amplitudes", FromDoubles(amplitudes) }, { "retained", retained },
                    };
                },
            };

            // Fourier descriptors of a closed outline: x + iy as one complex sequence, low-passed
            yield return new NodeType
            {
                Id = "fourierCurve",
                Inputs = new[] { P("points", "Outline") },
                Outputs = new[] { P("smooth", "Simplified"), P("deviation", "Max deviation (m)"), P("areaKept", "Area kept"), P("retained", "Energy kept") },
                Params = new[] { ParamDef.Num("keep", 4) },
                Compute = (i, p) =>
                {
                    var pts = ToPoints(i["points"]);
                    var n = pts.Count;
                    var keep = (int)Math.Max(0, Math.Floor(p.Num("keep")));
                    var xs = pts.Select(q => q[0]).ToArray();
                    var ys = pts.Select(q => q[1]).ToArray();
                    Numeric.Dft(xs, ys, -1, out var fre, out var fim);
                    Numeric.Lowpass(fre, fim, keep, out var lre, out var lim, out var retained);
                    Numeric.Dft(lre, lim, +1, out var ire, out var iim);
                    var smooth = new List<double[]>(n);
                    double deviation = 0;
                    for (var k = 0; k < n; k++)
                    {
                        var q = new[] { ire[k] / n, iim[k] / n };
                        smooth.Add(q);
                        var dx = q[0] - pts[k][0];
                        var dy = q[1] - pts[k][1];
                        deviation = Math.Max(deviation, Math.Sqrt(dx * dx + dy * dy));
                    }
                    var a0 = Area(pts);
                    return new Dictionary<string, object>
                    {
                        { "smooth", FromPoints(smooth) },
                        { "deviation", deviation },
                        { "areaKept", a0 > 0 ? Area(smooth) / a0 : 1.0 },
                        { "retained", retained },
                    };
                },
            };

            // 2D Gaussian splats onto an n x n grid: Additive sums, Composite blends front to back by depth
            yield return new NodeType
            {
                Id = "splatField",
                Inputs = new[] { P("splats", "Splats") },
                Outputs = new[] { P("field", "Field"), P("max", "Max"), P("total", "Total") },
                Params = new[]
                {
                    ParamDef.Num("n", 48),
                    ParamDef.Num("extent", 300),
                    ParamDef.Select("mode", "Additive", "Additive", "Composite"),
                    ParamDef.Num("gain", 1),
                },
                Compute = (i, p) =>
                {
                    var raw = ((List<object>)i["splats"]).Cast<Dictionary<string, object>>().ToList();
                    var n = (int)Math.Max(1, Math.Floor(p.Num("n")));
                    var extent = p.Num("extent");
                    var cell = 2 * extent / n;
                    var composite = p.Str("mode") == "Composite";
                    var ordered = raw.Select((s, idx) => new { s, idx }).ToList();
                    if (composite)
                        ordered = ordered.OrderBy(e => V.Num(e.s["depth"])).ThenBy(e => e.idx).ToList(); // stable, by depth then input order
                    var sp = ordered.Select(e => e.s).ToList();
                    var count = sp.Count;
                    var sx = new double[count]; var sy = new double[count]; var px = new double[count]; var py = new double[count];
                    var opacity = new double[count]; var value = new double[count]; var cs = new double[count]; var sn = new double[count];
                    for (var k = 0; k < count; k++)
                    {
                        px[k] = V.Num(sp[k]["x"]); py[k] = V.Num(sp[k]["y"]);
                        sx[k] = V.Num(sp[k]["sx"]); sy[k] = V.Num(sp[k]["sy"]);
                        opacity[k] = V.Num(sp[k]["opacity"]); value[k] = V.Num(sp[k]["value"]);
                        var rot = V.Num(sp[k]["rot"]);
                        cs[k] = Math.Cos(rot); sn[k] = Math.Sin(rot);
                    }
                    var gain = p.Num("gain");
                    var values = new List<object>();
                    var max = double.NegativeInfinity;
                    double total = 0;
                    for (var j = 0; j < n; j++)
                    {
                        var row = new List<object>(n);
                        var y = -extent + (j + 0.5) * cell;
                        for (var ci = 0; ci < n; ci++)
                        {
                            var x = -extent + (ci + 0.5) * cell;
                            double acc = 0;
                            double trans = 1;
                            for (var k = 0; k < count; k++)
                            {
                                var dx = x - px[k];
                                var dy = y - py[k];
                                var u = dx * cs[k] + dy * sn[k];
                                var w = -dx * sn[k] + dy * cs[k];
                                var g = Math.Exp(-0.5 * ((u / sx[k]) * (u / sx[k]) + (w / sy[k]) * (w / sy[k])));
                                if (composite)
                                {
                                    var a = Math.Min(0.99, opacity[k] * g);
                                    acc += trans * a * value[k];
                                    trans *= 1 - a;
                                }
                                else acc += value[k] * g;
                            }
                            var v = gain * acc;
                            row.Add(v);
                            if (v > max) max = v;
                            total += v;
                        }
                        values.Add(row);
                    }
                    var field = new Dictionary<string, object>
                    {
                        { "kind", "grid" }, { "n", (double)n }, { "extent", extent }, { "values", values },
                    };
                    return new Dictionary<string, object>
                    {
                        { "field", field }, { "max", double.IsNegativeInfinity(max) ? 0.0 : max }, { "total", total },
                    };
                },
            };

            yield return new NodeType
            {
                Id = "affine",
                Outputs = new[] { P("matrix", "Matrix") },
                Params = new[]
                {
                    ParamDef.Num("rotate", 0), ParamDef.Num("sx", 1), ParamDef.Num("sy", 1), ParamDef.Num("tx", 0),
                    ParamDef.Num("ty", 0), ParamDef.Num("px", 0), ParamDef.Num("py", 0),
                },
                Compute = (i, p) => new Dictionary<string, object>
                {
                    {
                        "matrix", FromMatrix(Numeric.Affine(p.Num("rotate"), p.Num("sx"), p.Num("sy"), p.Num("tx"), p.Num("ty"), p.Num("px"), p.Num("py")))
                    },
                },
            };

            yield return new NodeType
            {
                Id = "matmul",
                Inputs = new[] { P("a", "A"), P("b", "B") },
                Outputs = new[] { P("matrix", "A × B") },
                Compute = (i, p) => new Dictionary<string, object>
                {
                    { "matrix", FromMatrix(Numeric.Matmul(ToMatrix(i["a"]), ToMatrix(i["b"]))) },
                },
            };

            yield return new NodeType
            {
                Id = "matpow",
                Inputs = new[] { P("m", "M") },
                Outputs = new[] { P("matrix", "M ^ k") },
                Params = new[] { ParamDef.Num("k", 1) },
                Compute = (i, p) => new Dictionary<string, object>
                {
                    { "matrix", FromMatrix(Numeric.Matpow(ToMatrix(i["m"]), p.Num("k"))) },
                },
            };

            yield return new NodeType
            {
                Id = "applyMatrix",
                Inputs = new[] { P("m", "Matrix"), P("points", "Points") },
                Outputs = new[] { P("points", "Points") },
                Compute = (i, p) =>
                {
                    var m = ToMatrix(i["m"]);
                    var pts = ToPoints(i["points"]);
                    var o = new List<double[]>(pts.Count);
                    foreach (var q in pts)
                    {
                        var x = q[0];
                        var y = q[1];
                        var w = m[2][0] * x + m[2][1] * y + m[2][2];
                        o.Add(new[] { (m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w });
                    }
                    return new Dictionary<string, object> { { "points", FromPoints(o) } };
                },
            };

            yield return new NodeType
            {
                Id = "polygon",
                Outputs = new[] { P("points", "Points") },
                Params = new[] { ParamDef.Num("n", 6), ParamDef.Num("radius", 20), ParamDef.Num("aspect", 1), ParamDef.Num("rotate", 0) },
                Compute = (i, p) =>
                {
                    var n = (int)Math.Max(3, Math.Floor(p.Num("n")));
                    var pts = new List<double[]>(n);
                    for (var k = 0; k < n; k++)
                    {
                        var a = 2 * Math.PI * k / n + p.Num("rotate") * Math.PI / 180;
                        pts.Add(new[] { p.Num("radius") * Math.Cos(a), p.Num("radius") * p.Num("aspect") * Math.Sin(a) });
                    }
                    return new Dictionary<string, object> { { "points", FromPoints(pts) } };
                },
            };

            // principal axes of a point set from its 2x2 covariance
            yield return new NodeType
            {
                Id = "pca",
                Inputs = new[] { P("points", "Points") },
                Outputs = new[]
                {
                    P("angle", "Main axis (deg)"), P("major", "Spread along (m)"), P("minor", "Spread across (m)"),
                    P("aspect", "Elongation"), P("cx", "Centre x"), P("cy", "Centre y"),
                },
                Compute = (i, p) =>
                {
                    var pts = ToPoints(i["points"]);
                    var n = pts.Count;
                    double cx = 0, cy = 0;
                    foreach (var q in pts) { cx += q[0]; cy += q[1]; }
                    cx /= n;
                    cy /= n;
                    double sxx = 0, syy = 0, sxy = 0;
                    foreach (var q in pts)
                    {
                        var dx = q[0] - cx;
                        var dy = q[1] - cy;
                        sxx += dx * dx;
                        syy += dy * dy;
                        sxy += dx * dy;
                    }
                    sxx /= n;
                    syy /= n;
                    sxy /= n;
                    var mid = (sxx + syy) / 2;
                    var rr = Math.Sqrt((sxx - syy) / 2 * ((sxx - syy) / 2) + sxy * sxy);
                    var l1 = mid + rr;
                    var l2 = Math.Max(0, mid - rr);
                    var major = Math.Sqrt(l1);
                    var minor = Math.Sqrt(l2);
                    return new Dictionary<string, object>
                    {
                        { "angle", 0.5 * Math.Atan2(2 * sxy, sxx - syy) * 180 / Math.PI },
                        { "major", major },
                        { "minor", minor },
                        { "aspect", minor > 0 ? major / minor : double.PositiveInfinity },
                        { "cx", cx },
                        { "cy", cy },
                    };
                },
            };
        }
    }
}
