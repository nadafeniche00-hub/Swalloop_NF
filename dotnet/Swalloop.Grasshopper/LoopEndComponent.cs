using System;
using Grasshopper.Kernel;
using Swalloop.Core;

namespace Swalloop.GH
{
    /// <summary>
    /// Return · Loop End. Grasshopper forbids a wire that feeds a result back into its own inputs, so the
    /// loop is not drawn on the canvas: when this component solves, it walks the wires upstream, rebuilds
    /// what feeds it as an engine graph (GraphExtractor), and lets the engine pair it with its Loop Start
    /// and iterate the body internally, exactly as the editor does. The components between Start and End
    /// show one pass of the body; this one outputs the settled result and the history.
    /// </summary>
    [NodeType("loopEnd")]
    public sealed class LoopEndComponent : NodeComponent
    {
        public LoopEndComponent() : base("loopEnd") { }
        public override Guid ComponentGuid { get { return Catalog.For("loopEnd").Guid; } }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            try
            {
                var graph = GraphExtractor.Extract(this, out var endId);
                var result = Engine.Evaluate(graph.Nodes, graph.Edges, Catalog.Engine);
                var r = result.Results[endId];
                if (r.Error != null)
                {
                    AddRuntimeMessage(GH_RuntimeMessageLevel.Error, r.Error);
                    return;
                }
                Publish(DA, r.Outputs);
                if (r.Outputs != null && r.Outputs.TryGetValue("count", out var count))
                    Message = (int)V.Num(count) + " passes";
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
            }
        }
    }
}
