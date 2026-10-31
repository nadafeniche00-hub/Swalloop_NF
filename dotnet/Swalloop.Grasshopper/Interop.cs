using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Grasshopper.Kernel.Types;
using Swalloop.Core;
using Swalloop.Core.Packs;

namespace Swalloop.GH
{
    /// <summary>
    /// Carries an engine value (a tower, a context, a matrix, splats, a history...) along a Grasshopper
    /// wire. Numbers, booleans and text travel as Grasshopper's own types; this is for everything else.
    /// Engine values are never mutated, so duplicating a goo can share the value.
    /// </summary>
    public sealed class EngineGoo : GH_Goo<object>
    {
        public EngineGoo() { }
        public EngineGoo(object value) { Value = value; }

        public override bool IsValid { get { return Value != null; } }
        public override string TypeName { get { return Interop.TypeName(Value); } }
        public override string TypeDescription { get { return "A value from the Swalloop engine"; } }
        public override IGH_Goo Duplicate() { return new EngineGoo(Value); }
        public override string ToString() { return Interop.Describe(Value); }
    }

    /// <summary>Conversions between Grasshopper data and engine values.</summary>
    public static class Interop
    {
        /// <summary>A Grasshopper item as the engine sees it. Null stays null.</summary>
        public static object FromGoo(IGH_Goo g)
        {
            switch (g)
            {
                case null: return null;
                case EngineGoo e: return e.Value;
                case GH_Number n: return n.Value;
                case GH_Integer i: return (double)i.Value;
                case GH_Boolean b: return b.Value;
                case GH_String s: return s.Value;
                case GH_ObjectWrapper w:
                    return w.Value is IGH_Goo inner ? FromGoo(inner) : w.Value;
                default:
                    if (g.CastTo(out double d)) return d;
                    if (g.CastTo(out string str)) return str;
                    return g.ScriptVariable();
            }
        }

        /// <summary>An engine value as Grasshopper data: native types where there are any.</summary>
        public static IGH_Goo ToGoo(object v)
        {
            switch (v)
            {
                case null: return null;
                case double d: return new GH_Number(d);
                case bool b: return new GH_Boolean(b);
                case string s: return new GH_String(s);
                case IGH_Goo g: return g;
                default: return new EngineGoo(v);
            }
        }

        /// <summary>
        /// A list input from Grasshopper items. A single item that already wraps a whole list (a Swalloop
        /// list passed through a native component) is that list; otherwise each item is one element.
        /// </summary>
        public static List<object> ListFromGoos(IList<IGH_Goo> goos)
        {
            if (goos.Count == 1 && FromGoo(goos[0]) is List<object> whole) return whole;
            var list = new List<object>(goos.Count);
            foreach (var g in goos)
            {
                var v = FromGoo(g);
                if (v != null) list.Add(v);
            }
            return list;
        }

        /// <summary>One item is a single value; several items are the list of them.</summary>
        public static object ValueFromGoos(IList<IGH_Goo> goos)
        {
            if (goos.Count == 0) return null;
            if (goos.Count == 1) return FromGoo(goos[0]);
            return ListFromGoos(goos);
        }

        public static List<object> ToObjectList(IEnumerable<double> xs)
        {
            return xs.Select(x => (object)x).ToList();
        }

        public static bool IsNumberList(object v)
        {
            return v is List<object> l && l.Count > 0 && l.All(x => x is double);
        }

        public static string TypeName(object v)
        {
            switch (v)
            {
                case null: return "Nothing";
                case double _: return "Number";
                case bool _: return "Boolean";
                case string _: return "Text";
                case Tower _: return "Tower";
                case Context _: return "Context";
                case Dictionary<string, object> r when r.TryGetValue("kind", out var k) && (k as string) == "grid": return "Splat field";
                case Dictionary<string, object> r when r.ContainsKey("frames"): return "History";
                case List<object> l:
                    if (l.Count > 0 && l[0] is Dictionary<string, object>) return "Splats";
                    if (l.Count > 0 && l.All(x => x is List<object> row && row.Count > 0 && row.All(y => y is double)))
                        return IsMatrix(l) ? "Matrix" : (IsPoints(l) ? "Points" : "List of lists");
                    return "List";
                default: return v.GetType().Name;
            }
        }

        public static bool IsMatrix(List<object> l)
        {
            var w = ((List<object>)l[0]).Count;
            return l.Count <= 4 && w <= 4 && l.All(r => ((List<object>)r).Count == w) && w >= 3;
        }

        public static bool IsPoints(List<object> l)
        {
            return l.All(r => r is List<object> p && p.Count == 2 && p.All(y => y is double));
        }

        /// <summary>A short, readable summary for panels and tooltips.</summary>
        public static string Describe(object v)
        {
            var inv = CultureInfo.InvariantCulture;
            switch (v)
            {
                case null: return "(nothing)";
                case double d: return d.ToString("0.####", inv);
                case bool b: return b ? "True" : "False";
                case string s: return s;
                case Tower t:
                    return "Tower, " + t.Floors.Count + " floors, " + t.H.ToString("0.#", inv) + " m each";
                case Context c:
                    return "Context (" + c.Style + "), " + c.Buildings.Count + " buildings";
                case Dictionary<string, object> r when r.TryGetValue("kind", out var k) && (k as string) == "grid":
                    return "Splat field " + r["n"] + " x " + r["n"] + ", " + (2 * V.Num(r["extent"])).ToString("0", inv) + " m across";
                case Dictionary<string, object> r when r.ContainsKey("frames"):
                    return "History, " + r["count"] + " of " + r["max"] + " passes, " + ((List<object>)r["frames"]).Count + " frames";
                case List<object> l:
                    if (l.Count == 0) return "Empty list";
                    if (IsNumberList(l))
                    {
                        var head = string.Join(", ", l.Take(5).Select(x => ((double)x).ToString("0.###", inv)));
                        return "List of " + l.Count + " numbers: " + head + (l.Count > 5 ? ", ..." : "");
                    }
                    return TypeName(v) + " of " + l.Count;
                default: return v.ToString();
            }
        }
    }
}
