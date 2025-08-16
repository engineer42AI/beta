"use client";

import React, { useCallback, useRef, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  Connection,
  Edge,
  Node,
  Handle,
  Position,
  ConnectionMode,
  ReactFlowProvider,
  useReactFlow,
  Panel,
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "@/components/ui/button";

/* ------------------- utilities ------------------- */

function nextId() {
  return Math.random().toString(36).slice(2, 10);
}

type Kind = "hazard" | "control" | "note";

/* ------------------- tiny hook to detect if view is on mobile ------------------- */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpoint}px), (pointer:coarse)`);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMobile('matches' in e ? e.matches : (e as MediaQueryList).matches);
    onChange(mq); // set initial
    mq.addEventListener?.('change', onChange as any);
    return () => mq.removeEventListener?.('change', onChange as any);
  }, [breakpoint]);
  return isMobile;
}

/* ------------------- tiny editable text helper ------------------- */

function EditableText({
  id,
  value,
  onCommit,
  placeholder,
  as = "div",
  multiline = false,
  className = "",
}: {
  id: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  as?: "div" | "h3" | "button";
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  const start = (e: React.MouseEvent) => {
    e.stopPropagation(); // avoid selecting/dragging the node
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  if (editing) {
    const common = {
      id,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !multiline) commit();
        if (e.key === "Escape") setEditing(false);
      },
      className:
        "w-full bg-transparent outline-none border rounded px-2 py-1 text-sm",
      autoFocus: true,
    } as const;

    return multiline ? (
      <textarea {...common} rows={3} />
    ) : (
      <input {...common} />
    );
  }

  const Wrapper: any = as;
  return (
    <Wrapper
      className={className}
      onDoubleClick={start}
      title="Double-click to edit"
    >
      {value || <span className="opacity-50">{placeholder ?? "—"}</span>}
    </Wrapper>
  );
}

/* ------------------- custom full-featured node ------------------- */

type FullNodeData = {
  title?: string;
  body?: string;
  action?: string;
  onChange?: (id: string, patch: Partial<FullNodeData>) => void;
};

function RocketIcon() {
  // inline svg to avoid extra deps
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 opacity-70"
      fill="currentColor"
    >
      <path d="M14 4.5c-2.5 1.2-4.7 3.4-6.6 6.6l-.9-.2c-1.5-.3-2.9.9-3 2.5l-.2 2.5 2.5-.2c1.6-.1 2.8-1.5 2.5-3l-.1-.6c3.2-1.9 5.4-4.1 6.6-6.6.3-.7-.5-1.5-1.3-1.2ZM7 16l-3 3c-.4.4-.1 1 .4.9l3.7-.7c.3-.1.5-.3.6-.6l.7-3.7c.1-.5-.6-.8-1-.4L7 16Zm10.2-9.2c-.6 0-1.2.2-1.7.7-.9.9-.9 2.5 0 3.4.9.9 2.5.9 3.4 0 .9-.9.9-2.5 0-3.4-.5-.5-1.1-.7-1.7-.7ZM12 21s2-1 3.5-2.5S18 15 18 13c2 0 3.5-1 5-2.5S26 8 26 8s-3-1-6 0c-1 2-2.5 3.5-4.5 5.5S12 21 12 21Z" />
    </svg>
  );
}

function FullFeaturedNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: FullNodeData;
  selected: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white dark:bg-neutral-900 text-card-foreground shadow-sm min-w-[260px] overflow-hidden ${
        selected ? "ring-2 ring-ring" : ""
      }`}
    >

      {/* HEADER (drag handle only) */}
      <div
          className="flex items-center gap-2 px-4 py-2 border-b bg-gray-100 dark:bg-neutral-800 cursor-grab select-none"
          data-drag-handle
      >
        <RocketIcon />
        <EditableText
          id={`title-${id}`}
          value={data.title ?? ""}
          placeholder="Header"
          as="h3"
          onCommit={(v) => data.onChange?.(id, { title: v })}
          className="font-semibold text-sm"
        />
      </div>

      {/* CONTENT */}
      <div className="px-4 py-3 text-sm">
        <EditableText
          id={`body-${id}`}
          value={data.body ?? ""}
          placeholder="Content"
          multiline
          onCommit={(v) => data.onChange?.(id, { body: v })}
          className="leading-6"
        />
      </div>

      {/* FOOTER */}
      <div className="px-4 py-2 border-t bg-muted/20">
        <EditableText
          id={`action-${id}`}
          value={data.action ?? ""}
          placeholder="Action"
          as="button"
          onCommit={(v) => data.onChange?.(id, { action: v })}
          className="w-full text-sm font-medium px-3 py-2 rounded-md border bg-background hover:bg-accent transition"
        />
      </div>

      {/* Connection handles */}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} />
    </div>
  );
}

