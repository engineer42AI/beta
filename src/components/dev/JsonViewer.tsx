"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type JsonViewerProps = {
  value: unknown;
  defaultOpen?: number;
  className?: string;
};

const INDENT = 4; // px per nesting level

function typeOf(v: unknown):
  | "null" | "undefined" | "boolean" | "number" | "string"
  | "array" | "object" | "function" {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  // @ts-ignore
  return typeof v;
}

function isContainer(v: unknown) {
  const t = typeOf(v);
  return t === "array" || t === "object";
}

// Colors
const kKey = "text-red-400 dark:text-red-300";
const kVal = "text-orange-300 dark:text-orange-300";
const kBool = "text-violet-300 dark:text-violet-300";
const kNull = "text-zinc-400 dark:text-zinc-400";
const kMeta = "text-zinc-500 dark:text-zinc-500";

function Scalar({ v }: { v: unknown }) {
  const t = typeOf(v);
  if (t === "string") {
    // NEW: wrap long strings; keep quotes same color as value
    return (
      <span
        className={`${kVal} break-words whitespace-pre-wrap`}
        style={{ overflowWrap: "anywhere" }} // ensures break inside long tokens
      >
        <span className={kVal}>"</span>
        {String(v)}
        <span className={kVal}>"</span>
      </span>
    );
  }
  if (t === "number") return <span className={kVal}>{String(v)}</span>;
  if (t === "boolean") return <span className={kBool}>{String(v)}</span>;
  if (t === "null") return <span className={kNull}>null</span>;
  if (t === "undefined") return <span className={kNull}>undefined</span>;
  if (t === "function") return <span className={kMeta}>ƒ()</span>;
  return <span className={kVal}>{String(v)}</span>;
}

function Summary({ v, hasLabel }: { v: unknown; hasLabel?: boolean }) {
  if (Array.isArray(v)) {
    return (
      <>
        {hasLabel && <span className={kMeta}>: </span>}
        <span className={kMeta}>[</span>
        <span className={kMeta}>{v.length}</span>
        <span className={kMeta}>]</span>
      </>
    );
  }
  if (v && typeof v === "object") {
    const n = Object.keys(v as Record<string, unknown>).length;
    return (
      <>
        {hasLabel && <span className={kMeta}>: </span>}
        <span className={kMeta}>{"{"}</span>
        <span className={kMeta}>{n}</span>
        <span className={kMeta}>{"}"}</span>
      </>
    );
  }
  return null;
}

type RowProps = {
  value: unknown;
  level: number;
  defaultOpen: number;
  label?: string | number;
  isArrayItem?: boolean;
};

function Row({ value, level, defaultOpen, label, isArrayItem }: RowProps) {
  const container = isContainer(value);
  const [open, setOpen] = React.useState(container && level < (defaultOpen ?? 0));

  const isIndex =
    typeof label === "number" ||
    (typeof label === "string" && /^\d+$/.test(label));
  const showAsIndex = isArrayItem && isIndex;

  const keyFrag =
    label === undefined ? null : showAsIndex ? (
      <>
        <span className="text-zinc-500 dark:text-zinc-500">[{String(label)}]</span>
        {!container && <span className={kMeta}>: </span>}
      </>
    ) : (
      <>
        <span className={kKey}>
          <span className={kKey}>"</span>
          {String(label)}
          <span className={kKey}>"</span>
        </span>
        {!container && <span className={kMeta}>: </span>}
      </>
    );

  if (!container) {
    return (
      <div style={{ marginLeft: level * INDENT }} className="leading-4 py-[1px]">
        {label !== undefined && keyFrag}
            <Scalar v={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const keys = isArray
    ? [...Array((value as any[]).length).keys()]
    : Object.keys(value as Record<string, unknown>);

  return (
    <div className="space-y-[2px]">
      <div
        className="flex items-start gap-1"
        style={{ marginLeft: level * INDENT }}
      >
        <button
          className="px-[2px] -ml-1 rounded hover:bg-muted text-foreground/80 leading-4"
          onClick={() => setOpen(o => !o)}
          title={open ? "Collapse" : "Expand"}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>
        <div className="leading-4 break-words">
          {label !== undefined && keyFrag}
          <Summary v={value} hasLabel={label !== undefined} />
        </div>
      </div>

      {open && (
        <div className="space-y-[2px]" style={{ marginLeft: level * INDENT }}>
          {keys.map((k, i) => {
            const child = isArray
              ? (value as any[])[k as number]
              : (value as Record<string, unknown>)[k as string];
            return (
              <Row
                key={isArray ? i : String(k)}
                value={child}
                level={level + 1}
                defaultOpen={defaultOpen}
                label={k as any}
                isArrayItem={isArray}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function JsonViewerBase({ value, defaultOpen = 1, className }: JsonViewerProps) {
  return (
    <div
      className={cn(
        "font-mono text-[10px] leading-4",
        "rounded-md bg-background/40",
        className
      )}
      style={{ scrollbarGutter: "stable" }}
    >
      {isContainer(value) ? (
        <Row value={value} level={0} defaultOpen={defaultOpen} />
      ) : (
        <div className="p-2">
          <Scalar v={value} />
        </div>
      )}
    </div>
  );
}

export default JsonViewerBase;
export const JsonViewer = JsonViewerBase;