// src/app/technology-development-plan-V1/page.tsx
"use client";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { EditorContent, useEditor, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { X } from "lucide-react";
/* ---------------- Types & helpers ---------------- */

type SectionType = "tech_goals" | "competition" | "tech_strands" | "custom";
type Section = { id: string; type: SectionType; title: string; content: any };
type TdpDoc = { id: string; name: string; sections: Section[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const H1 = (t: string) => ({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: t }] });
const P  = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

const templates: Record<SectionType, any> = {
  tech_goals:   { type: "doc", content: [H1("Technology Goals"), P("<describe the goals of the technology>")] },
  competition:  { type: "doc", content: [H1("Competition"),      P("<describe competing technologies>")] },
  tech_strands: { type: "doc", content: [H1("Technology Strands"),P("<describe strands>")] },
  custom:       { type: "doc", content: [H1("New Section"),       P("<describe>")] },
};

/* ---------------- Sortable item ---------------- */

function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

/* ---------------- Debounce utility ---------------- */

function useDebounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  const t = useRef<number | null>(null);
  return (...args: Parameters<T>) => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => fn(...args), ms);
  };
}

/* ---------------- Section editor ---------------- */

function SectionEditor({
  section,
  onChange,
  onFocusEditor,
}: {
  section: Section;
  onChange: (json: any) => void;
  onFocusEditor: (ed: Editor | null) => void;   // ← allow null
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: true, blockquote: true }),
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

  // Wire TipTap focus/blur -> parent
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
    return () => editor.off("update", upd);
  }, [editor, debounced]);

  // when section identity changes, reset content (e.g., reordering keeps editor; content stays)
  useEffect(() => { if (editor) editor.commands.setContent(section.content, false); }, [section.id, editor]);

  return (
    <section className="tiptap-card">
      <div className="px-5 pt-4 text-sm text-muted-foreground">{section.title}</div>
      <div className="px-5 pb-5">
        <EditorContent
          editor={editor}
        />
      </div>
    </section>
  );
}

/* ---------------- Floating toolbar (Canva-like), targets current editor ---------------- */

