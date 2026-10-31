using System;
using System.Collections.Generic;
using System.Linq;

namespace Swalloop.Core.Packs
{
    /// <summary>
    /// The skyscraper pack: a tower reshaped by wind, structure and sun. A port of
    /// src/packs/skyscraper/nodes.js; the arithmetic keeps the same order of operations so the
    /// results can be compared with the JavaScript engine to many decimals.
    /// </summary>
    public static class SkyscraperNodes
    {
        private static readonly string[] MetricNames =
        {
            "None", "Utilisation", "Height", "Wind load", "Wind exposure", "Sun exposure", "Plate area",
            "Rotation", "Roundness", "Aspect", "Facade wind", "Facade sun",
        };
        private static readonly string[] ColormapNames = { "Turbo", "Viridis", "Inferno", "Cool-warm" };

        private struct Vec { public double X, Y; public Vec(double x, double y) { X = x; Y = y; } }

        private static double Rad(double deg) { return deg * Math.PI / 180; }

        // unit vector pointing toward a compass bearing (degrees clockwise from north, +y)
        private static Vec Bearing(double deg) { return new Vec(Math.Sin(Rad(deg)), Math.Cos(Rad(deg))); }

        // Wind pressure (kN/m2) at height z for a reference speed measured at 10 m.
        private static double WindPressure(double z, double vRef, double alpha)
        {
            return 0.5 * 1.25 * vRef * vRef * Math.Pow(Math.Max(z, 10) / 10, 2 * alpha) / 1000;
        }

        // Footprint extents of a rotated rectangle w x d: width seen by the wind, and length along it.
        private static void Projections(double w, double d, double rot, Vec dir, out double frontal, out double along)
        {
            var u = new Vec(Math.Cos(rot), Math.Sin(rot));
            var v = new Vec(-Math.Sin(rot), Math.Cos(rot));
            var n = new Vec(-dir.Y, dir.X);
            frontal = w * Math.Abs(u.X * n.X + u.Y * n.Y) + d * Math.Abs(v.X * n.X + v.Y * n.Y);
            along = w * Math.Abs(u.X * dir.X + u.Y * dir.Y) + d * Math.Abs(v.X * dir.X + v.Y * dir.Y);
        }

        private static Func<double> Mulberry32(double seed)
        {
            // a >>> 0 : the number as an unsigned 32-bit integer
            var a = unchecked((uint)(long)seed);
            return () =>
            {
                unchecked
                {
                    a += 0x6d2b79f5;
                    var t = a;
                    t = (t ^ (t >> 15)) * (t | 1);
                    t ^= t + (t ^ (t >> 7)) * (t | 61);
                    return (t ^ (t >> 14)) / 4294967296.0;
                }
            };
        }

        private static Dictionary<string, object> TowerOut(Tower t)
        {
            return new Dictionary<string, object> { { "tower", t } };
        }

        private static Tower InTower(Dictionary<string, object> i)
        {
            i.TryGetValue("tower", out var t);
            return (Tower)t;
        }

        private static Context InContext(Dictionary<string, object> i)
        {
            i.TryGetValue("context", out var c);
            return c as Context;
        }

        public static DataType TowerDataType()
        {
            return new DataType
            {
                Name = "tower",
                Is = v => v is Tower,
                Distance = (a, b) => TowerGeometry.Distance((Tower)a, (Tower)b),
            };
        }

        // What a Tower keeps when a loop result is adopted, and how it comes back.
        private static Tower Thaw(object snapshot)
        {
            var s = (Dictionary<string, object>)snapshot;
            var t = new Tower { H = V.Num(s["h"]) };
            foreach (var o in (List<object>)s["floors"])
            {
                var f = (Dictionary<string, object>)o;
                t.Floors.Add(new Floor
                {
                    Z = V.Num(f["z"]), W = V.Num(f["w"]), D = V.Num(f["d"]), Rot = V.Num(f["rot"]),
                    Cx = V.Num(f["cx"]), Cy = V.Num(f["cy"]), Round = V.Num(f["round"]),
                    WindF = 0, Wind = 0, Sun = 1, Util = 0,
                });
            }
            return t;
        }

