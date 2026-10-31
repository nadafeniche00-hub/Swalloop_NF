using System;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using Grasshopper;
using Grasshopper.GUI.Canvas;
using Grasshopper.Kernel;

namespace Swalloop.GH
{
    /// <summary>
    /// The Swalloop menu in Grasshopper's menu bar: the featured (tower) template first, then every
    /// template grouped as in the desktop app's start screen. A click builds the template as a real
    /// canvas (TemplateBuilder) and opens it as a new document.
    /// </summary>
    public static class SwalloopMenu
    {
        public const string Title = "Swalloop";
        private static bool _registered;

        public static void RegisterWhenReady()
        {
            if (Instances.ActiveCanvas != null && Instances.DocumentEditor != null) Register();
            else Instances.CanvasCreated += OnCanvasCreated;
        }

        private static void OnCanvasCreated(GH_Canvas canvas)
        {
            Instances.CanvasCreated -= OnCanvasCreated;
            Register();
        }

        private static void Register()
        {
            if (_registered) return;
            var editor = Instances.DocumentEditor;
            if (editor == null || editor.MainMenuStrip == null) return;
            _registered = true;

            var root = new ToolStripMenuItem(Title) { Name = "SwalloopMenu", Image = Icons.Swallow(16) };

            var featured = TemplateLibrary.Featured;
            if (featured != null)
            {
                var item = new ToolStripMenuItem("Open the " + (featured.Group.Length > 0 ? featured.Group.ToLowerInvariant() : "tower") + " template")
                {
                    Name = "SwalloopFeatured",
                    Font = new Font(SystemFonts.MenuFont, FontStyle.Bold),
                    ToolTipText = featured.Description,
                };
                item.Click += (s, e) => Open(featured);
                root.DropDownItems.Add(item);
                root.DropDownItems.Add(new ToolStripSeparator());
            }

            foreach (var group in TemplateLibrary.All.GroupBy(t => t.Group))
            {
                var sub = new ToolStripMenuItem(group.Key.Length > 0 ? group.Key : "Templates");
                foreach (var t in group)
                {
                    var template = t;
                    var item = new ToolStripMenuItem(t.Name) { ToolTipText = t.Description };
                    item.Click += (s, e) => Open(template);
                    sub.DropDownItems.Add(item);
                }
                root.DropDownItems.Add(sub);
            }

            editor.MainMenuStrip.Items.Add(root);
        }

        /// <summary>Builds the template as a canvas, opens it as a new document and solves it.</summary>
        public static GH_Document Open(TemplateInfo template)
        {
            var built = TemplateBuilder.BuildFromJson(template.Json());
            var doc = built.Document;
            Instances.DocumentServer.AddDocument(doc);
            if (Instances.ActiveCanvas != null) Instances.ActiveCanvas.Document = doc;
            doc.Enabled = true;
            doc.NewSolution(true);
            if (built.Problems.Count > 0)
                MessageBox.Show(string.Join("\n", built.Problems), "Swalloop: " + template.Name, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return doc;
        }
    }
}