const nodeTypes = { full: FullFeaturedNode };

/* ------------------- initial data ------------------- */

const initialNodesBase: Node[] = [
  {
    id: "1",
    position: { x: 100, y: 80 },
    type: "full",
    data: {
      title: "Header",
      body:
        "This is a full-featured node with a header, content, and footer.\nYou can customize it as needed.",
      action: "Action 1",
    },
  },
  {
    id: "2",
    position: { x: 420, y: 220 },
    type: "full",
    data: { title: "Hazard", body: "Describe the hazard here…", action: "Mitigate" },
  },
];

const initialEdgesBase: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true },
];

/* ------------------- page ------------------- */

export default function GraphPage() {
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">{/* flex parent */}
      <ReactFlowProvider>
        <FlowCanvas /> {/* flex item */}
      </ReactFlowProvider>
    </div>
  );
}

/* ------------------- canvas under provider ------------------- */

function FlowCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodesBase);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdgesBase);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // derive the live node each render
  const selectedNode = React.useMemo(
      () => nodes.find((n) => n.id === selectedId) ?? null,
      [nodes, selectedId]
  );
  const [showInspector, setShowInspector] = React.useState(false);

  // inject onChange handler & drag handle into all nodes (initial + new)
  const ensureEditable = useCallback(
    (nds: Node[]) =>
      nds.map((n) => ({
        ...n,
        type: "full",
        dragHandle: "[data-drag-handle]", // only header drags
        data: {
          title: n.data?.title ?? (n.data as any)?.label ?? "Header",
          body:
            n.data?.body ??
            "This is a full-featured node with a header, content, and footer. You can customize it as needed.",
          action: n.data?.action ?? "Action 1",
          onChange: (id: string, patch: Partial<FullNodeData>) =>
            setNodes((prev) =>
              prev.map((nn) =>
                nn.id === id ? { ...nn, data: { ...nn.data, ...patch } } : nn
              )
            ),
        } as FullNodeData,
      })),
    [setNodes]
  );

  const isMobile = useIsMobile();
  // force-close if we become mobile
  React.useEffect(() => {
      if (isMobile) setShowInspector(false);
  }, [isMobile, setShowInspector]);

  // make sure existing nodes have the onChange wired
  React.useEffect(() => {
    setNodes((prev) => ensureEditable(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { project } = useReactFlow();

  const toCanvasPos = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      return project({
        x: clientX - (bounds?.left ?? 0),
        y: clientY - (bounds?.top ?? 0),
      });
    },
    [project]
  );

  const addNode = useCallback(
    (kind: Kind, pos: { x: number; y: number }) => {
      const title =
        kind === "hazard" ? "Hazard" : kind === "control" ? "Control" : "Note";
      const id = nextId();
      setNodes((nds) =>
        ensureEditable(
          nds.concat({
            id,
            type: "full",
            position: pos,
            data: {
              title,
              body: "Double-click any text to edit.",
              action: kind === "control" ? "Apply" : "Action 1",
            },
          })
        )
      );
    },
    [setNodes, ensureEditable]
  );

  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge({ ...params }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/reactflow") as Kind;
      if (!type) return;
      addNode(type, toCanvasPos(e.clientX, e.clientY));
    },
    [addNode, toCanvasPos]
  );

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (!e.shiftKey) return;
      addNode("hazard", toCanvasPos(e.clientX, e.clientY));
    },
    [addNode, toCanvasPos]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      setNodes((nds) => nds.filter((n) => !n.selected));
      setEdges((eds) => eds.filter((ed) => !ed.selected));
    },
    [setNodes, setEdges]
  );
  return (
      // ⬇️ wrap in a flex column that can shrink
      <div className="min-h-0 flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-11 border-b px-3 flex items-center gap-2 bg-background">
          <PaletteButton kind="hazard" label="Hazard" onAdd={(pos) => addNode("hazard", pos)} />
          <PaletteButton kind="control" label="Control" onAdd={(pos) => addNode("control", pos)} />
          <PaletteButton kind="note" label="Note" onAdd={(pos) => addNode("note", pos)} />
          <div className="ml-auto hidden md:block text-xs text-muted-foreground">
            Tip: double-click text inside a node to edit • drag from palette • <kbd>Shift</kbd>+click canvas to add
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={wrapperRef}
          className="min-h-0 flex-1 relative rounded-lg border overflow-hidden"
          onKeyDown={onKeyDown}
          tabIndex={0}
        >
          <ReactFlow
            className="absolute inset-0"   // fill wrapper fully
            nodes={nodes}
            edges={edges}
            onSelectionChange={({ nodes }) => setSelectedId(nodes[0]?.id ?? null)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            snapToGrid
            snapGrid={[10, 10]}
            fitView
          >
              <MiniMap className="hidden lg:block" />
              <Controls />
              <Background gap={20} size={1} />

              {!isMobile && (
                <Panel position="top-left" style={{ top: 12, left: 12, background: "transparent", boxShadow: "none", zIndex: 5 }}>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 shadow"
                    title={showInspector ? "Hide inspector (i)" : "Show inspector (i)"}
                    onClick={() => setShowInspector(v => !v)}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                      <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm0 4.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM10.75 11a1 1 0 1 0 0 2h.5v4.25a1 1 0 1 0 2 0V12a1 1 0 0 0-1-1h-1.5Z"/>
                    </svg>
                  </Button>
                </Panel>
              )}

              {!isMobile && showInspector && (
                <Panel position="top-right" style={{ top: 12, right: 12, zIndex: 5 }}>
                  <div
                      className="
                        rounded-lg border shadow-lg
                        bg-white dark:bg-neutral-900  /* solid background */
                        p-3
                        flex flex-col
                      "
                      style={{
                          // width: min 280px, prefer 70vw, max 500px
                          width: 'clamp(280px, 70vw, 500px)',

                          // height: min 260px, prefer 45vh, max 320px
                          height: 'clamp(260px, 45vh, 320px)',

                          // keep it inside the canvas even on tiny screens
                          maxWidth: 'calc(100% - 24px)',
                          maxHeight: 'calc(100% - 24px)',
                      }}
                  >
                      {/* header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold">Node Inspector</div>
                        <div className="text-xs text-muted-foreground">
                          {selectedNode ? `#${selectedNode.id}` : "No selection"}
                        </div>
                      </div>

                      {/* scrollable content */}
                      <div className="flex-1 overflow-auto space-y-3">
                        {!selectedNode ? (
                          <div className="text-sm text-muted-foreground">
                            Select a node to view its metadata.
                          </div>
                        ) : (
                          <>
                            <details className="rounded border p-2" open>
                              <summary className="cursor-pointer text-sm font-medium mb-1">Raw data</summary>
                              <pre
                                className="
                                  text-xs whitespace-pre-wrap break-words
                                  rounded p-2
                                  bg-white/60 dark:bg-neutral-800/60
                                  max-h-28 overflow-auto
                                "
                              >
                                {JSON.stringify(selectedNode.data, null, 2)}
                              </pre>
                            </details>

                            <div className="space-y-2">
                              <label className="text-xs font-medium">Title</label>
                              <input
                                className="w-full rounded border bg-transparent px-2 py-1 text-sm overflow-hidden text-ellipsis"
                                value={selectedNode.data?.title ?? ""}
                                onChange={(e) =>
                                  setNodes((prev) =>
                                    prev.map((n) =>
                                      n.id === selectedNode.id
                                        ? { ...n, data: { ...n.data, title: e.target.value } }
                                        : n
                                    )
                                  )
                                }
                              />

                              <label className="text-xs font-medium">Body</label>
                              <textarea
                                rows={4}
                                className="w-full rounded border bg-transparent px-2 py-1 text-sm resize-y whitespace-pre-wrap break-words"
                                value={selectedNode.data?.body ?? ""}
                                onChange={(e) =>
                                  setNodes((prev) =>
                                    prev.map((n) =>
                                      n.id === selectedNode.id
                                        ? { ...n, data: { ...n.data, body: e.target.value } }
                                        : n
                                    )
                                  )
                                }
                              />

                              <label className="text-xs font-medium">Action</label>
                              <input
                                className="w-full rounded border bg-transparent px-2 py-1 text-sm overflow-hidden text-ellipsis"
                                value={selectedNode.data?.action ?? ""}
                                onChange={(e) =>
                                  setNodes((prev) =>
                                    prev.map((n) =>
                                      n.id === selectedNode.id
                                        ? { ...n, data: { ...n.data, action: e.target.value } }
                                        : n
                                    )
                                  )
                                }
                              />
                            </div>
                          </>
                        )}
                      </div>
                  </div>
                </Panel>
              )}
          </ReactFlow>
        </div>
      </div>
  );
}

/* ------------------- palette ------------------- */

function PaletteButton({
  kind,
  label,
  onAdd,
}: {
  kind: Kind;
  label: string;
  onAdd: (pos: { x: number; y: number }) => void;
}) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/reactflow", kind);
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      className="cursor-grab"
      draggable
      onDragStart={onDragStart}
      onClick={() => onAdd({ x: 400, y: 160 })}
    >
      + {label}
    </Button>
  );
}