        /// <summary>The adopt hook of the Tower node: a loop result -> the params to store (a per-floor snapshot).</summary>
        public static Dictionary<string, object> Freeze(Tower t)
        {
            var floors = new List<object>();
            foreach (var f in t.Floors)
                floors.Add(new Dictionary<string, object>
                {
                    { "z", f.Z }, { "w", f.W }, { "d", f.D }, { "rot", f.Rot }, { "cx", f.Cx }, { "cy", f.Cy }, { "round", f.Round },
                });
            return new Dictionary<string, object> { { "h", t.H }, { "floors", floors } };
        }

        // One relaxation step along the height: every floor moves toward the average of its neighbours.
        private static void SmoothFloors(List<Floor> F, double s)
        {
            if (!(s > 0) || F.Count < 3) return;
            Smooth(F, s, f => f.Rot, (f, v) => f.Rot = v);
            Smooth(F, s, f => f.W, (f, v) => f.W = v);
            Smooth(F, s, f => f.D, (f, v) => f.D = v);
            Smooth(F, s, f => f.Round, (f, v) => f.Round = v);
        }

        private static void Smooth(List<Floor> F, double s, Func<Floor, double> get, Action<Floor, double> set)
        {
            var src = F.Select(get).ToArray();
            for (var i = 0; i < F.Count; i++)
            {
                var a = src[Math.Max(0, i - 1)];
                var b = src[Math.Min(F.Count - 1, i + 1)];
                set(F[i], (1 - s) * src[i] + s * 0.5 * (a + b));
            }
        }

        private static readonly string[] ProfileQuantityNames =
        {
            "Wind load", "Wind exposure", "Sun exposure", "Utilisation", "Width", "Depth", "Plate area", "Rotation (deg)", "Roundness",
        };

        private static double ProfileValue(string quantity, Floor f)
        {
            switch (quantity)
            {
                case "Wind load": return f.WindF;
                case "Wind exposure": return f.Wind;
                case "Sun exposure": return f.Sun;
                case "Utilisation": return f.Util;
                case "Width": return f.W;
                case "Depth": return f.D;
                case "Plate area": return TowerGeometry.PlateArea(f);
                case "Rotation (deg)": return f.Rot * 180 / Math.PI;
                case "Roundness": return f.Round;
                default: throw new InvalidOperationException("PROFILE_QUANTITIES[p.quantity] is not a function");
            }
        }

