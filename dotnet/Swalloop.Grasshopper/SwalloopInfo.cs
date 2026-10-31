using System;
using System.Drawing;
using Grasshopper;
using Grasshopper.Kernel;

namespace Swalloop.GH
{
    /// <summary>What Grasshopper shows about the plugin (File > Special Folders, the plugin list, the tab).</summary>
    public class SwalloopInfo : GH_AssemblyInfo
    {
        public override string Name => "Swalloop";
        public override Bitmap Icon => Icons.Swallow(24);
        public override string Description => "Loops that take off, travel and come home: a loop engine, form-finding templates and analysis tools.";
        public override Guid Id => new Guid("9d5f75eb-e8a1-431b-a821-900f0a3becf8");
        public override string AuthorName => "Swalloop";
        public override string AuthorContact => "https://github.com/nfe15rajab-bot/loophole";
        public override string Version => "0.1.0";
    }

    /// <summary>Puts the tab icon on the Swalloop ribbon tab as soon as the plugin loads.</summary>
    public class SwalloopPriority : GH_AssemblyPriority
    {
        public override GH_LoadingInstruction PriorityLoad()
        {
            Instances.ComponentServer.AddCategoryIcon("Swalloop", Icons.Swallow(24));
            Instances.ComponentServer.AddCategorySymbolName("Swalloop", 'S');
            SwalloopMenu.RegisterWhenReady();
            return GH_LoadingInstruction.Proceed;
        }
    }
}
