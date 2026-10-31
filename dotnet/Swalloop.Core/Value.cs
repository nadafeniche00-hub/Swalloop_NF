using System;
using System.Collections.Generic;

namespace Swalloop.Core
{
    /// <summary>
    /// Values that flow through a graph are plain objects, as in the JavaScript engine:
    /// double, bool, string, List&lt;object&gt;, Dictionary&lt;string, object&gt;, or a pack's own class
    /// (Tower, Context). A missing value is null (JavaScript's undefined).
    /// </summary>
    public static class V
    {
        /// <summary>JavaScript truthiness, for conditions.</summary>
        public static bool Truthy(object v)
        {
            if (v == null) return false;
            if (v is bool b) return b;
            if (v is double d) return d != 0 && !double.IsNaN(d);
            if (v is string s) return s.Length > 0;
            return true;
        }

        /// <summary>A number the way JavaScript would read it; NaN when it is not one.</summary>
        public static double Num(object v)
        {
            if (v is double d) return d;
            if (v is int i) return i;
            if (v is bool b) return b ? 1 : 0;
            return double.NaN;
        }

        /// <summary>Math.round in JavaScript: halves round up.</summary>
        public static double JsRound(double x) { return Math.Floor(x + 0.5); }
    }

    /// <summary>The parameters of one node: numbers, strings and the like, by id.</summary>
    public sealed class Params : Dictionary<string, object>
    {
        public Params() { }
        public Params(IDictionary<string, object> src) : base(src) { }

        public double Num(string id)
        {
            return TryGetValue(id, out var v) ? V.Num(v) : double.NaN;
        }

        public string Str(string id)
        {
            return TryGetValue(id, out var v) ? v as string : null;
        }

        public object Raw(string id)
        {
            return TryGetValue(id, out var v) ? v : null;
        }

        public Params Clone() { return new Params(this); }
    }
}