        public static IEnumerable<NodeType> All()
        {
            yield return new NodeType
            {
                Id = "context",
                Outputs = new[] { new Port("context", "Context") },
                Params = new[]
                {
                    ParamDef.Select("style", "Manhattan", "Manhattan", "Dubai"),
                    ParamDef.Num("ring", 3),
                    ParamDef.Num("heightScale", 1),
                    ParamDef.Num("seed", 7),
                },
                Compute = (i, p) =>
                {
                    var rnd = Mulberry32(Math.Floor(p.Num("seed")));
                    var dubai = p.Str("style") == "Dubai";
                    var pitch = dubai ? 150.0 : 72.0;
                    var plot = dubai ? 70.0 : 54.0;
                    var R = (int)Math.Max(1, Math.Floor(p.Num("ring")));
                    var ctx = new Context { Style = p.Str("style"), Pitch = pitch };
                    for (var a = -R; a <= R; a++)
                    {
                        for (var b = -R; b <= R; b++)
                        {
                            if (a == 0 && b == 0) continue; // the site
                            var r = rnd();
                            double h;
                            if (dubai) h = r > 0.78 ? 150 + rnd() * 120 : 12 + rnd() * 50;
                            else h = 25 + Math.Pow(rnd(), 1.6) * 130;
                            var w = plot * (0.7 + rnd() * 0.3);
                            var d = plot * (0.7 + rnd() * 0.3);
                            ctx.Buildings.Add(new Building { X = a * pitch, Y = b * pitch, W = w, D = d, H = h * p.Num("heightScale") });
                        }
                    }
                    return new Dictionary<string, object> { { "context", ctx } };
                },
            };

            yield return new NodeType
            {
                Id = "tower",
                Outputs = new[] { new Port("tower", "Tower") },
                Params = new[]
                {
                    ParamDef.Num("floors", 60),
                    ParamDef.Num("floorH", 4),
                    ParamDef.Num("width", 36),
                    ParamDef.Num("depth", 36),
                    ParamDef.Num("twist", 0),
                    ParamDef.Num("round", 0.2),
                    ParamDef.Select("source", "Initial", "Initial", "Adopted"),
                },
                Compute = (i, p) =>
                {
                    if (p.Str("source") == "Adopted" && p.Raw("snapshot") != null) return TowerOut(Thaw(p.Raw("snapshot")));
                    var n = (int)Math.Max(2, Math.Floor(p.Num("floors")));
                    var t = new Tower { H = p.Num("floorH") };
                    for (var k = 0; k < n; k++)
                        t.Floors.Add(new Floor
                        {
                            Z = k * p.Num("floorH"),
                            W = p.Num("width"),
                            D = p.Num("depth"),
                            Rot = Rad(p.Num("twist") * k / (n - 1)),
                            Cx = 0, Cy = 0,
                            Round = p.Num("round"),
                            WindF = 0, Wind = 0, Sun = 1, Util = 0,
                        });
                    return TowerOut(t);
                },
            };

            yield return new NodeType
            {
                Id = "wind",
                Inputs = new[] { new Port("tower", "Tower"), new Port("context", "Context", true) },
                Outputs = new[] { new Port("tower", "Tower") },
                Params = new[] { ParamDef.Num("speed", 40), ParamDef.Num("from", 300), ParamDef.Num("alpha", 0.25) },
                Compute = (i, p) =>
                {
                    var t = InTower(i).Clone();
                    var context = InContext(i);
                    var up = Bearing(p.Num("from")); // towards the wind source
                    var dir = new Vec(-up.X, -up.Y); // the way the wind travels
                    var perp = new Vec(-up.Y, up.X);
                    t.Env.Wind = new WindEnv { From = p.Num("from"), Speed = p.Num("speed") };
                    foreach (var f in t.Floors)
                    {
                        var zm = f.Z + t.H / 2;
                        Projections(f.W, f.D, f.Rot, dir, out var frontal, out var along);
                        // neighbours upwind and taller than this floor shelter it
                        var shield = 1.0;
                        if (context != null)
                        {
                            foreach (var b in context.Buildings)
                            {
                                if (b.H <= zm) continue;
                                var along2 = b.X * up.X + b.Y * up.Y;
                                if (along2 <= 0 || along2 > 220) continue;
                                var lateral = Math.Abs(b.X * perp.X + b.Y * perp.Y);
                                var bFront = b.W * Math.Abs(perp.X) + b.D * Math.Abs(perp.Y);
                                if (lateral < bFront / 2 + frontal / 2) shield *= 0.78;
                            }
                        }
                        shield = Math.Max(0.3, shield);
                        var ratio = along / Math.Max(frontal, 1e-6);
                        // elongation along the flow and rounded corners both cut the drag
                        var cd = (1.4 - 0.3 * Math.Min(2, Math.Max(0, ratio - 1))) * (1 - 0.35 * f.Round);
                        var q = WindPressure(zm, p.Num("speed"), p.Num("alpha"));
                        f.WindF = q * cd * frontal * t.H * shield; // kN
                        f.Wind = shield;
                    }
                    return TowerOut(t);
                },
            };

            yield return new NodeType
            {
                Id = "orient",
                Inputs = new[] { new Port("tower", "Tower") },
                Outputs = new[] { new Port("tower", "Tower") },
                Params = new[]
                {
                    ParamDef.Num("rate", 0.2),
                    ParamDef.Num("aspect", 1.8),
                    ParamDef.Num("round", 0.8),
                    ParamDef.Num("sunWeight", 0.7),
                    ParamDef.Num("sunAz", 150),
                    ParamDef.Num("minW", 0),
                    ParamDef.Num("minD", 0),
                    ParamDef.Num("minRadius", 0),
                    ParamDef.Num("maxStep", 90),
                    ParamDef.Num("maxTwist", 0),
                    ParamDef.Num("smooth", 0),
                    ParamDef.Select("search", "Grid", "Grid", "Refined"),
                },
                Compute = (i, p) => TowerOut(Orient(InTower(i), p)),
            };

            yield return new NodeType
            {
                Id = "structure",
                Inputs = new[] { new Port("tower", "Tower") },
                Outputs = new[] { new Port("tower", "Tower") },
                Params = new[]
                {
                    ParamDef.Num("allow", 6),
                    ParamDef.Num("load", 10),
                    ParamDef.Num("fraction", 0.08),
                    ParamDef.Num("relax", 0.3),
                    ParamDef.Num("minPlate", 20),
                    ParamDef.Num("maxPlate", 60),
                },
                Compute = (i, p) => TowerOut(Structure(InTower(i), p)),
            };

            yield return new NodeType
            {
                Id = "sun",
                Inputs = new[] { new Port("tower", "Tower"), new Port("context", "Context", true) },
                Outputs = new[] { new Port("tower", "Tower") },
                Params = new[] { ParamDef.Num("azimuth", 150), ParamDef.Num("altitude", 35) },
                Compute = (i, p) => TowerOut(Sun(InTower(i), InContext(i), p)),
            };

            yield return new NodeType
            {
                Id = "metrics",
                Inputs = new[] { new Port("tower", "Tower") },
                Outputs = new[] { new Port("gfa", "Floor area (m2)"), new Port("material", "Structure (m3)"), new Port("moment", "Base moment (MNm)"), new Port("util", "Max utilisation") },
                Compute = (i, p) =>
                {
                    var t = InTower(i);
                    // plain left-to-right sums, in the same order as the JavaScript reduce
                    double gfa = 0, momentSum = 0, util = double.NegativeInfinity;
                    foreach (var f in t.Floors)
                    {
                        gfa += TowerGeometry.PlateArea(f);
                        momentSum += f.WindF * (f.Z + t.H / 2);
                        util = Math.Max(util, f.Util);
                    }
                    var frac = t.Env.Fraction ?? 0.12;
                    var moment = momentSum / 1000;
                    return new Dictionary<string, object>
                    {
                        { "gfa", gfa }, { "material", gfa * frac * t.H }, { "moment", moment }, { "util", util },
                    };
                },
            };

            // ---- adapters: a tower or a context becomes the plain lists the analysis pack works on ----

            // one value per floor, bottom to top, plus the mid-height of each floor; rotation in degrees
            yield return new NodeType
            {
                Id = "profile",
                Inputs = new[] { new Port("tower", "Tower") },
                Outputs = new[] { new Port("values", "Values"), new Port("z", "Heights (m)") },
                Params = new[] { ParamDef.Select("quantity", "Wind load", ProfileQuantityNames) },
                Compute = (i, p) =>
                {
                    var t = InTower(i);
                    var q = p.Str("quantity");
                    var values = new List<object>();
                    var z = new List<object>();
                    foreach (var f in t.Floors)
                    {
                        values.Add(ProfileValue(q, f));
                        z.Add(f.Z + t.H / 2);
                    }
                    return new Dictionary<string, object> { { "values", values }, { "z", z } };
                },
            };

            // the slab outline of one floor as a point list; the index is clamped, so a large one means the top floor
            yield return new NodeType
            {
                Id = "outline",
                Inputs = new[] { new Port("tower", "Tower") },
                Outputs = new[] { new Port("points", "Points") },
                Params = new[] { ParamDef.Num("floor", 0) },
                Compute = (i, p) =>
                {
                    var t = InTower(i);
                    var idx = (int)Math.Min(t.Floors.Count - 1, Math.Max(0, Math.Floor(p.Num("floor"))));
                    var ring = TowerGeometry.RingPoints(t.Floors[idx]);
                    var pts = new List<object>();
                    foreach (var r in ring) pts.Add(new List<object> { r[0], r[1] });
                    return new Dictionary<string, object> { { "points", pts } };
                },
            };

            // every neighbouring building as a 2D Gaussian splat
            yield return new NodeType
            {
                Id = "splats",
                Inputs = new[] { new Port("context", "Context") },
                Outputs = new[] { new Port("splats", "Splats") },
                Params = new[] { ParamDef.Num("hRef", 150) },
                Compute = (i, p) =>
                {
                    var c = InContext(i);
                    var list = new List<object>();
                    foreach (var b in c.Buildings)
                        list.Add(new Dictionary<string, object>
                        {
                            { "x", b.X }, { "y", b.Y }, { "sx", b.W / 4 }, { "sy", b.D / 4 }, { "rot", 0.0 },
                            { "opacity", Math.Min(1, b.H / p.Num("hRef")) }, { "depth", -b.H }, { "value", b.H },
                        });
                    return new Dictionary<string, object> { { "splats", list } };
                },
            };

            yield return new NodeType
            {
                Id = "viewer",
                Inputs = new[] { new Port("tower", "Tower"), new Port("context", "Context", true), new Port("history", "History", true) },
                Params = new[]
                {
                    ParamDef.Select("color", "Utilisation", MetricNames),
                    ParamDef.Select("cmap", "Turbo", ColormapNames),
                    ParamDef.Select("range", "Auto", "Auto", "Manual"),
                    ParamDef.Num("min", 0),
                    ParamDef.Num("max", 1),
                    ParamDef.Select("reverse", "No", "No", "Yes"),
                },
            };
        }

