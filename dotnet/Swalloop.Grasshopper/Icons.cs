using System.Drawing;
using System.Drawing.Drawing2D;

namespace Swalloop.GH
{
    /// <summary>
    /// Component icons, drawn in code from the icon designs in /icons (24 x 24 grid), so the
    /// plugin needs no image resources and every size stays sharp. Palette: the swallow's own,
    /// midnight back, cream belly, rust throat.
    /// </summary>
    public static class Icons
    {
        private static readonly Color Midnight = Color.FromArgb(0x1B, 0x2A, 0x4A);
        private static readonly Color Cream = Color.FromArgb(0xF4, 0xEB, 0xD6);
        private static readonly Color Rust = Color.FromArgb(0xB5, 0x53, 0x2B);

        // The swallow seen from above: crescent wings and a forked tail (icons/*.svg).
        private static GraphicsPath SwallowPath()
        {
            var p = new GraphicsPath();
            p.StartFigure();
            p.AddBezier(12f, 3.5f, 12.9f, 3.5f, 13.4f, 5f, 13.2f, 8f);
            p.AddBezier(13.2f, 8f, 16f, 6f, 20f, 7.5f, 22f, 12f);
            p.AddBezier(22f, 12f, 19f, 10.5f, 16f, 11f, 13.6f, 13.2f);
            p.AddLine(13.6f, 13.2f, 13.4f, 15.5f);
            p.AddLine(13.4f, 15.5f, 15.6f, 23f);
            p.AddLine(15.6f, 23f, 12f, 18f);
            p.AddLine(12f, 18f, 8.4f, 23f);
            p.AddLine(8.4f, 23f, 10.6f, 15.5f);
            p.AddLine(10.6f, 15.5f, 10.4f, 13.2f);
            p.AddBezier(10.4f, 13.2f, 8f, 11f, 5f, 10.5f, 2f, 12f);
            p.AddBezier(2f, 12f, 4f, 7.5f, 8f, 6f, 10.8f, 8f);
            p.AddBezier(10.8f, 8f, 10.6f, 5f, 11.1f, 3.5f, 12f, 3.5f);
            p.CloseFigure();
            return p;
        }

        private static Bitmap Canvas(int size, out Graphics g)
        {
            var bmp = new Bitmap(size, size);
            g = Graphics.FromImage(bmp);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.ScaleTransform(size / 24f, size / 24f);
            return bmp;
        }

        private static readonly System.Collections.Generic.Dictionary<string, Bitmap> Cache =
            new System.Collections.Generic.Dictionary<string, Bitmap>();

        /// <summary>The icon for a node category: loops get the migration cycle, the site the nest, the rest the swallow.</summary>
        public static Bitmap ForCategory(string category)
        {
            lock (Cache)
            {
                if (!Cache.TryGetValue(category, out var b))
                {
                    b = category == "Migration" ? Cycle(24) : category == "Site" ? Nest(24) : Swallow(24);
                    Cache[category] = b;
                }
                return b;
            }
        }

        /// <summary>The plain swallow: the plugin and the tab.</summary>
        public static Bitmap Swallow(int size = 24)
        {
            var bmp = Canvas(size, out var g);
            using (g)
            using (var path = SwallowPath())
            using (var brush = new SolidBrush(Midnight))
                g.FillPath(brush, path);
            return bmp;
        }

        /// <summary>A swallow inside a migration circle with its arrow: loops that repeat (the template runner).</summary>
        public static Bitmap Cycle(int size = 24)
        {
            var bmp = Canvas(size, out var g);
            using (g)
            {
                using (var pen = new Pen(Rust, 1.8f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                {
                    g.DrawArc(pen, 3f, 3f, 18f, 18f, -90f, 300f); // from the top, clockwise, 300 degrees
                    g.DrawLines(pen, new[] { new PointF(4.4f, 11.1f), new PointF(4.2f, 7.5f), new PointF(1.1f, 9.1f) });
                }
                g.TranslateTransform(5.4f, 5.4f);
                g.ScaleTransform(0.55f, 0.55f);
                using (var path = SwallowPath())
                using (var brush = new SolidBrush(Midnight))
                    g.FillPath(brush, path);
            }
            return bmp;
        }

        /// <summary>A nest with an egg: where a loop starts and comes home.</summary>
        public static Bitmap Nest(int size = 24)
        {
            var bmp = Canvas(size, out var g);
            using (g)
            {
                using (var path = new GraphicsPath())
                {
                    path.AddLine(4f, 17f, 20f, 17f);
                    path.AddBezier(20f, 17f, 20f, 20.8f, 16.6f, 23f, 12f, 23f);
                    path.AddBezier(12f, 23f, 7.4f, 23f, 4f, 20.8f, 4f, 17f);
                    path.CloseFigure();
                    using (var fill = new SolidBrush(Cream)) g.FillPath(fill, path);
                    using (var pen = new Pen(Midnight, 1.5f)) g.DrawPath(pen, path);
                }
                using (var fill = new SolidBrush(Cream)) g.FillEllipse(fill, 8.6f, 6.6f, 6.8f, 8.8f);
                using (var pen = new Pen(Midnight, 1.5f)) g.DrawEllipse(pen, 8.6f, 6.6f, 6.8f, 8.8f);
                using (var rust = new SolidBrush(Rust))
                {
                    g.FillEllipse(rust, 10.2f, 9.2f, 1.6f, 1.6f);
                    g.FillEllipse(rust, 12.5f, 11.5f, 1.4f, 1.4f);
                }
            }
            return bmp;
        }
    }
}
