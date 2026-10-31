using System;

namespace Swalloop.Core.Packs
{
    /// <summary>
    /// Plain numerical routines for the analysis pack. A port of src/packs/analysis/numeric.js: the same
    /// algorithms, in the same order of operations, so the two engines agree to rounding.
    /// </summary>
    public static class Numeric
    {
        private const double TwoPi = Math.PI * 2;

        /// <summary>Discrete Fourier transform of a complex sequence, O(n^2). sign -1 forward, +1 inverse (unscaled).</summary>
        public static void Dft(double[] re, double[] im, int sign, out double[] outRe, out double[] outIm)
        {
            var n = re.Length;
            outRe = new double[n];
            outIm = new double[n];
            for (var k = 0; k < n; k++)
            {
                double sr = 0, si = 0;
                for (var t = 0; t < n; t++)
                {
                    var a = sign * TwoPi * ((k * t) % n) / n;
                    var c = Math.Cos(a);
                    var s = Math.Sin(a);
                    sr += re[t] * c - im[t] * s;
                    si += re[t] * s + im[t] * c;
                }
                outRe[k] = sr;
                outIm[k] = si;
            }
        }

        /// <summary>Frequency index of coefficient k seen from zero: 0, 1, ..., n/2, ..., 1.</summary>
        public static int Harmonic(int k, int n) { return Math.Min(k, n - k); }

        /// <summary>Keeps the harmonics up to keep (both signs). retained = energy share kept, DC excluded.</summary>
        public static void Lowpass(double[] re, double[] im, int keep, out double[] outRe, out double[] outIm, out double retained)
        {
            var n = re.Length;
            outRe = new double[n];
            outIm = new double[n];
            double total = 0, kept = 0;
            for (var k = 0; k < n; k++)
            {
                var e = re[k] * re[k] + im[k] * im[k];
                var pass = Harmonic(k, n) <= keep;
                if (k > 0)
                {
                    total += e;
                    if (pass) kept += e;
                }
                outRe[k] = pass ? re[k] : 0;
                outIm[k] = pass ? im[k] : 0;
            }
            retained = total > 0 ? kept / total : 1;
        }

        /// <summary>Product of two matrices (arrays of rows). Sums run k = 0, 1, 2, ... so the order is fixed.</summary>
        public static double[][] Matmul(double[][] a, double[][] b)
        {
            var m = a.Length;
            var k = a[0].Length;
            if (b.Length != k)
                throw new InvalidOperationException("Cannot multiply a " + m + "x" + k + " matrix by a " + b.Length + "x" + b[0].Length + " matrix");
            var n = b[0].Length;
            var result = new double[m][];
            for (var i = 0; i < m; i++)
            {
                var row = new double[n];
                for (var j = 0; j < n; j++)
                {
                    double s = 0;
                    for (var t = 0; t < k; t++) s += a[i][t] * b[t][j];
                    row[j] = s;
                }
                result[i] = row;
            }
            return result;
        }

        public static double[][] Identity(int n)
        {
            var m = new double[n][];
            for (var i = 0; i < n; i++)
            {
                m[i] = new double[n];
                m[i][i] = 1;
            }
            return m;
        }

        /// <summary>Integer power by repeated squaring.</summary>
        public static double[][] Matpow(double[][] m, double k)
        {
            var e = Math.Max(0, Math.Floor(k));
            var result = Identity(m.Length);
            var b = m;
            while (e > 0)
            {
                if (e % 2 == 1) result = Matmul(result, b);
                e = Math.Floor(e / 2);
                if (e > 0) b = Matmul(b, b);
            }
            return result;
        }

        private static double Rad(double deg) { return deg * Math.PI / 180; }

        private static double[][] T(double x, double y)
        {
            return new[] { new[] { 1.0, 0, x }, new[] { 0, 1.0, y }, new[] { 0, 0, 1.0 } };
        }

        /// <summary>3x3 homogeneous matrix T(t) . T(p) . R . S . T(-p); rotation in degrees about the pivot p.</summary>
        public static double[][] Affine(double rotate, double sx, double sy, double tx, double ty, double px, double py)
        {
            var c = Math.Cos(Rad(rotate));
            var s = Math.Sin(Rad(rotate));
            var R = new[] { new[] { c, -s, 0 }, new[] { s, c, 0 }, new[] { 0, 0, 1.0 } };
            var S = new[] { new[] { sx, 0, 0 }, new[] { 0, sy, 0 }, new[] { 0, 0, 1.0 } };
            var m = T(tx, ty);
            m = Matmul(m, T(px, py));
            m = Matmul(m, R);
            m = Matmul(m, S);
            return Matmul(m, T(-px, -py));
        }

        /// <summary>
        /// Trapezoid or composite Simpson over (xs, ys). cumulative is always the running trapezoid.
        /// Simpson takes two intervals at a time; an odd interval left over is closed with a trapezoid.
        /// </summary>
        public static double Integrate(double[] xs, double[] ys, string method, out double[] cumulative)
        {
            var n = ys.Length;
            cumulative = new double[n];
            double trap = 0;
            for (var i = 0; i + 1 < n; i++)
            {
                trap += 0.5 * (ys[i] + ys[i + 1]) * (xs[i + 1] - xs[i]);
                cumulative[i + 1] = trap;
            }
            if (method != "Simpson" || n < 3) return trap;
            double total = 0;
            var j = 0;
            for (; j + 2 < n; j += 2)
            {
                var h = (xs[j + 2] - xs[j]) / 2;
                total += h / 3 * (ys[j] + 4 * ys[j + 1] + ys[j + 2]);
            }
            if (j + 1 < n) total += 0.5 * (ys[j] + ys[j + 1]) * (xs[j + 1] - xs[j]);
            return total;
        }
    }
}