        // Per floor: search candidate rotations of the slab outline and move toward the best one.
        // The score trades wind load against how squarely the long facade faces the sun. Floors that
        // carry more wind adapt faster and round their corners, so the loft grades along the height.
        private static Tower Orient(Tower tower, Params p)
        {
            var t = tower.Clone();
            var limits = new Limits { MinW = p.Num("minW"), MinD = p.Num("minD"), MinRadius = p.Num("minRadius") };
            t.Env.Limits = limits;
            var prevRot = t.Floors.Select(f => f.Rot).ToArray();
            var wind = t.Env.Wind;
            if (wind == null)
            {
                foreach (var f in t.Floors) TowerGeometry.ClampFloor(f, limits);
                return t;
            }
            var up = Bearing(wind.From);
            var dir = new Vec(-up.X, -up.Y);
            var sun = Bearing(p.Num("sunAz"));
            var fmax = 1e-9;
            foreach (var f in t.Floors) fmax = Math.Max(fmax, f.WindF);
            const int K = 36;
            var refined = p.Str("search") == "Refined";
            var costs = new double[K + 1];

            foreach (var f in t.Floors)
            {
                var loadFrac = f.WindF / fmax;
                var best = f.Rot;
                var bestCost = double.PositiveInfinity;
                var bestC = K / 2;
                var refDim = Math.Sqrt(f.W * f.D);
                for (var c = 0; c <= K; c++)
                {
                    var th = f.Rot + ((double)c / K - 0.5) * Math.PI;
                    Projections(f.W, f.D, th, dir, out var frontal, out var along);
                    var cd = (1.4 - 0.3 * Math.Min(2, Math.Max(0, along / frontal - 1))) * (1 - 0.35 * f.Round);
                    var windCost = f.Wind * (cd * frontal / (1.4 * refDim));
                    // normal of the longer facade: local y when w is the long side
                    var n = f.W >= f.D ? new Vec(-Math.Sin(th), Math.Cos(th)) : new Vec(Math.Cos(th), Math.Sin(th));
                    var sunCost = 1 - Math.Abs(n.X * sun.X + n.Y * sun.Y);
                    var cost = windCost + p.Num("sunWeight") * sunCost + 0.02 * (Math.Abs(th - f.Rot) / (Math.PI / 2));
                    costs[c] = cost;
                    if (cost < bestCost)
                    {
                        bestCost = cost;
                        best = th;
                        bestC = c;
                    }
                }
                // Refined: place the minimum between grid points so floors stop hopping from one
                // candidate to the next, which is what keeps a smoothed loop from settling.
                if (refined && bestC > 0 && bestC < K)
                {
                    var a = costs[bestC - 1];
                    var b = costs[bestC];
                    var d = costs[bestC + 1];
                    var den = a - 2 * b + d;
                    if (den > 1e-12)
                    {
                        var delta = Math.Max(-0.5, Math.Min(0.5, 0.5 * (a - d) / den));
                        best = f.Rot + ((bestC + delta) / K - 0.5) * Math.PI;
                    }
                }
                var k = p.Num("rate") * (0.3 + 0.7 * loadFrac);
                f.Rot += k * (best - f.Rot);
                var area = f.W * f.D;
                f.W += k * (Math.Sqrt(area * p.Num("aspect")) - f.W);
                f.D += k * (Math.Sqrt(area / p.Num("aspect")) - f.D);
                f.Round += k * (p.Num("round") * loadFrac - f.Round);
            }

            // Neighbour averaging first, then the hard limits, so a limit is never undone by smoothing.
            SmoothFloors(t.Floors, p.Num("smooth"));
            var step = Rad(Math.Min(90, Math.Max(0, p.Num("maxStep"))));
            for (var i = 0; i < t.Floors.Count; i++)
            {
                var f = t.Floors[i];
                f.Rot = prevRot[i] + Math.Max(-step, Math.Min(step, f.Rot - prevRot[i]));
            }
            if (p.Num("maxTwist") > 0)
            {
                var lim = Rad(p.Num("maxTwist"));
                var baseRot = t.Floors[0].Rot;
                foreach (var f in t.Floors) f.Rot = baseRot + Math.Max(-lim, Math.Min(lim, f.Rot - baseRot));
            }
            foreach (var f in t.Floors) TowerGeometry.ClampFloor(f, limits);
            return t;
        }

