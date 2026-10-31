using System;
using System.Collections.Generic;

namespace Swalloop.Core.Packs
{
    /// <summary>One slab: a rotated, rounded rectangle at height Z. Mirrors a floor record in the JS pack.</summary>
    public sealed class Floor
    {
        public double Z, W, D, Rot, Cx, Cy, Round;
        public double WindF; // wind force on the floor (kN)
        public double Wind;  // shelter factor, 1 = fully exposed
        public double Sun;   // lit fraction
        public double Util;  // structural utilisation

        public Floor Clone() { return (Floor)MemberwiseClone(); }
    }

    public sealed class WindEnv { public double From, Speed; }
    public sealed class SunEnv { public double Azimuth, Altitude; }

    /// <summary>Hard size limits set by Orient. 0 = off.</summary>
    public sealed class Limits { public double MinW, MinD, MinRadius; }

    /// <summary>What earlier nodes recorded about the site and the structure.</summary>
    public sealed class TowerEnv
    {
        public WindEnv Wind;
        public SunEnv Sun;
        public Limits Limits;
        public double? Allow;    // kPa
        public double? Fraction; // structural share

        public TowerEnv Clone() { return (TowerEnv)MemberwiseClone(); }
    }

    public sealed class Tower
    {
        public double H; // floor height
        public TowerEnv Env = new TowerEnv();
        public List<Floor> Floors = new List<Floor>();

        public Tower Clone()
        {
            var t = new Tower { H = H, Env = Env.Clone() };
            foreach (var f in Floors) t.Floors.Add(f.Clone());
            return t;
        }
    }

    public sealed class Building { public double X, Y, W, D, H; }

    public sealed class Context
    {
        public string Style;
        public double Pitch;
        public List<Building> Buildings = new List<Building>();
    }

    public static class TowerGeometry
    {
        /// <summary>Plate area, a little under the bounding box once the corners round off.</summary>
        public static double PlateArea(Floor f) { return f.W * f.D * (1 - 0.215 * f.Round); }

        /// <summary>
        /// Hard limits a floor must respect. Orient sets them, and every node that resizes a floor
        /// afterwards re-applies them. The corner radius is roundness x half of the shorter side.
        /// </summary>
        public static void ClampFloor(Floor f, Limits lim)
        {
            if (lim == null) return;
            if (lim.MinW > 0) f.W = Math.Max(f.W, lim.MinW);
            if (lim.MinD > 0) f.D = Math.Max(f.D, lim.MinD);
            if (lim.MinRadius > 0)
            {
                var half = Math.Max(Math.Min(f.W, f.D) / 2, 1e-9);
                f.Round = Math.Min(1, Math.Max(f.Round, lim.MinRadius / half));
            }
        }

        public static double CornerRadius(Floor f) { return f.Round * (Math.Min(f.W, f.D) / 2); }

        /// <summary>Points on every floor outline, so the floors can be lofted.</summary>
        public const int RingN = 64;

        public static double SuperExponent(double round)
        {
            return 2 + 18 * Math.Pow(1 - Math.Min(1, Math.Max(0, round)), 1.5);
        }

        /// <summary>
        /// The slab outline: a closed superellipse |x/a|^n + |y/b|^n = 1 sampled at RingN points.
        /// Round runs from 0 (rounded rectangle) to 1 (ellipse); the outline is turned by Rot about
        /// the tower axis. Returns plan coordinates (x, y); the height is Floor.Z.
        /// </summary>
        public static double[][] RingPoints(Floor f)
        {
            var e = 2 / SuperExponent(f.Round);
            var c = Math.Cos(f.Rot);
            var s = Math.Sin(f.Rot);
            var pts = new double[RingN][];
            for (var k = 0; k < RingN; k++)
            {
                var t = (double)k / RingN * Math.PI * 2;
                var ct = Math.Cos(t);
                var st = Math.Sin(t);
                var x = f.W / 2 * Math.Sign(ct) * Math.Pow(Math.Abs(ct), e);
                var y = f.D / 2 * Math.Sign(st) * Math.Pow(Math.Abs(st), e);
                pts[k] = new[] { f.Cx + x * c - y * s, f.Cy + x * s + y * c };
            }
            return pts;
        }

        /// <summary>How far apart two towers are, in metres: the largest movement of any floor.</summary>
        public static double Distance(Tower a, Tower b)
        {
            if (a.Floors.Count != b.Floors.Count) return double.PositiveInfinity;
            double m = 0;
            for (var i = 0; i < a.Floors.Count; i++)
            {
                var p = a.Floors[i];
                var q = b.Floors[i];
                var r = Math.Max(Math.Max(p.W, p.D), Math.Max(q.W, q.D)) / 2;
                m = Math.Max(m, Math.Abs(p.W - q.W));
                m = Math.Max(m, Math.Abs(p.D - q.D));
                m = Math.Max(m, Math.Abs(p.Cx - q.Cx));
                m = Math.Max(m, Math.Abs(p.Cy - q.Cy));
                m = Math.Max(m, Math.Abs(p.Rot - q.Rot) * r);
                m = Math.Max(m, Math.Abs(p.Round - q.Round) * r);
            }
            return m;
        }
    }
}
