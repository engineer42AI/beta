"use client";

import React, { useCallback } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  Connection,
  Edge,
  MiniMap,
  Node,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";

const initialNodes: Node[] = [
  { id: "1", position: { x: 0, y: 0 }, data: { label: "Start" }, type: "input" },
  { id: "2", position: { x: 200, y: 120 }, data: { label: "Hazard" } },
];

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true },
];

export default function GraphPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Edge | Connection) =>
      setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div className="h-[calc(100dvh-3rem)]">
      <div className="h-full rounded-lg border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
    </div>
  );
}
