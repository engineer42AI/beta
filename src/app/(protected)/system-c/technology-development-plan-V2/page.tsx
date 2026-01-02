// src/app/technology-development-plan-V1/page.tsx
"use client";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { EditorContent, useEditor, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import {
  restrictToVerticalAxis,
  restrictToFirstScrollableAncestor,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

import { X, HelpCircle, Move, Sparkles, ListChecks, FileQuestion, ShieldAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 🔵 READ titles/templates from your local JSON library (unchanged)
import sectionsLib from "./tdp_sections.json";

// 🔵 READ/WRITE TDP to/from Zustand store
import { useProjectsStore, type TdpKey } from "@/stores/projects";

/* ---------------- Types ---------------- */

type LibrarySection = {
  key: TdpKey | string;
  title: string;
  description_md: string;
  tiptap_doc: any; // TipTap JSON template used for new projects
};

type Section = {
  id: string;
  key: TdpKey | string; // library key or "custom_*"
  title: string;
  content: any; // TipTap JSON
};

type TdpDoc = { id: string; name: string; sections: Section[] };

/* ---------------- Keys / helpers ---------------- */

const TDP_KEYS: TdpKey[] = [
  "notional_application",
  "technology_goals",
  "technology_description",
  "development_rationale",
  "technology_baseline",
];

const uid = () => Math.random().toString(36).slice(2, 10);
const H1 = (t: string) => ({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: t }] });
const P  = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

const LIB_PREFIX = "lib:";
const DOC_ZONE_ID = "doc-zone";
const LIB_ZONE_ID = "lib-zone";

/* ---------------- Sortable tiles ---------------- */

function SelectedTile({
  section,
  onInfo,
  onRemove,
  onRename,
}: {
  section: Section;
  onInfo: () => void;
  onRemove: () => void;
  onRename: (t: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="drag-tile">
      <div className="group flex items-center gap-2 rounded-md border border-border px-2 py-1.5 bg-card">
        <div className="cursor-grab select-none text-muted-foreground" {...attributes} {...listeners}>⋮⋮</div>
        <input
          className="flex-1 bg-transparent outline-none"
          value={section.title}
          onChange={(e) => onRename(e.target.value)}
        />
        <button
          className="p-1 rounded hover:bg-accent text-muted-foreground"
          onClick={onInfo}
          title={`About ${section.title}`}
          aria-label={`About ${section.title}`}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        <button
          onClick={onRemove}
          className="p-1 rounded opacity-70 hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Remove from TDP"
          aria-label="Remove section"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function LibraryTile({
  libKey,
  title,
  onInfo,
}: {
  libKey: string;
  title: string;
  onInfo: () => void;
}) {
  const id = `${LIB_PREFIX}${libKey}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="drag-tile">
      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 bg-background">
        <div className="cursor-grab select-none text-muted-foreground" {...attributes} {...listeners}>⋮⋮</div>
        <div className="flex-1 text-sm">{title}</div>
        <button
          className="shrink-0 p-1 rounded text-muted-foreground hover:bg-accent"
          onClick={onInfo}
          title={`About ${title}`}
          aria-label={`About ${title}`}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Droppable zone ---------------- */

function DroppableZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={isOver ? "droppable-ring" : ""}>
      {children}
    </div>
  );
}

/* ---------------- Debounce ---------------- */

function useDebounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  const t = useRef<number | null>(null);
  return (...args: Parameters<T>) => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => fn(...args), ms);
  };
}

/* ---------------- TipTap Section editor ---------------- */

function SectionEditor({
  section,
  onChange,
  onFocusEditor,
  onOpenAI,
}: {
  section: Section;
  onChange: (json: any) => void;
  onFocusEditor: (ed: Editor | null) => void;
  onOpenAI: (section: Section) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
          heading: { levels: [1, 2, 3, 4] },
          codeBlock: {},      // enable with default options
          blockquote: {},     // enable with default options
      }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: section.title }),
    ],
    content: section.content,
    autofocus: false,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "tiptap-content doc-content", "data-placeholder": section.title },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const handleFocus = () => onFocusEditor(editor);
    const handleBlur  = () => onFocusEditor(null);
    editor.on("focus", handleFocus);
    editor.on("blur",  handleBlur);
    return () => {
      editor.off("focus", handleFocus);
      editor.off("blur",  handleBlur);
    };
  }, [editor, onFocusEditor]);

  const debounced = useDebounce(() => editor && onChange(editor.getJSON()), 250);

  useEffect(() => {
      if (!editor) return;

      const upd = () => debounced();
      editor.on("update", upd);

      return () => {
        editor.off("update", upd);
      };
  }, [editor, debounced]);

  // keep editor in sync if section id/content changes
  useEffect(() => {
      if (!editor) return;
      editor.commands.setContent(section.content, {
        emitUpdate: false,
        errorOnInvalidContent: false,
      });
  }, [section.id, editor, section.content]);

  return (
    <section className="tiptap-card">
      <div className="section-kicker px-5 flex items-center justify-between">
        <span>{section.title}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs
                     text-muted-foreground hover:text-foreground hover:bg-accent"
          onClick={() => onOpenAI(section)}
          aria-label={`Open AI guidance for ${section.title}`}
          title="Open AI guidance"
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">AI</span>
        </button>
      </div>
      <div className="px-5 pb-5">
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}

/* ---------------- Floating toolbar (unchanged UI) ---------------- */

function FloatingToolbar({ editor }: { editor: Editor | null }) {
  const [showInsert, setShowInsert] = useState(false);
  const [showText, setShowText] = useState(false);
  const [focused, setFocused] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const closeAll = useCallback(() => { setShowInsert(false); setShowText(false); }, []);

  useEffect(() => {
    const el = () => document.getElementById("console-edge");
    const update = () => {
      const edge = el();
      if (!edge) {
        document.documentElement.style.setProperty("--console-offset", "0px");
        return;
      }
      const r = edge.getBoundingClientRect();
      const edgeBottom = r.bottom;
      const offset = Math.max(0, Math.round(window.innerHeight - edgeBottom));
      document.documentElement.style.setProperty("--console-offset", `${offset}px`);
    };

    const mo = new MutationObserver(update);
    const ro = new ResizeObserver(update);
    const start = () => {
      const edge = el();
      if (edge) ro.observe(edge);
      mo.observe(document.body, { childList: true, subtree: true });
      update();
    };

    start();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("pointerup", update);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("pointerup", update);
    };
  }, []);

  useEffect(() => { setFocused(Boolean(editor?.isFocused)); }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const handleFocus = () => setFocused(true);
    const handleBlur  = () => { setFocused(false); closeAll(); };
    editor.on("focus", handleFocus);
    editor.on("blur",  handleBlur);
    return () => {
      editor.off("focus", handleFocus);
      editor.off("blur",  handleBlur);
    };
  }, [editor, closeAll]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [closeAll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAll(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeAll]);

  useEffect(() => {
      if (!editor) return;
      const sel = () => closeAll();
      editor.on("selectionUpdate", sel);
      return () => {
        editor.off("selectionUpdate", sel);
      };
  }, [editor, closeAll]);

  if (!editor || !focused) return null;

  const Btn = ({
    title, active, disabled, onClick, children,
  }: {
    title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
  }) => (
    <button
      type="button"
      className={`tt-btn ${active ? "is-active" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
  const Divider = () => <span className="tt-div" />;
  const MenuItem = ({ label, onClick, active }: { label: React.ReactNode; onClick: () => void; active?: boolean }) => (
    <button
      type="button"
      className={`tt-menu-item ${active ? "is-active" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="tt-floating-wrap transition-opacity duration-150 opacity-100 pointer-events-auto">
      <div ref={rootRef} className="tt-floating-toolbar">
        <div className="tt-group">
          <Btn title="+ Insert" onClick={() => { closeAll(); setShowInsert(true); }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z"/></svg>
          </Btn>
          {showInsert && (
            <div className="tt-menu tt-menu-grid-insert" onMouseDown={(e) => e.preventDefault()}>
              <MenuItem label="Horizontal rule" onClick={() => editor!.chain().focus().setHorizontalRule().run()} />
              <MenuItem label="Quote"          onClick={() => editor!.chain().focus().toggleBlockquote().run()} />
              <MenuItem label="Code block"     onClick={() => editor!.chain().focus().setCodeBlock().run()} />
            </div>
          )}
        </div>

        <Divider />

        <div className="tt-group">
          <Btn title="Text & formatting" onClick={() => { closeAll(); setShowText(true); }}>
            <span className="tt-text-T">T</span>
            <svg width="12" height="12" viewBox="0 0 24 24" style={{ marginLeft: 6 }}>
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </Btn>
          {showText && (
            <div className="tt-menu tt-menu-grid-format" onMouseDown={(e) => e.preventDefault()}>
              <MenuItem label="H1" active={editor!.isActive("heading",{level:1})} onClick={() => editor!.chain().focus().toggleHeading({level:1}).run()} />
              <MenuItem label="H2" active={editor!.isActive("heading",{level:2})} onClick={() => editor!.chain().focus().toggleHeading({level:2}).run()} />
              <MenuItem label="H3" active={editor!.isActive("heading",{level:3})} onClick={() => editor!.chain().focus().toggleHeading({level:3}).run()} />
              <MenuItem label="H4" active={editor!.isActive("heading",{level:4})} onClick={() => editor!.chain().focus().toggleHeading({level:4}).run()} />
              <MenuItem label={<strong>B</strong>} active={editor!.isActive("bold")} onClick={() => editor!.chain().focus().toggleBold().run()} />
              <MenuItem label={<em style={{fontStyle:"italic"}}>/</em>} active={editor!.isActive("italic")} onClick={() => editor!.chain().focus().toggleItalic().run()} />
              <MenuItem label={<span style={{textDecoration:"line-through"}}>S</span>} active={editor!.isActive("strike")} onClick={() => editor!.chain().focus().toggleStrike().run()} />
              <MenuItem label={<span style={{textDecoration:"underline"}}>U</span>} active={editor!.isActive("underline")} onClick={() => editor!.chain().focus().toggleUnderline().run()} />
            </div>
          )}
        </div>

        <Btn title="Bulleted list"  active={editor!.isActive("bulletList")}  onClick={() => editor!.chain().focus().toggleBulletList().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M8 6h12v2H8zM4 5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3zM8 11h12v2H8zM4 10a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3zM8 16h12v2H8zM4 15a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z"/></svg>
        </Btn>
        <Btn title="Numbered list" active={editor!.isActive("orderedList")} onClick={() => editor!.chain().focus().toggleOrderedList().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M8 6h12v2H8zM4 7h2V5H4V4h3v4H4V7zm4 5h12v2H8zM4 14h3v-1H5v-1h2v-1H4v3zm4 5h12v2H8zM4 20h3v-1H6v-.5h1v-1H4V20z"/></svg>
        </Btn>

        <Divider />

        <Btn title="Code"  active={editor!.isActive("code")}       onClick={() => editor!.chain().focus().toggleCode().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="m8.6 16.6-1.2 1.2L2.6 13l4.8-4.8 1.2 1.2L5 13zM15.4 7.4l1.2-1.2 4.8 4.8-4.8 4.8-1.2-1.2L19 11z"/></svg>
        </Btn>
        <Btn title="Quote" active={editor!.isActive("blockquote")} onClick={() => editor!.chain().focus().toggleBlockquote().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M7 7h5v5H9.6A3.6 3.6 0 0 0 6 15.6V12a5 5 0 0 1 5-5H7zm9 0h5v5h-2.4A3.6 3.6 0 0 0 15 15.6V12a5 5 0 0 1 5-5h-4z"/></svg>
        </Btn>

        <Divider />

        <Btn title="Align left"   onClick={() => editor!.chain().focus().setTextAlign("left").run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v2H3zm0 4h12v2H3zm0 4h18v2H3zm0 4h12v2H3z"/></svg>
        </Btn>
        <Btn title="Align center" onClick={() => editor!.chain().focus().setTextAlign("center").run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v2H3zm3 4h12v2H6zm-3 4h18v2H3zm3 4h12v2H6z"/></svg>
        </Btn>
        <Btn title="Align right"  onClick={() => editor!.chain().focus().setTextAlign("right").run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v2H3zm6 4h12v2H9zM3 13h18v2H3zm6 4h12v2H9z"/></svg>
        </Btn>
      </div>
    </div>
  );
}

/* ---------------- Markdown helpers (used by AI panel preview) ---------------- */

function tiptapToMarkdown(node: any, parentType?: string, index?: number): string {
  if (!node) return "";
  const type = node.type;
  const text = node.text || "";
  const children = Array.isArray(node.content)
      ? node.content.map((child: any, i: number) => tiptapToMarkdown(child, type, i)).join("")
      : "";

  switch (type) {
    case "doc":
      return children;
    case "paragraph":
      return children.trim() ? children + "\n\n" : "\n";
    case "heading": {
      const level = node.attrs?.level || 1;
      const hashes = "#".repeat(level);
      return `${hashes} ${children.trim()}\n\n`;
    }
    case "blockquote":
      return children
        .split("\n")
        .map((line: string) => (line ? `> ${line}` : ""))
        .join("\n") + "\n\n";
    case "bulletList":
      return children + "\n";
    case "orderedList":
      return (node.content || [])
        .map((li: any, i: number) => tiptapToMarkdown(li, "orderedList", i + 1))
        .join("") + "\n";
    case "listItem":
      if (parentType === "bulletList") return `- ${children.trim().replace(/\n+/g, " ")}\n`;
      if (parentType === "orderedList") return `${index}. ${children.trim().replace(/\n+/g, " ")}\n`;
      return children + "\n";
    case "text": {
      let out = text;
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === "bold") out = `**${out}**`;
          if (mark.type === "italic") out = `*${out}*`;
          if (mark.type === "code") out = `\`${out}\``;
        }
      }
      return out;
    }
    case "codeBlock":
      return "```\n" + children.trim() + "\n```\n\n";
    case "hardBreak":
      return "\n";
    default:
      return children;
  }
}

function buildTdpMarkdown(doc: TdpDoc): string {
  const parts: string[] = [];
  for (const s of doc.sections) {
    const sectionMarkdown = tiptapToMarkdown(s.content).trim();
    if (sectionMarkdown) parts.push(sectionMarkdown);
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function MarkdownCard({ markdown, className = "" }: { markdown: string; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-accent/20 p-4 shadow-sm ${className}`}>
      <div className="md-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ---------------- Info Dialog & AI Panel (UI only) ---------------- */

function InfoDialog({
  open,
  title,
  markdown,
  onClose,
}: {
  open: boolean;
  title: string;
  markdown: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" aria-modal="true" role="dialog">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="font-medium">{title}</div>
          <button className="p-1 rounded hover:bg-accent text-muted-foreground" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 md-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {markdown}
          </ReactMarkdown>
        </div>
        <div className="px-5 pb-4">
          <button className="btn w-full" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function AIGuidancePanel({
  open,
  sectionTitle,
  onClose,
  children,
}: {
  open: boolean;
  sectionTitle: string | null;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-0 z-[11000] ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-[420px] bg-background border-l border-border shadow-xl
                    transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-modal="true"
        aria-label="AI Guidance"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <div className="font-semibold">AI Guidance</div>
          </div>
          <button className="p-1 rounded hover:bg-accent text-muted-foreground" onClick={onClose} aria-label="Close AI panel">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border">
          For: <span className="font-medium text-foreground">{sectionTitle ?? "Section"}</span>
        </div>
        <div className="p-4 space-y-4 overflow-auto h-[calc(100%-104px)]">{children}</div>
      </aside>
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function Page() {
  const lib = sectionsLib as LibrarySection[];

  const toSection = useCallback((def: LibrarySection, tiptapJson?: any): Section => ({
    id: uid(),
    key: def.key,
    title: def.title,
    content: tiptapJson ?? def.tiptap_doc,
  }), []);

  // 🔵 READ from Zustand: active project & writer for sections
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const setTdpSection = useProjectsStore((s) => s.setTdpSection);

  // Document state rendered by this page
  const [doc, setDoc] = useState<TdpDoc>(() => ({
    id: uid(),
    name: "Technology Development Plan (TDP)",
    sections: [], // hydrate in effect below
  }));

  // Hydrate sections:
  // - If there is an active project (opened/created from Projects page), load its TDP from Zustand
  // - Else, fall back to your template (library) sections
  useEffect(() => {
    if (!lib?.length) return;

    if (activeProject?.tdp) {
      // 🔵 READ from Zustand: use project snapshot for all five keys, in defined order
      const libByKey = new Map(lib.map((d) => [d.key, d]));
      const built: Section[] = [];
      for (const key of TDP_KEYS) {
        const def = libByKey.get(key) ?? { key, title: key.replaceAll("_", " "), tiptap_doc: { type: "doc", content: [] } };
        const tiptapJson = activeProject.tdp[key]?.content ?? { type: "doc", content: [] };
        built.push(toSection(def as LibrarySection, tiptapJson));
      }
      setDoc((d) => ({ ...d, sections: built }));
    } else {
      // No active project: start with your template library content (all 5 keys)
      const built = lib
        .filter((d) => (TDP_KEYS as string[]).includes(d.key))
        .map((d) => toSection(d));
      setDoc((d) => ({ ...d, sections: built }));
    }
  }, [activeProject, lib, toSection]);

  const [currentEditor, setCurrentEditor] = useState<Editor | null>(null);

  // Info dialog
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState("");
  const [infoMarkdown, setInfoMarkdown] = useState("");
  const showInfo = useCallback((title: string, markdown: string) => { setInfoTitle(title); setInfoMarkdown(markdown); setInfoOpen(true); }, []);
  const closeInfo = useCallback(() => setInfoOpen(false), []);

  // DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const usedKeys = useMemo(
    () => new Set(doc.sections.filter((s) => !String(s.key).startsWith("custom_")).map((s) => s.key)),
    [doc.sections]
  );

  const customInfoMd =
    "### Custom Section\n\nStart from a blank page and define your own structure.\nUse this when your TDP needs a one-off section not in the library.";

  const availableTiles = useMemo(() => {
    const libs = lib.filter((d) => !usedKeys.has(d.key));
    const customTile: LibrarySection = {
      key: "custom",
      title: "Custom",
      description_md: customInfoMd,
      tiptap_doc: { type: "doc", content: [H1("Custom Section"), P("<describe>")] },
    };
    return [...libs, customTile];
  }, [lib, usedKeys]);

  const docIds = useMemo(() => doc.sections.map((s) => s.id), [doc.sections]);
  const libIds = useMemo(() => availableTiles.map((d) => `${LIB_PREFIX}${d.key}`), [availableTiles]);

  const onDragStart = useCallback((e: DragStartEvent) => { setActiveId(String(e.active.id)); }, []);
  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const overId = String(over.id);
    const activeIsLibrary = String(active.id).startsWith(LIB_PREFIX);
    const droppingIntoDoc = overId === DOC_ZONE_ID || docIds.includes(overId);

    // Reorder inside doc
    if (!activeIsLibrary) {
      if (droppingIntoDoc) {
        if (overId === DOC_ZONE_ID) return;
        const oldIndex = docIds.indexOf(String(active.id));
        const newIndex = docIds.indexOf(overId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          setDoc((d) => ({ ...d, sections: arrayMove(d.sections, oldIndex, newIndex) }));
        }
      }
      return;
    }

    // From library -> doc
    if (droppingIntoDoc) {
      const libKey = String(active.id).slice(LIB_PREFIX.length);
      if (libKey !== "custom" && doc.sections.some((s) => s.key === libKey)) return;

      const def = availableTiles.find((t) => t.key === libKey);
      let newSection: Section;
      if (libKey === "custom") {
        newSection = {
          id: uid(),
          key: `custom_${Date.now()}`,
          title: "Custom Section",
          content: { type: "doc", content: [H1("Custom Section"), P("<describe>")] },
        };
      } else if (def) {
        newSection = { id: uid(), key: def.key, title: def.title, content: def.tiptap_doc };
      } else {
        return;
      }

      setDoc((d) => {
        let insertIndex = d.sections.length;
        if (overId !== DOC_ZONE_ID) {
          const idx = d.sections.findIndex((s) => s.id === overId);
          if (idx >= 0) insertIndex = idx; // insert before hovered tile
        }
        const next = [...d.sections];
        next.splice(insertIndex, 0, newSection);
        return { ...d, sections: next };
      });
    }
  }, [doc.sections, docIds, availableTiles]);

  const removeSection = useCallback((id: string) => {
    setDoc((d) => ({ ...d, sections: d.sections.filter((s) => s.id !== id) }));
  }, []);

  const renameSection = useCallback((id: string, title: string) => {
    setDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, title } : s)) }));
  }, []);

  // 🟢 WRITE to Zustand on every edit (and update local doc)
  const setTdpSectionInStore = useCallback((sectionId: string, json: any) => {
    if (!activeProject?.id) return; // no project => nothing to persist
    const sec = doc.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    if ((TDP_KEYS as string[]).includes(String(sec.key))) {
      // 🟢 WRITE to Zustand
      setTdpSection(activeProject.id, sec.key as TdpKey, json);
    }
  }, [activeProject?.id, doc.sections, setTdpSection]);

  const updateContent = useCallback((id: string, json: any) => {
    // local UI state
    setDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, content: json } : s)) }));
    // persist to store if project is active
    setTdpSectionInStore(id, json);
  }, [setTdpSectionInStore]);

  const findMarkdownForKey = (key: string) => {
    if (key.startsWith("custom")) return customInfoMd;
    const def = (lib as LibrarySection[]).find((d) => d.key === key);
    return def?.description_md ?? "";
  };

  const activePreviewTitle = useMemo(() => {
    if (!activeId) return null;
    if (activeId.startsWith(LIB_PREFIX)) {
      const libKey = activeId.slice(LIB_PREFIX.length);
      const def = availableTiles.find((t) => t.key === libKey);
      return def?.title ?? null;
    }
    const s = doc.sections.find((sec) => sec.id === activeId);
    return s?.title ?? null;
  }, [activeId, availableTiles, doc.sections]);

  // AI drawer state (optional UI)
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSectionTitle, setAiSectionTitle] = useState<string | null>(null);
  const [aiSectionId, setAiSectionId] = useState<string | null>(null);
  const openAIForSection = useCallback((section: Section) => {
    setAiSectionId(section.id);
    setAiSectionTitle(section.title);
    setAiOpen(true);
  }, []);
  const aiSection = useMemo(() => doc.sections.find((s) => s.id === aiSectionId) ?? null, [doc.sections, aiSectionId]);
  const aiSectionMarkdown = useMemo(() => tiptapToMarkdown(aiSection?.content) || "", [aiSection]);

  const [showRaw, setShowRaw] = useState(false);
  const [aiTask, setAiTask] = useState<null | "guidance" | "smart" | "assumptions" | "lint">(null);
  const [aiOut, setAiOut] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const callInline = useCallback(async (task: "guidance" | "smart" | "assumptions" | "lint") => {
    const sec = aiSection;
    if (!sec) return;

    const payload = {
      task,
      section_title: sec.title,
      section_markdown: tiptapToMarkdown(sec.content),
      tdp_markdown: buildTdpMarkdown(doc),
    };

    setAiTask(task);
    setAiLoading(true);
    setAiOut("");
    setAiError(null);

    try {
      const r = await fetch("/api/ai/tdp/inline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok || data.error) {
        setAiError(typeof data.error === "string" ? data.error : "Agent error");
      } else {
        setAiOut(data.markdown || "");
      }
    } catch (e: any) {
      setAiError(e?.message || "Network error");
    } finally {
      setAiLoading(false);
    }
  }, [aiSection, doc]);

  return (
    <div className="flex min-h-0 tdp-doc">
      {/* Sidebar */}
      <aside className="w-80 border-r border-border p-3 space-y-3 overflow-auto">
        <div className="text-sm font-semibold mb-1">
          Technology Development Plan {activeProject?.name ? `— ${activeProject.name}` : ""}
        </div>
        {activeProject?.isCaseStudy && activeProject.caseStudyId ? (
          <div className="text-xs text-muted-foreground">
            Case study: <span className="font-medium">{activeProject.caseStudyId}</span>
          </div>
        ) : null}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          modifiers={[restrictToFirstScrollableAncestor, restrictToVerticalAxis]}
        >
          {/* TABLE OF CONTENTS */}
          <DroppableZone id={DOC_ZONE_ID}>
            <SortableContext items={docIds} strategy={verticalListSortingStrategy}>
              {doc.sections.length === 0 ? (
                <div className="min-h-[140px] rounded-md border-2 border-dashed border-border/60 bg-muted/10
                                flex items-center justify-center text-sm text-muted-foreground">
                  <div className="text-center space-y-1 py-6 px-4">
                    <div className="inline-flex items-center gap-2">
                      <Move className="h-4 w-4" />
                      <span>Drag sections here to build your TDP</span>
                    </div>
                    <div className="text-xs opacity-80">
                      Tip: Reorder anytime. Click ⓘ on a tile to read the guideline.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {doc.sections.map((s) => (
                    <SelectedTile
                      key={s.id}
                      section={s}
                      onInfo={() => showInfo(s.title, findMarkdownForKey(String(s.key)))}
                      onRemove={() => removeSection(s.id)}
                      onRename={(t) => renameSection(s.id, t)}
                    />
                  ))}
                </div>
              )}
            </SortableContext>
          </DroppableZone>

          {/* LIBRARY */}
          <div className="pt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Drag from below into the list above.</span>
              <span className="badge-pill whitespace-nowrap" title="The list below is our recommended section order">
                Suggested order
              </span>
            </div>
            <DroppableZone id={LIB_ZONE_ID}>
              <SortableContext items={libIds} strategy={verticalListSortingStrategy}>
                <div className="grid grid-cols-1 gap-2">
                  {availableTiles.map((d) => (
                    <LibraryTile
                      key={String(d.key)}
                      libKey={String(d.key)}
                      title={d.title}
                      onInfo={() => showInfo(d.title, d.description_md)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DroppableZone>
          </div>

          {/* Drag overlay ghost */}
          <DragOverlay dropAnimation={null}>
            {activePreviewTitle ? (
              <div className="drag-tile pointer-events-none">
                <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 bg-card shadow-lg scale-[1.03]">
                  <div className="cursor-grabbing select-none text-muted-foreground">⋮⋮</div>
                  <div className="flex-1 text-sm">{activePreviewTitle}</div>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <div className="pt-3">
          <button
            className="btn w-full"
            onClick={() => {
              console.log("TDP JSON", doc);
              alert("Exported TDP JSON to console");
            }}
          >
            Export JSON
          </button>
        </div>
      </aside>

      {/* Editors */}
      <main className="flex-1 min-h-0 p-6 space-y-6 overflow-visible">
        {doc.sections.map((s) => (
          <SectionEditor
            key={s.id}
            section={s}
            onChange={(json) => updateContent(s.id, json)} // 🟢 writes to Zustand via updateContent → setTdpSectionInStore
            onFocusEditor={setCurrentEditor}
            onOpenAI={(section) => {
              setAiSectionId(section.id);
              setAiSectionTitle(section.title);
              setAiOpen(true);
            }}
          />
        ))}
        <FloatingToolbar editor={currentEditor} />
      </main>

      {/* Info dialog */}
      <InfoDialog open={infoOpen} title={infoTitle} markdown={infoMarkdown} onClose={closeInfo} />

      {/* AI side panel (optional) */}
      <AIGuidancePanel
        open={aiOpen}
        sectionTitle={aiSectionTitle}
        onClose={() => { setAiOpen(false); setAiOut(""); setAiError(null); setAiTask(null); }}
      >
        <div className="space-y-4">
          <div>
            <div className="font-medium mb-2">Inline actions</div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={aiLoading}
                onClick={() => callInline("guidance")}
                className={[
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  "hover:bg-accent transition",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                  aiTask === "guidance" ? "border-ring shadow-[inset_0_0_0_1px_color-mix(in_oklab,hsl(var(--ring))_40%,transparent)]" : "border-border",
                ].join(" ")}
                title="Guidance"
                aria-label="Guidance"
              >
                <Sparkles className="h-4 w-4" />
                <span>Guidance</span>
              </button>

              <button
                disabled={aiLoading}
                onClick={() => callInline("smart")}
                className={[
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  "hover:bg-accent transition",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                  aiTask === "smart" ? "border-ring shadow-[inset_0_0_0_1px_color-mix(in_oklab,hsl(var(--ring))_40%,transparent)]" : "border-border",
                ].join(" ")}
                title="Make SMART"
                aria-label="Make SMART"
              >
                <ListChecks className="h-4 w-4" />
                <span>Make SMART</span>
              </button>

              <button
                disabled={aiLoading}
                onClick={() => callInline("assumptions")}
                className={[
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  "hover:bg-accent transition",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                  aiTask === "assumptions" ? "border-ring shadow-[inset_0_0_0_1px_color-mix(in_oklab,hsl(var(--ring))_40%,transparent)]" : "border-border",
                ].join(" ")}
                title="Assumptions"
                aria-label="Assumptions"
              >
                <FileQuestion className="h-4 w-4" />
                <span>Assumptions</span>
              </button>

              <button
                disabled={aiLoading}
                onClick={() => callInline("lint")}
                className={[
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  "hover:bg-accent transition",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                  aiTask === "lint" ? "border-ring shadow-[inset_0_0_0_1px_color-mix(in_oklab,hsl(var(--ring))_40%,transparent)]" : "border-border",
                ].join(" ")}
                title="Lint"
                aria-label="Lint"
              >
                <ShieldAlert className="h-4 w-4" />
                <span>Lint</span>
              </button>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              {aiLoading ? "Running…" : aiTask ? `Last run: ${aiTask}` : "Idle"}
            </div>
            {aiError && <div className="mt-2 text-xs text-red-600">Error: {aiError}</div>}
          </div>

          {aiOut && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium">AI Result</div>
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-muted-foreground">View:</span>
                  <button
                    className={`px-2 py-0.5 rounded border ${!showRaw ? "border-ring" : "border-border"}`}
                    onClick={() => setShowRaw(false)}
                  >
                    Rendered
                  </button>
                  <button
                    className={`px-2 py-0.5 rounded border ${showRaw ? "border-ring" : "border-border"}`}
                    onClick={() => setShowRaw(true)}
                  >
                    Raw
                  </button>
                </div>
              </div>

              {!showRaw ? (
                <MarkdownCard markdown={aiOut} className="max-h-[36vh] overflow-auto" />
              ) : (
                <pre className="text-xs whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 max-h-[36vh] overflow-auto">
                  {aiOut}
                </pre>
              )}

              <div className="mt-2 flex gap-2">
                <button
                  className="btn"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(aiOut); } catch {}
                  }}
                >
                  Copy result
                </button>
              </div>
            </div>
          )}

          <div className="pt-2">
            <div className="font-medium mb-1">Section markdown (sent to agent)</div>
            <pre className="text-xs whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 max-h-[28vh] overflow-auto">
              {aiSectionMarkdown.trim()}
            </pre>
          </div>

          <div>
            <div className="font-medium mb-1">Entire TDP (Markdown)</div>
            <pre className="text-xs whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 max-h-[28vh] overflow-auto">
              {buildTdpMarkdown(doc)}
            </pre>
          </div>
        </div>
      </AIGuidancePanel>
    </div>
  );
}