        // Sizes each plate for axial load plus wind overturning, between a minimum and a maximum.
        private static Tower Structure(Tower tower, Params p)
        {
            var t = tower.Clone();
            var F = t.Floors;
            var n = F.Count;
            var allowKpa = p.Num("allow") * 1000;
            // suffix sums for the axial load and the wind moment about each floor
            var axial = new double[n];
            var moment = new double[n];
            double sumN = 0, sumF = 0, sumFz = 0;
            for (var i = n - 1; i >= 0; i--)
            {
                var zm = F[i].Z + t.H / 2;
                sumN += p.Num("load") * TowerGeometry.PlateArea(F[i]);
                sumF += F[i].WindF;
                sumFz += F[i].WindF * zm;
                axial[i] = sumN;
                moment[i] = sumFz - F[i].Z * sumF;
            }
            t.Env.Allow = allowKpa;
            t.Env.Fraction = p.Num("fraction");
            for (var i = 0; i < n; i++)
            {
                var f = F[i];
                var area = TowerGeometry.PlateArea(f);
                var depth = Math.Max(f.D, 1);
                var demand = axial[i] + 6 * moment[i] / depth; // kN
                var req = demand / (p.Num("fraction") * allowKpa);
                var lo = p.Num("minPlate") * p.Num("minPlate");
                var hi = p.Num("maxPlate") * p.Num("maxPlate");
                var target = Math.Min(hi, Math.Max(lo, req));
                var next = area + p.Num("relax") * (target - area);
                var s = Math.Sqrt(next / area);
                f.W *= s;
                f.D *= s;
                TowerGeometry.ClampFloor(f, t.Env.Limits); // Orient's size limits hold after resizing too
                f.Util = demand / (p.Num("fraction") * TowerGeometry.PlateArea(f) * allowKpa);
            }
            return t;
        }

