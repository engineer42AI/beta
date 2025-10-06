// src/components/console/bus/types.ts
export type Scope = "ai"; // later: "traces" | "logs" | ...
export type Direction = "page→console" | "console→page";

export type Envelope = {
  v: 1;                       // protocol version
  id: string;                 // message id (uuid)
  ts: number;                 // timestamp
  scope: Scope;               // which console tool (ai now)
  dir: Direction;             // direction
  route: string;              // next.js pathname
  pageId?: string;            // page instance
  tabId?: string;             // console tab
  topic?: string;             // free-form (optional)
  payload?: unknown;          // any
};