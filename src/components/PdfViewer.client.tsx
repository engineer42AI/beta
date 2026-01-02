"use client";

import React, { useEffect, useMemo, useRef, useState, ComponentProps } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

type OnItemClickArgs = Parameters<NonNullable<ComponentProps<typeof Document>["onItemClick"]>>[0];

useEffect(() => {
  // ensure this never runs during Node build/SSR analysis
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@5.3.93/build/pdf.worker.min.mjs";
}, []);

type Props = {
  fileUrl: string;          // e.g. "/api/regpdf/cs25"
  searchTerm?: string;      // initial section term, e.g. "25.1309"
  initialPage?: number;
};

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// Normalize "CS 25.1309" → "25.1309"
function normalizeSectionTerm(s?: string) {
  return (s || "").replace(/^CS\s*/i, "").trim();
}

export default function PdfViewer({ fileUrl, searchTerm, initialPage = 1 }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [page, setPage] = useState<number>(initialPage);
  const [zoom, setZoom] = useState(1);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // search state
  const [term, setTerm] = useState(normalizeSectionTerm(searchTerm));
  useEffect(() => setTerm(normalizeSectionTerm(searchTerm)), [searchTerm]);

  // responsive width
  const containerRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null); // wraps <Page/> to find text layer
  const [pageWidth, setPageWidth] = useState<number>(800);
  useEffect(() => {
    const resize = () => {
      const w = containerRef.current?.clientWidth || 800;
      setPageWidth(Math.max(320, Math.min(w - 2, 1600)));
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // highlight with <mark>
  const highlightRenderer = useMemo(() => {
    const t = term?.trim();
    if (!t) return undefined;
    const re = new RegExp(escapeRegExp(t), "gi");
    return ({ str }: { str: string }) => str.replace(re, (m) => `<mark>${m}</mark>`);
  }, [term]);

  // internal links (TOC)
  const handleItemClick = ({ pageNumber }: OnItemClickArgs) => {
    if (pageNumber) setPage(pageNumber);
  };

  // ---- Match navigation on the current page ----
  const [matchIndex, setMatchIndex] = useState(0);

  // helper: get all <mark> nodes in the current page's text layer
  function getMarks(): HTMLElement[] {
    const scope =
      pageContainerRef.current?.querySelector(".textLayer") ||
      pageContainerRef.current || undefined;
    if (!scope) return [];
    return Array.from(scope.querySelectorAll("mark")) as HTMLElement[];
  }

  // When page or term changes, reset match index and try to focus first mark
  useEffect(() => {
    setMatchIndex(0);
    // slight delay to let text layer render
    const t = setTimeout(() => {
      const marks = getMarks();
      if (marks.length) {
        marks[0].scrollIntoView({ block: "center" });
        marks[0].style.outline = "2px solid rgba(250, 204, 21, 0.9)"; // accent around first
        setTimeout(() => (marks[0].style.outline = ""), 500);
      }
    }, 100);
    return () => clearTimeout(t);
  }, [page, term]);

  function gotoMatch(next = true) {
    const marks = getMarks();
    if (!marks.length) return false;
    let i = matchIndex;
    i = next ? (i + 1) % marks.length : (i - 1 + marks.length) % marks.length;
    setMatchIndex(i);
    marks[i].scrollIntoView({ block: "center" });
    // brief flash
    marks[i].style.outline = "2px solid rgba(250, 204, 21, 0.9)";
    setTimeout(() => (marks[i].style.outline = ""), 300);
    return true;
  }

  // ---- Find next/prev page that contains the term ----
  async function findNextPageWithTerm(direction: 1 | -1) {
    if (!term?.trim() || !numPages) return;
    const target = term.toLowerCase();
    let pn = page;
    for (let step = 0; step < numPages - 1; step++) {
      pn = pn + direction;
      if (pn < 1) pn = numPages;
      if (pn > numPages) pn = 1;
      // move to page and wait a tick for text layer
      setPage(pn);
      await new Promise((r) => setTimeout(r, 150));
      const scope = pageContainerRef.current?.querySelector(".textLayer") as HTMLElement | null;
      const text = scope?.innerText?.toLowerCase() || "";
      if (text.includes(target)) {
        // focus first match on that page
        const marks = getMarks();
        if (marks.length) {
          setMatchIndex(0);
          marks[0].scrollIntoView({ block: "center" });
        }
        return;
      }
    }
  }

  // keyboard shortcuts: n/p for next/prev match
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "n") {
        if (!gotoMatch(true)) findNextPageWithTerm(1);
      } else if (e.key === "p") {
        if (!gotoMatch(false)) findNextPageWithTerm(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matchIndex, term, numPages, page]);

  // ---- UI ----
  const [goto, setGoto] = useState<string>("");

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Page nav */}
        <button className="rounded border px-2 py-1 text-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}>Prev</button>
        <button className="rounded border px-2 py-1 text-sm"
                onClick={() => setPage((p) => Math.min(numPages || p + 1, p + 1))}
                disabled={!numPages || page >= numPages}>Next</button>
        <div className="text-sm text-gray-600">Page {page} / {numPages || "—"}</div>

        {/* Zoom */}
        <div className="ml-2 flex items-center gap-1">
          <button className="rounded border px-2 py-1 text-sm"
                  onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
                  title="Zoom out">−</button>
          <div className="px-1 text-sm w-12 text-center">{Math.round(zoom * 100)}%</div>
          <button className="rounded border px-2 py-1 text-sm"
                  onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
                  title="Zoom in">+</button>
        </div>

        {/* Go to page */}
        <div className="ml-2 flex items-center gap-1">
          <label className="text-xs text-gray-600">Go to:</label>
          <input
            value={goto}
            onChange={(e) => setGoto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(goto, 10);
                if (!Number.isNaN(n) && n >= 1 && n <= (numPages || n)) setPage(n);
              }
            }}
            className="rounded border px-2 py-1 text-sm w-16"
            placeholder="page"
          />
        </div>
      </div>

      {/* Viewer */}
      <div ref={containerRef} className="w-full border rounded bg-white">
        <div ref={pageContainerRef}>
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages }) => { setNumPages(numPages); setLoadErr(null); }}
            onLoadError={(e) => setLoadErr((e as Error)?.message || "Failed to load PDF")}
            onItemClick={handleItemClick}
            loading={<div className="p-4 text-sm text-gray-600">Loading PDF…</div>}
            error={<div className="p-4 text-sm text-rose-600">{loadErr}</div>}
            externalLinkTarget="_blank"
          >
            <Page
              pageNumber={page}
              width={pageWidth * zoom}
              renderTextLayer
              renderAnnotationLayer
              customTextRenderer={highlightRenderer}
            />
          </Document>
        </div>
      </div>

      <style jsx global>{`
        mark { background: #fde047; padding: 0 2px; border-radius: 2px; }
      `}</style>
    </div>
  );
}
