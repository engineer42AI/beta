// components/ui/ResizablePanels.tsx
"use client";

import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type PanelGroupProps,
} from "react-resizable-panels";

export function ResizablePanels({ children, ...props }: PanelGroupProps) {
  return <PanelGroup {...props}>{children}</PanelGroup>;
}

export { Panel, PanelResizeHandle };