        // Per-floor sun exposure, shaded by the context (a slab test against each neighbour's box).
        private static Tower Sun(Tower tower, Context context, Params p)
        {
            var t = tower.Clone();
            var dir = Bearing(p.Num("azimuth"));
            var slope = Math.Tan(Rad(p.Num("altitude")));
            t.Env.Sun = new SunEnv { Azimuth = p.Num("azimuth"), Altitude = p.Num("altitude") };
            foreach (var f in t.Floors)
            {
                var zm = f.Z + t.H / 2;
                var c = Math.Cos(f.Rot);
                var s = Math.Sin(f.Rot);
                var samples = new[]
                {
                    new Vec(0, 0),
                    new Vec(f.W / 2, f.D / 2),
                    new Vec(-f.W / 2, f.D / 2),
                    new Vec(f.W / 2, -f.D / 2),
                    new Vec(-f.W / 2, -f.D / 2),
                };
                var lit = 0;
                foreach (var sample in samples)
                {
                    var ox = f.Cx + sample.X * c - sample.Y * s;
                    var oy = f.Cy + sample.X * s + sample.Y * c;
                    var blocked = false;
                    if (context != null)
                    {
                        foreach (var b in context.Buildings)
                        {
                            // distance along the ray to the near face of the box (slab test)
                            double t0 = 0;
                            double t1 = double.PositiveInfinity;
                            bool Slab(double origin, double d, double lo, double hi)
                            {
                                if (Math.Abs(d) < 1e-9) return origin >= lo && origin <= hi;
                                var a = (lo - origin) / d;
                                var bb = (hi - origin) / d;
                                if (a > bb) { var tmp = a; a = bb; bb = tmp; }
                                t0 = Math.Max(t0, a);
                                t1 = Math.Min(t1, bb);
                                return t0 <= t1;
                            }
                            if (Slab(ox, dir.X, b.X - b.W / 2, b.X + b.W / 2) &&
                                Slab(oy, dir.Y, b.Y - b.D / 2, b.Y + b.D / 2) &&
                                t1 > 0 &&
                                b.H > zm + t0 * slope)
                            {
                                blocked = true;
                                break;
                            }
                        }
                    }
                    if (!blocked) lit++;
                }
                f.Sun = lit / (double)samples.Length;
            }
            return t;
        }
    }
}
