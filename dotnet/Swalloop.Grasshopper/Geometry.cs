using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Rhino.Geometry;
using Swalloop.Core;
using Swalloop.Core.Packs;

namespace Swalloop.GH
{
    /// <summary>Engine values as Rhino geometry, so a definition can be seen in the viewport.</summary>
    public static class Geo
    {
        private static readonly int[][] Stops =
        {
            new[] { 18, 32, 74 }, new[] { 31, 120, 150 }, new[] { 70, 170, 110 }, new[] { 225, 205, 80 }, new[] { 215, 70, 50 },
        };

        /// <summary>dark blue -> teal -> green -> yellow -> red, the same ramp as the editor's heatmap.</summary>
        public static Color Ramp(double t)
        {
            var x = Math.Min(1, Math.Max(0, double.IsNaN(t) ? 0 : t)) * (Stops.Length - 1);
            var i = Math.Min(Stops.Length - 2, (int)Math.Floor(x));
            var f = x - i;
            int C(int k) { return (int)Math.Round(Stops[i][k] + (Stops[i + 1][k] - Stops[i][k]) * f); }
            return Color.FromArgb(C(0), C(1), C(2));
        }

        public static PolylineCurve Outline(IEnumerable<double[]> pts, double z)
        {
            var list = pts.Select(p => new Point3d(p[0], p[1], z)).ToList();
            list.Add(list[0]);
            return new PolylineCurve(list);
        }

        /// <summary>One closed outline per floor, at the floor's height: the same curves the editor lofts.</summary>
        public static List<Curve> FloorCurves(Tower t)
        {
            return t.Floors.Select(f => (Curve)Outline(TowerGeometry.RingPoints(f), f.Z)).ToList();
        }

        /// <summary>The tower as a quad mesh between consecutive floor outlines, coloured per floor.</summary>
        public static Mesh LoftMesh(Tower t, double[] values, double lo, double hi, bool reverse)
        {
            var mesh = new Mesh();
            var n = TowerGeometry.RingN;
            foreach (var (f, i) in t.Floors.Select((f, i) => (f, i)))
            {
                var tt = hi > lo ? (values[i] - lo) / (hi - lo) : 0;
                var c = Ramp(reverse ? 1 - tt : tt);
                foreach (var p in TowerGeometry.RingPoints(f))
                {
                    mesh.Vertices.Add(p[0], p[1], f.Z);
                    mesh.VertexColors.Add(c);
                }
            }
            for (var i = 0; i + 1 < t.Floors.Count; i++)
                for (var k = 0; k < n; k++)
                {
                    var a = i * n + k;
                    var b = i * n + (k + 1) % n;
                    mesh.Faces.AddFace(a, b, b + n, a + n);
                }
            mesh.Normals.ComputeNormals();
            mesh.Compact();
            return mesh;
        }

        public static List<Mesh> ContextBoxes(Context c)
        {
            var list = new List<Mesh>();
            foreach (var b in c.Buildings)
            {
                var box = new Box(Plane.WorldXY,
                    new Interval(b.X - b.W / 2, b.X + b.W / 2),
                    new Interval(b.Y - b.D / 2, b.Y + b.D / 2),
                    new Interval(0, b.H));
                list.Add(Mesh.CreateFromBox(box, 1, 1, 1));
            }
            return list;
        }

        /// <summary>A splat field as a flat, vertex-coloured quad mesh, north up, centred on the origin.</summary>
        public static Mesh GridMesh(Dictionary<string, object> grid)
        {
            var n = (int)V.Num(grid["n"]);
            var extent = V.Num(grid["extent"]);
            var rows = (List<object>)grid["values"];
            var cell = 2 * extent / n;
            double lo = double.PositiveInfinity, hi = double.NegativeInfinity;
            foreach (List<object> r in rows)
                foreach (var v in r)
                {
                    var d = V.Num(v);
                    lo = Math.Min(lo, d);
                    hi = Math.Max(hi, d);
                }
            var mesh = new Mesh();
            for (var j = 0; j < n; j++)
            {
                var row = (List<object>)rows[j];
                for (var i = 0; i < n; i++)
                {
                    var x = -extent + i * cell;
                    var y = -extent + j * cell;
                    var c = Ramp(hi > lo ? (V.Num(row[i]) - lo) / (hi - lo) : 0);
                    // one flat quad per cell, so each cell keeps its own colour
                    var b = mesh.Vertices.Count;
                    mesh.Vertices.Add(x, y, 0);
                    mesh.Vertices.Add(x + cell, y, 0);
                    mesh.Vertices.Add(x + cell, y + cell, 0);
                    mesh.Vertices.Add(x, y + cell, 0);
                    for (var q = 0; q < 4; q++) mesh.VertexColors.Add(c);
                    mesh.Faces.AddFace(b, b + 1, b + 2, b + 3);
                }
            }
            mesh.Normals.ComputeNormals();
            return mesh;
        }

        /// <summary>Everything in an engine value that has a shape. dz stacks a list of outlines like floors.</summary>
        public static List<GeometryBase> Of(object v, double dz)
        {
            var g = new List<GeometryBase>();
            switch (v)
            {
                case Tower t:
                    g.AddRange(FloorCurves(t));
                    break;
                case Context c:
                    g.AddRange(ContextBoxes(c));
                    break;
                case Dictionary<string, object> d when d.TryGetValue("kind", out var k) && (k as string) == "grid":
                    g.Add(GridMesh(d));
                    break;
                case List<object> l when l.Count > 0 && Interop.IsPoints(l):
                    g.Add(Outline(AnalysisNodes.ToPoints(l), 0));
                    break;
                case List<object> l when l.Count > 0 && l.All(x => x is List<object> p && p.Count >= 3 && Interop.IsPoints(p)):
                    for (var i = 0; i < l.Count; i++) g.Add(Outline(AnalysisNodes.ToPoints(l[i]), i * dz));
                    break;
            }
            return g;
        }
    }
}
