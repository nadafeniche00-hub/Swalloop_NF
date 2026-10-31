using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Swalloop.Core;

namespace Swalloop.GH
{
    /// <summary>One template that ships inside the plugin.</summary>
    public sealed class TemplateInfo
    {
        public string Resource, Name, Description, Group;
        public bool Featured;

        public string Json()
        {
            using (var s = typeof(TemplateLibrary).Assembly.GetManifestResourceStream(Resource))
            using (var r = new StreamReader(s)) return r.ReadToEnd();
        }
    }

    /// <summary>
    /// The templates embedded in the plugin (the *.swalloop.json files of /templates). The same
    /// files the desktop editor opens: a template is data, and the tower case is one of them,
    /// marked featured.
    /// </summary>
    public static class TemplateLibrary
    {
        private const string Prefix = "Swalloop.templates.";

        public static readonly IReadOnlyList<TemplateInfo> All = Load();

        private static List<TemplateInfo> Load()
        {
            var list = new List<TemplateInfo>();
            var asm = typeof(TemplateLibrary).Assembly;
            foreach (var res in asm.GetManifestResourceNames().Where(n => n.StartsWith(Prefix) && n.EndsWith(".swalloop.json")))
            {
                string text;
                using (var s = asm.GetManifestResourceStream(res))
                using (var r = new StreamReader(s)) text = r.ReadToEnd();
                if (!(MiniJson.Parse(text) is Dictionary<string, object> d)) continue;
                list.Add(new TemplateInfo
                {
                    Resource = res,
                    Name = d.TryGetValue("name", out var n) ? n as string ?? res : res,
                    Description = d.TryGetValue("description", out var de) ? de as string ?? "" : "",
                    Group = d.TryGetValue("group", out var g) ? g as string ?? "" : "",
                    Featured = d.TryGetValue("featured", out var f) && f is bool b && b,
                });
            }
            return list.OrderBy(t => t.Group).ThenByDescending(t => t.Featured).ThenBy(t => t.Name).ToList();
        }

        public static TemplateInfo Featured { get { return All.FirstOrDefault(t => t.Featured) ?? All.FirstOrDefault(); } }

        public static TemplateInfo Find(string name)
        {
            return All.FirstOrDefault(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));
        }
    }
}