function FloatingToolbar({ editor }: { editor: Editor | null }) {
  const [showInsert, setShowInsert] = useState(false);
  const [showText, setShowText] = useState(false);
  const [focused, setFocused] = useState(false);           // <-- NEW
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
    // bottom of the handle (open) == r.top + r.height; top of ConsoleBar (closed) == r.top
    const edgeBottom = r.bottom; // works for both, since bottom==top+height
    const offset = Math.max(0, Math.round(window.innerHeight - edgeBottom));
    document.documentElement.style.setProperty("--console-offset", `${offset}px`);
  };

  // observers + listeners
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
  window.addEventListener("pointerup", update);   // after user drag ends

  return () => {
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener("resize", update);
    window.removeEventListener("scroll", update, true);
    window.removeEventListener("pointerup", update);
  };
}, []);

  // Track editor focus/blur to show/hide bar
  // 🔧 NEW: when editor instance changes, initialize focused state immediately
  useEffect(() => {
      setFocused(Boolean(editor?.isFocused));
  }, [editor]);

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

  // outside click just closes dropdowns (not the bar)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeAll();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [closeAll]);

  // esc closes dropdowns
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAll(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeAll]);

  // selection changes: tidy menus
  useEffect(() => {
    if (!editor) return;
    const sel = () => closeAll();
    editor.on("selectionUpdate", sel);
    return () => editor.off("selectionUpdate", sel);
  }, [editor, closeAll]);

  if (!editor) return null;

  const visible = focused;                                  // <-- show only when focused
  const keepFocus = (e: React.MouseEvent) => e.preventDefault(); // <-- don't blur editor

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
      onClick={() => { onClick(); closeAll(); }}
    >
      {label}
    </button>
  );

  if (!editor || !focused) return null; // only show if active editor is focused

  return (
    <div
      className={`tt-floating-wrap transition-opacity duration-150 ${
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      onMouseDown={keepFocus}     // <-- keep editor focused while using toolbar
      aria-hidden={!visible}
    >
      <div ref={rootRef} className="tt-floating-toolbar">
        {/* + Insert */}
        <div className="tt-group">
          <Btn title="+ Insert" onClick={() => { closeAll(); setShowInsert(true); }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z"/></svg>
          </Btn>
          {showInsert && (
            <div className="tt-menu tt-menu-grid-insert" onMouseDown={(e) => e.preventDefault()}>
              <MenuItem label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
              <MenuItem label="Quote"          onClick={() => editor.chain().focus().toggleBlockquote().run()} />
              <MenuItem label="Code block"     onClick={() => editor.chain().focus().setCodeBlock().run()} />
            </div>
          )}
        </div>

        <Divider />

        {/* T dropdown: H1–H4 and B/I/S/U */}
        <div className="tt-group">
          <Btn title="Text & formatting" onClick={() => { closeAll(); setShowText(true); }}>
            <span className="tt-text-T">T</span>
            <svg width="12" height="12" viewBox="0 0 24 24" style={{ marginLeft: 6 }}>
              <path fill="currentColor" d="M7 10l5 5 5-5z" />
            </svg>
          </Btn>
          {showText && (
            <div className="tt-menu tt-menu-grid-format" onMouseDown={(e) => e.preventDefault()}>
              <MenuItem label="H1" active={editor.isActive("heading",{level:1})} onClick={() => editor.chain().focus().toggleHeading({level:1}).run()} />
              <MenuItem label="H2" active={editor.isActive("heading",{level:2})} onClick={() => editor.chain().focus().toggleHeading({level:2}).run()} />
              <MenuItem label="H3" active={editor.isActive("heading",{level:3})} onClick={() => editor.chain().focus().toggleHeading({level:3}).run()} />
              <MenuItem label="H4" active={editor.isActive("heading",{level:4})} onClick={() => editor.chain().focus().toggleHeading({level:4}).run()} />
              <MenuItem label={<strong>B</strong>} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
              <MenuItem label={<em style={{fontStyle:"italic"}}>/</em>} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
              <MenuItem label={<span style={{textDecoration:"line-through"}}>S</span>} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
              <MenuItem label={<span style={{textDecoration:"underline"}}>U</span>} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
            </div>
          )}
        </div>

        {/* Lists */}
        <Btn title="Bulleted list"  active={editor.isActive("bulletList")}  onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M8 6h12v2H8zM4 5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3zM8 11h12v2H8zM4 10a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3zM8 16h12v2H8zM4 15a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3z"/></svg>
        </Btn>
        <Btn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M8 6h12v2H8zM4 7h2V5H4V4h3v4H4V7zm4 5h12v2H8zM4 14h3v-1H5v-1h2v-1H4v3zm4 5h12v2H8zM4 20h3v-1H6v-.5h1v-1H4V20z"/></svg>
        </Btn>

        <Divider />

        {/* Code / Quote */}
        <Btn title="Code"  active={editor.isActive("code")}       onClick={() => editor.chain().focus().toggleCode().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="m8.6 16.6-1.2 1.2L2.6 13l4.8-4.8 1.2 1.2L5 13zM15.4 7.4l1.2-1.2 4.8 4.8-4.8 4.8-1.2-1.2L19 11z"/></svg>
        </Btn>
        <Btn title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M7 7h5v5H9.6A3.6 3.6 0 0 0 6 15.6V12a5 5 0 0 1 5-5H7zm9 0h5v5h-2.4A3.6 3.6 0 0 0 15 15.6V12a5 5 0 0 1 5-5h-4z"/></svg>
        </Btn>

        <Divider />

        {/* Align */}
        <Btn title="Align left"   onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v2H3zm0 4h12v2H3zm0 4h18v2H3zm0 4h12v2H3z"/></svg>
        </Btn>
        <Btn title="Align center" onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v2H3zm3 4h12v2H6zm-3 4h18v2H3zm3 4h12v2H6z"/></svg>
        </Btn>
        <Btn title="Align right"  onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v2H3zm6 4h12v2H9zM3 13h18v2H3zm6 4h12v2H9z"/></svg>
        </Btn>
      </div>
    </div>
  );
}


/* ---------------- Page ---------------- */

export default function Page() {
  const [doc, setDoc] = useState<TdpDoc>(() => ({
    id: uid(),
    name: "Technology Development Plan (TDP)",
    sections: [
      { id: uid(), type: "tech_goals",  title: "Technology Goals",  content: templates.tech_goals },
      { id: uid(), type: "competition", title: "Competition",       content: templates.competition },
    ],
  }));
  const [currentEditor, setCurrentEditor] = useState<Editor | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useMemo(() => doc.sections.map(s => s.id), [doc.sections]);

  const addSection = useCallback((type: SectionType) => {
    const s: Section = {
      id: uid(),
      type,
      title: type === "tech_goals" ? "Technology Goals"
            : type === "competition" ? "Competition"
            : type === "tech_strands" ? "Technology Strands" : "Custom Section",
      content: templates[type],
    };
    setDoc(d => ({ ...d, sections: [...d.sections, s] }));
  }, []);

  const removeSection = useCallback((id: string) => {
    setDoc(d => ({ ...d, sections: d.sections.filter(s => s.id !== id) }));
  }, []);

  const renameSection = useCallback((id: string, title: string) => {
    setDoc(d => ({ ...d, sections: d.sections.map(s => s.id === id ? { ...s, title } : s) }));
  }, []);

  const onDragEnd = useCallback((event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDoc(d => {
      const oldIndex = d.sections.findIndex(s => s.id === active.id);
      const newIndex = d.sections.findIndex(s => s.id === over.id);
      return { ...d, sections: arrayMove(d.sections, oldIndex, newIndex) };
    });
  }, []);

  const updateContent = useCallback((id: string, json: any) => {
    setDoc(d => ({ ...d, sections: d.sections.map(s => s.id === id ? { ...s, content: json } : s) }));
  }, []);

  const exportJson = useCallback(() => {
    console.log("TDP JSON", doc);
    alert("Exported TDP JSON to console");
  }, [doc]);

  return (
    <div className="flex h-[calc(100vh-60px)] tdp-doc">
      {/* Sidebar */}
      <aside className="w-72 border-r border-border p-3 space-y-3 overflow-auto">
        <div className="text-sm font-semibold mb-1">{doc.name}</div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {doc.sections.map((s) => (
                <SortableItem key={s.id} id={s.id}>
                  <div className="group flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                    <div className="cursor-grab select-none text-muted-foreground">⋮⋮</div>
                    <input
                      className="flex-1 bg-transparent outline-none"
                      value={s.title}
                      onChange={(e) => renameSection(s.id, e.target.value)}
                    />
                    <button
                      onClick={() => removeSection(s.id)}
                      className="p-1 rounded opacity-70 hover:opacity-100
                                 text-muted-foreground hover:text-destructive
                                 hover:bg-accent focus-visible:outline-none
                                 focus-visible:ring-2 focus-visible:ring-ring"
                      title="Delete section"
                      aria-label="Delete section"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </SortableItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="pt-3 space-y-2">
          <div className="text-xs text-muted-foreground">Add section</div>
          <div className="grid grid-cols-1 gap-2">
            <button className="btn" onClick={() => addSection("tech_goals")}>+ Technology Goals</button>
            <button className="btn" onClick={() => addSection("competition")}>+ Competition</button>
            <button className="btn" onClick={() => addSection("tech_strands")}>+ Technology Strands</button>
            <button className="btn" onClick={() => addSection("custom")}>+ Custom</button>
          </div>
        </div>

        <div className="pt-3">
          <button className="btn w-full" onClick={exportJson}>Export JSON</button>
        </div>
      </aside>

      {/* Editors */}
      <main className="flex-1 overflow-auto p-6 space-y-6">
        {doc.sections.map((s) => (
          <SectionEditor
            key={s.id}
            section={s}
            onChange={(json) => updateContent(s.id, json)}
            onFocusEditor={setCurrentEditor}
          />
        ))}
        {/* one floating toolbar controlling whichever editor is focused */}
        <FloatingToolbar editor={currentEditor} />
      </main>
    </div>
  );
}
