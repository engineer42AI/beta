"use client";

import React, { useEffect, useMemo, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape, { ElementDefinition } from "cytoscape";
import elk from "elkjs/lib/elk.bundled.js";
import elkCytoscape from "cytoscape-elk";

if ((cytoscape as any).__elkRegistered !== true) {
  cytoscape.use(elkCytoscape);
  (cytoscape as any).__elkRegistered = true;
}

type CytoTraceProps = {
  elements: ElementDefinition[];
  height?: string;
  width?: string;
  dark?: boolean;
};

export default function CytoTrace({
  elements,
  height = "500px",
  width = "100%",
  dark = true,
}: CytoTraceProps) {
  const cyRef = useRef<cytoscape.Core | null>(null);

  const layout = useMemo(
    () => ({
      name: "elk",
      elk: {
        algorithm: "layered",
        "elk.direction": "DOWN",
        "elk.layered.spacing.nodeNodeBetweenLayers": 50,
        "spacing.nodeNode": 30,
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
        "elk.edgeRouting": "ORTHOGONAL",
      },
      fit: true,
      padding: 20,
      animate: false,
    }),
    []
  );

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          "background-color": dark ? "#444" : "#666",
          "label": "data(label)",
          "text-valign": "center",
          "text-halign": "center",
          "font-size": "10px",
          "color": dark ? "#fff" : "#111",
          "text-wrap": "wrap",
          "text-max-width": "110px",
          "border-width": 0,
          "width": "mapData(size, 10, 30, 24, 36)",
          "height": "mapData(size, 10, 30, 24, 36)",
        },
      },
      {
        selector: "node.ntype-Document",
        style: { "background-color": "#2faa2f", "width": 40, "height": 40, "font-weight": 600 },
      },
      {
        selector: "node.contains-path",
        style: { "background-color": "#e53935" }, // red nodes along CONTAINS paths
      },
      {
        selector: "edge",
        style: {
          "width": 2,
          "curve-style": "orthogonal",
          "target-arrow-shape": "triangle",
          "arrow-scale": 1,
          "line-color": dark ? "#888" : "#666",
          "target-arrow-color": dark ? "#888" : "#666",
        },
      },
      {
        selector: "edge.relation-CONTAINS",
        style: { "line-color": "#e53935", "target-arrow-color": "#e53935", "width": 2.5 },
      },
      {
        selector: "edge.relation-CITES",
        style: {
          "line-style": "dashed",
          "opacity": 0.7,
        },
      },
      {
        selector: ":selected",
        style: { "border-width": 3, "border-color": "#5b9cf6" },
      },
    ],
    [dark]
  );

  // re-run layout when elements change
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.elements().remove();
    cy.add(elements);
    cy.layout(layout as any).run();
  }, [elements, layout]);

  return (
    <div style={{ background: dark ? "#1f1f1f" : "#fafafa", borderRadius: 12, padding: 8 }}>
      <CytoscapeComponent
        cy={(cy) => (cyRef.current = cy)}
        elements={elements}
        style={{ width, height }}
        stylesheet={stylesheet as any}
        wheelSensitivity={0.2}
      />
    </div>
  );
}
