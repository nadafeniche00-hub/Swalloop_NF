using System;
using System.Collections.Generic;
using Swalloop.Core.Packs;

namespace Swalloop.Core
{
    /// <summary>
    /// Turns engine values into the same plain tree the JavaScript dump writes
    /// (scripts/dump-golden.mjs): numbers, strings, booleans, null, lists and records.
    /// </summary>
    public static class Normalizer
    {
        public static object ToTree(object v)
        {
            switch (v)
            {
                case null: return null;
                case bool _:
                case string _: return v;
                case double d:
                    if (double.IsNaN(d)) return "NaN";
                    if (double.IsPositiveInfinity(d)) return "Infinity";
                    if (double.IsNegativeInfinity(d)) return "-Infinity";
                    return d;
                case int i: return (double)i;
                case Tower t: return TowerTree(t);
                case Context c: return ContextTree(c);
                case List<object> l:
                {
                    var o = new List<object>(l.Count);
                    foreach (var x in l) o.Add(ToTree(x));
                    return o;
                }
                case Dictionary<string, object> r:
                {
                    var o = new Dictionary<string, object>();
                    foreach (var kv in r) o[kv.Key] = ToTree(kv.Value);
                    return o;
                }
                default: throw new ArgumentException("Cannot normalise " + v.GetType().Name);
            }
        }

        private static Dictionary<string, object> TowerTree(Tower t)
        {
            var env = new Dictionary<string, object>();
            if (t.Env.Wind != null) env["wind"] = new Dictionary<string, object> { { "from", t.Env.Wind.From }, { "speed", t.Env.Wind.Speed } };
            if (t.Env.Sun != null) env["sun"] = new Dictionary<string, object> { { "azimuth", t.Env.Sun.Azimuth }, { "altitude", t.Env.Sun.Altitude } };
            if (t.Env.Limits != null)
                env["limits"] = new Dictionary<string, object>
                {
                    { "minW", t.Env.Limits.MinW }, { "minD", t.Env.Limits.MinD }, { "minRadius", t.Env.Limits.MinRadius },
                };
            if (t.Env.Allow.HasValue) env["allow"] = t.Env.Allow.Value;
            if (t.Env.Fraction.HasValue) env["fraction"] = t.Env.Fraction.Value;

            var floors = new List<object>();
            foreach (var f in t.Floors)
                floors.Add(new Dictionary<string, object>
                {
                    { "z", f.Z }, { "w", f.W }, { "d", f.D }, { "rot", f.Rot }, { "cx", f.Cx }, { "cy", f.Cy },
                    { "round", f.Round }, { "windF", f.WindF }, { "wind", f.Wind }, { "sun", f.Sun }, { "util", f.Util },
                });
            return new Dictionary<string, object> { { "h", t.H }, { "env", env }, { "floors", floors } };
        }

        private static Dictionary<string, object> ContextTree(Context c)
        {
            var b = new List<object>();
            foreach (var x in c.Buildings)
                b.Add(new Dictionary<string, object> { { "x", x.X }, { "y", x.Y }, { "w", x.W }, { "d", x.D }, { "h", x.H } });
            return new Dictionary<string, object> { { "style", c.Style }, { "pitch", c.Pitch }, { "buildings", b } };
        }

        /// <summary>History records are summarised the way the dump does, to keep the golden files small.</summary>
        public static object Output(string port, object value, object result)
        {
            if (port == "history" && value is Dictionary<string, object> h && h.TryGetValue("frames", out var fr) && fr is List<object> frames)
            {
                var last = frames.Count > 0 ? frames[frames.Count - 1] : null;
                return new Dictionary<string, object>
                {
                    { "count", h["count"] },
                    { "max", h["max"] },
                    { "frames", (double)frames.Count },
                    { "lastEqualsResult", TreeEquals(ToTree(last), ToTree(result)) },
                };
            }
            return ToTree(value);
        }

        public static bool TreeEquals(object a, object b)
        {
            if (a == null || b == null) return a == null && b == null;
            if (a is double x && b is double y) return x == y;
            if (a is List<object> la && b is List<object> lb)
            {
                if (la.Count != lb.Count) return false;
                for (var i = 0; i < la.Count; i++) if (!TreeEquals(la[i], lb[i])) return false;
                return true;
            }
            if (a is Dictionary<string, object> da && b is Dictionary<string, object> db)
            {
                if (da.Count != db.Count) return false;
                foreach (var kv in da)
                    if (!db.TryGetValue(kv.Key, out var o) || !TreeEquals(kv.Value, o)) return false;
                return true;
            }
            return a.Equals(b);
        }
    }
}
