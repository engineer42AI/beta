// src/app/(protected)/system-b/browse-cert-specs-V4/NeedsWorkspaceFlow.tsx
"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitBranch, Save, GitFork, CheckCircle2, Trash2 } from "lucide-react";

type NeedsDecisionsMap = Record<string, any>;
type NeedsEvalsMap = Record<string, any>;

type Commit = {
  id: string;
  parentId?: string | null;
  createdAt: string;
  message: string;
  decisions: NeedsDecisionsMap;
  evals: NeedsEvalsMap;
};

type Branch = {
  id: string;
  name: string;
  head: string; // commit id
  createdAt: string;
  // NEW (optional so old localStorage still loads)
  forkFromCommitId?: string | null; // commit id you forked FROM
  forkFromBranchId?: string | null; // branch id you forked FROM
};

type WorkspaceState = {
  version: 1;
  currentBranchId: string;
  branches: Record<string, Branch>;
  commits: Record<string, Commit>;
};

type Props = {
  tabId: string;
  className?: string;
  maxDepth?: number; // how many commits per branch to show
};

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function shallowJsonEqual(a: any, b: any) {
  try {
    return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  } catch {
    return false;
  }
}

function dispatchNeedsTableReload(tabId: string) {
  try {
    window.dispatchEvent(new CustomEvent("e42.needsTable.reload", { detail: { tabId } }));
  } catch {}
}

function pruneOrphanCommits(next: WorkspaceState): WorkspaceState {
  const reachable = new Set<string>();

  const visit = (headId: string) => {
      let cur: Commit | undefined = next.commits[headId];
      let guard = 0;

      while (cur && guard++ < 5000) {
        if (reachable.has(cur.id)) break;
        reachable.add(cur.id);

        if (!cur.parentId) break;
        cur = next.commits[cur.parentId]; // may become undefined at runtime -> loop ends
      }
  };

  for (const b of Object.values(next.branches)) {
    if (b?.head) visit(b.head);
  }

  const prunedCommits: Record<string, Commit> = {};
  for (const id of reachable) {
    const c = next.commits[id];
    if (c) prunedCommits[id] = c;
  }

  return { ...next, commits: prunedCommits };
}

/* ---------------- Mermaid rendering ---------------- */

let MERMAID_INIT_DONE = false;

async function renderMermaidInto(el: HTMLDivElement, diagram: string) {
  const mermaid = (await import("mermaid")).default;

  if (!MERMAID_INIT_DONE) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "neutral",
    });
    MERMAID_INIT_DONE = true;
  }

  const id = `mmd-${Math.random().toString(36).slice(2)}`;
  const { svg } = await mermaid.render(id, diagram);
  el.innerHTML = svg;
}

/**
 * Add:
 * - hover tooltip (SVG <title>) for commit labels (full message)
 * - click label to show details panel
 */
function enhanceMermaidSvg(
  root: HTMLDivElement,
  labelToFull: Record<string, string>,
  branchMermaidToId: Record<string, string>,
  branchMermaidToTitle: Record<string, string>,
  activeBranchMermaid: string,
  onPickCommit: (label: string) => void,
  onPickBranch: (branchId: string) => void
) {
  const svg = root.querySelector("svg");
  if (!svg) return;

  // clear commit selection by clicking whitespace
  const anySvg = svg as any;
  if (anySvg.__e42ClickBound) svg.removeEventListener("click", anySvg.__e42ClickBound);
  const clear = () => onPickCommit("");
  anySvg.__e42ClickBound = clear;
  svg.addEventListener("click", clear);

  const texts = Array.from(svg.querySelectorAll("text"));

  for (const t of texts) {
    const raw = (t.textContent ?? "").trim();
    if (!raw) continue;

    const isCommit = raw in labelToFull;
    const isBranch = raw in branchMermaidToId;

    if (!isCommit && !isBranch) continue;

    // replace node to avoid stacking listeners across rerenders
    const cloned = t.cloneNode(true) as SVGTextElement;
    cloned.style.cursor = "pointer";

    // remove existing titles
    Array.from(cloned.querySelectorAll("title")).forEach((n) => n.remove());

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    if (isCommit) {
      title.textContent = labelToFull[raw];
    } else {
      title.textContent = `Switch to branch: ${branchMermaidToTitle[raw] ?? raw}`;
    }
    cloned.appendChild(title);

    // subtle active styling for branch label
    if (isBranch && raw === activeBranchMermaid) {
      cloned.style.fontWeight = "700";
      cloned.style.textDecoration = "underline";
    }

    cloned.addEventListener("click", (e) => {
      e.stopPropagation(); // don't trigger clear()
      if (isCommit) {
        onPickCommit(raw);
      } else {
        onPickBranch(branchMermaidToId[raw]);
      }
    });

    t.replaceWith(cloned);
  }
}

/* ---------------- GitGraph builder ---------------- */

function sanitizeMermaidIdent(s: string) {
  // Mermaid gitGraph branch identifiers: safest to keep [A-Za-z0-9_]
  const base = String(s ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "branch";
}

type GitGraphBuild = {
  diagram: string;
  labelToFull: Record<string, string>;
  branchIdToMermaid: Record<string, string>;
  branchMermaidToId: Record<string, string>;
  branchMermaidToTitle: Record<string, string>;
  activeBranchMermaid: string;
};

function buildGitGraph(state: WorkspaceState, maxDepth: number): GitGraphBuild {
  const commits = state.commits;

  const branches = Object.values(state.branches).sort((a, b) => {
    if (a.id === "main") return -1;
    if (b.id === "main") return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const main = state.branches["main"] ?? branches[0];
  if (!main) {
      return {
        diagram: 'gitGraph\n  commit id:"(no data)"',
        labelToFull: {},
        branchIdToMermaid: { main: "main" },
        branchMermaidToId: { main: "main" },
        branchMermaidToTitle: { main: "Main" },
        activeBranchMermaid: "main",
      };
  }

  // -------- helpers --------

  const chainBack = (headId: string, stopAtId?: string | null) => {
      const out: Commit[] = [];
      let cur: Commit | undefined = commits[headId];
      let guard = 0;

      while (cur && guard++ < maxDepth) {
        out.push(cur);
        if (stopAtId && cur.id === stopAtId) break;

        if (!cur.parentId) break;
        cur = commits[cur.parentId]; // may be undefined -> loop ends
      }
      return out;
  };

  // Allocate mermaid-safe branch names
  const branchIdToMermaid: Record<string, string> = { main: "main" };
  const usedBranchNames = new Set<string>(["main"]);

  const allocBranchName = (b: Branch) => {
    if (b.id === "main") return "main";
    const base = sanitizeMermaidIdent(b.name || b.id);
    let name = base;
    let i = 2;
    while (usedBranchNames.has(name) || name.toLowerCase() === "gitgraph") {
      name = `${base}_${i++}`;
    }
    usedBranchNames.add(name);
    branchIdToMermaid[b.id] = name;
    return name;
  };
  for (const b of branches) allocBranchName(b);

  // Labels
  const labelToFull: Record<string, string> = {};
  const commitIdToLabel: Record<string, string> = {};
  const usedLabels = new Set<string>();

  const shortLabel = (s: string) =>
    String(s ?? "")
      .replace(/"/g, "'")
      .trim()
      .slice(0, 28);

  const ensureLabel = (c: Commit) => {
    if (commitIdToLabel[c.id]) return commitIdToLabel[c.id];

    const base = shortLabel(c.message || "Commit") || "Commit";
    let label = base;
    let i = 2;
    while (usedLabels.has(label)) label = `${base} (${i++})`;

    usedLabels.add(label);
    commitIdToLabel[c.id] = label;
    labelToFull[label] = c.message || "Commit";
    return label;
  };

  // -------- infer forkFromCommitId for older stored branches (best-effort) --------
  // Your fork model creates the branch and its first commit at the same time (same nowIso),
  // so we can usually locate the "branch first commit" by createdAt.
  const inferForkFromCommitId = (b: Branch): string | null => {
    if (b.id === "main") return null;
    if (b.forkFromCommitId) return b.forkFromCommitId;

    const back = chainBack(b.head, null); // newest->oldest (maxDepth)
    // find commit in this chain whose createdAt matches branch.createdAt (exact) or closest
    let best: { c: Commit; score: number } | null = null;

    for (const c of back) {
      if (!c?.createdAt) continue;
      const score = c.createdAt === b.createdAt ? 0 : Math.abs(Date.parse(c.createdAt) - Date.parse(b.createdAt));
      if (!best || score < best.score) best = { c, score };
    }

    const firstCommit = best?.c;
    return firstCommit?.parentId ?? null;
  };

  // -------- build children-by-forkCommit map --------

  type BranchInfo = {
    branchId: string;
    mermaidName: string;
    forkFromCommitId: string | null;
    head: string;
    createdAt: string;
  };

  const infos: BranchInfo[] = branches
    .filter((b) => b.id !== "main")
    .map((b) => ({
      branchId: b.id,
      mermaidName: branchIdToMermaid[b.id],
      forkFromCommitId: inferForkFromCommitId(b),
      head: b.head,
      createdAt: b.createdAt,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const childrenByFork: Record<string, BranchInfo[]> = {};
  const dangling: BranchInfo[] = [];

  for (const info of infos) {
    if (!info.forkFromCommitId || !commits[info.forkFromCommitId]) {
      dangling.push(info);
      continue;
    }
    (childrenByFork[info.forkFromCommitId] ||= []).push(info);
  }

  for (const k of Object.keys(childrenByFork)) {
    childrenByFork[k].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // -------- render --------

  const lines: string[] = [];
  lines.push("gitGraph");

  // Main chain: walk back from head for maxDepth and reverse
  const mainBack = chainBack(main.head, null); // newest->oldest
  const mainChain = mainBack.slice().reverse(); // oldest->newest

  if (!mainChain.length) {
      lines.push(
        `  commit id:"${ensureLabel({
          id: "init",
          parentId: null,
          createdAt: "",
          message: "Initial",
          decisions: {},
          evals: {},
        } as any)}"`
      );

      return {
        diagram: lines.join("\n"),
        labelToFull,
        branchIdToMermaid,
        branchMermaidToId: { main: "main" },
        branchMermaidToTitle: { main: "Main" },
        activeBranchMermaid: "main",
      };
  }

  const emittedBranches = new Set<string>(["main"]);

  const emitBranchFromFork = (info: BranchInfo, returnTo: string) => {
    const bName = info.mermaidName;
    if (!emittedBranches.has(bName)) {
      lines.push(`  branch ${bName}`);
      emittedBranches.add(bName);
    }
    lines.push(`  checkout ${bName}`);

    // render commits on this branch AFTER forkFromCommitId
    // i.e., walk back from head until forkFromCommitId, then reverse and drop the fork commit itself
    const back = chainBack(info.head, info.forkFromCommitId); // newest->... includes fork commit if within maxDepth
    const forward = back.slice().reverse(); // oldest->newest

    // forward may start at fork commit; skip it
    const startIdx = forward.findIndex((c) => c.id === info.forkFromCommitId);
    const toEmit = startIdx >= 0 ? forward.slice(startIdx + 1) : forward;

    for (const c of toEmit) {
      lines.push(`  commit id:"${ensureLabel(c)}"`);
      // emit any branches that fork from THIS commit (nested forks)
      const kids = childrenByFork[c.id];
      if (kids?.length) {
        for (const kid of kids) emitBranchFromFork(kid, bName);
      }
    }

    lines.push(`  checkout ${returnTo}`);
  };

  // emit main commits and branches that fork from each main commit
  for (const c of mainChain) {
    lines.push(`  commit id:"${ensureLabel(c)}"`);
    const kids = childrenByFork[c.id];
    if (kids?.length) {
      for (const kid of kids) emitBranchFromFork(kid, "main");
    }
  }

  // best-effort dangling branches: attach to main so they still show
  for (const d of dangling) {
    emitBranchFromFork({ ...d, forkFromCommitId: mainChain[0]?.id ?? null }, "main");
  }

  // final checkout highlight (SAFE)
  const current = state.currentBranchId || "main";
  const curMermaid = current === "main" ? "main" : branchIdToMermaid[current] || "main";

  // rebuild emitted branches from lines (covers cases where branch was windowed out)
  const emitted = new Set<string>(["main"]);
  for (const ln of lines) {
    const m = ln.match(/^\s*branch\s+([A-Za-z0-9_]+)/);
    if (m?.[1]) emitted.add(m[1]);
  }
  const safeCheckout = emitted.has(curMermaid) ? curMermaid : "main";
  lines.push(`  checkout ${safeCheckout}`);

  // NEW: mapping to support clickable branch labels in the SVG
  const branchMermaidToId: Record<string, string> = {};
  const branchMermaidToTitle: Record<string, string> = {};
  for (const b of branches) {
    const m = branchIdToMermaid[b.id] || (b.id === "main" ? "main" : "");
    if (!m) continue;
    branchMermaidToId[m] = b.id;
    branchMermaidToTitle[m] = b.name || m;
  }

  return {
    diagram: lines.join("\n"),
    labelToFull,
    branchIdToMermaid,
    // NEW
    branchMermaidToId,
    branchMermaidToTitle,
    activeBranchMermaid: safeCheckout,
  };
}

/* ---------------- Component ---------------- */

export function NeedsWorkspaceFlow({ tabId, className = "", maxDepth = 12 }: Props) {
  const WORKSPACE_KEY = React.useMemo(() => `e42.needsWorkspace.${tabId}.v1`, [tabId]);
  const DECISIONS_KEY = React.useMemo(() => `e42.needsTable.decisions.${tabId}.v1`, [tabId]);
  const EVALS_KEY = React.useMemo(() => `e42.needsTable.evals.${tabId}.v1`, [tabId]);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [state, setState] = React.useState<WorkspaceState | null>(null);
  const [commitMsg, setCommitMsg] = React.useState("");
  const [forkName, setForkName] = React.useState("");

  const graphRef = React.useRef<HTMLDivElement | null>(null);

  const checkoutRef = React.useRef<(branchId: string) => void>(() => {});

  const [overlay, setOverlay] = React.useState<{ decisions: NeedsDecisionsMap; evals: NeedsEvalsMap }>({
    decisions: {},
    evals: {},
  });

  const [picked, setPicked] = React.useState<{ label: string; full: string } | null>(null);

  const loadOverlay = React.useCallback(() => {
    return {
      decisions: readJson<NeedsDecisionsMap>(DECISIONS_KEY, {}),
      evals: readJson<NeedsEvalsMap>(EVALS_KEY, {}),
    };
  }, [DECISIONS_KEY, EVALS_KEY]);

  const persist = React.useCallback(
    (next: WorkspaceState) => {
      setState(next);
      writeJson(WORKSPACE_KEY, next);
    },
    [WORKSPACE_KEY]
  );

  const currentBranch = state ? state.branches[state.currentBranchId] : null;
  const headCommit = state && currentBranch ? state.commits[currentBranch.head] : null;

  const dirty = React.useMemo(() => {
      if (!state || !headCommit) return false;
      return (
        !shallowJsonEqual(overlay.decisions, headCommit.decisions) ||
        !shallowJsonEqual(overlay.evals, headCommit.evals)
      );
  }, [state, headCommit, overlay]);

  const deleteCurrentBranch = React.useCallback(() => {
      if (!state || !currentBranch) return;
      if (currentBranch.id === "main") return;

      const ok = window.confirm(
        dirty
          ? `Delete branch "${currentBranch.name}"?\n\nYou have unsaved changes on this branch. This cannot be undone.`
          : `Delete branch "${currentBranch.name}"?\n\nThis cannot be undone.`
      );
      if (!ok) return;

      // prefer going back to the parent branch if known, else main
      const preferred = currentBranch.forkFromBranchId;
      const fallbackBranchId = preferred && state.branches[preferred] ? preferred : "main";

      const nextBranches = { ...state.branches };
      delete nextBranches[currentBranch.id];

      let next: WorkspaceState = {
        ...state,
        branches: nextBranches,
        currentBranchId: fallbackBranchId,
      };

      next = pruneOrphanCommits(next); // optional but nice

      // load the target branch snapshot into the table
      const targetBranch = next.branches[next.currentBranchId];
      const targetCommit = targetBranch ? next.commits[targetBranch.head] : null;

      writeJson(DECISIONS_KEY, targetCommit?.decisions ?? {});
      writeJson(EVALS_KEY, targetCommit?.evals ?? {});
      dispatchNeedsTableReload(tabId);

      persist(next);
      setPicked(null);
      setForkName("");
      setCommitMsg("");
  }, [state, currentBranch, dirty, persist, tabId, DECISIONS_KEY, EVALS_KEY]);

  // bootstrap
  React.useEffect(() => {
    if (!mounted) return;

    const existing = readJson<WorkspaceState | null>(WORKSPACE_KEY, null);
    if (existing?.version === 1 && existing.branches && existing.commits) {
      setState(existing);
      return;
    }

    const { decisions, evals } = loadOverlay();
    const c0: Commit = {
      id: makeId(),
      parentId: null,
      createdAt: nowIso(),
      message: "Initial",
      decisions,
      evals,
    };
    const main: Branch = {
      id: "main",
      name: "Main",
      head: c0.id,
      createdAt: nowIso(),
    };

    const boot: WorkspaceState = {
      version: 1,
      currentBranchId: main.id,
      branches: { [main.id]: main },
      commits: { [c0.id]: c0 },
    };

    persist(boot);
  }, [mounted, WORKSPACE_KEY, loadOverlay, persist]);

  // keep overlay state in sync with table edits
  React.useEffect(() => {
    if (!mounted) return;

    const refresh = () => setOverlay(loadOverlay());
    refresh();

    const handler = (e: any) => {
      const t = e?.detail?.tabId;
      if (t && t !== tabId) return;
      refresh();
    };

    window.addEventListener("e42.needsTable.overlayChanged", handler as any);
    window.addEventListener("e42.needsTable.reload", handler as any);

    return () => {
      window.removeEventListener("e42.needsTable.overlayChanged", handler as any);
      window.removeEventListener("e42.needsTable.reload", handler as any);
    };
  }, [mounted, tabId, loadOverlay]);





  // render diagram whenever state changes (includes active-branch highlight)
  React.useEffect(() => {
    if (!state || !graphRef.current) return;

    const { diagram, labelToFull, branchMermaidToId, branchMermaidToTitle, activeBranchMermaid } =
      buildGitGraph(state, maxDepth);

    renderMermaidInto(graphRef.current, diagram)
      .then(() => {
        enhanceMermaidSvg(
          graphRef.current!,
          labelToFull,
          branchMermaidToId,
          branchMermaidToTitle,
          activeBranchMermaid,
          (label) => {
            if (!label) {
              setPicked(null);
              return;
            }
            setPicked({ label, full: labelToFull[label] ?? label });
          },
          (branchId) => {
            // switch branch when clicking the left-side branch label
            checkoutRef.current(branchId);
          }
        );
      })
      .catch((e) => {
        graphRef.current!.innerHTML =
          `<div style="font-size:12px;color:#666">Mermaid render failed. Check diagram syntax.</div>` +
          `<pre style="white-space:pre-wrap;font-size:11px;margin-top:8px">${diagram}</pre>`;
        console.warn("[NeedsWorkspaceGraph] mermaid render failed", e);
      });
  }, [state, maxDepth]);

  const commitToCurrent = React.useCallback(() => {
    if (!state || !currentBranch || !headCommit) return;

    const { decisions, evals } = overlay;
    const id = makeId();
    const message = commitMsg.trim() || "Checkpoint";

    const c: Commit = {
      id,
      parentId: currentBranch.head,
      createdAt: nowIso(),
      message,
      decisions,
      evals,
    };

    const next: WorkspaceState = {
      ...state,
      commits: { ...state.commits, [id]: c },
      branches: {
        ...state.branches,
        [currentBranch.id]: { ...currentBranch, head: id },
      },
    };

    persist(next);
    setCommitMsg("");
  }, [state, currentBranch, headCommit, commitMsg, overlay, persist]);

  const forkAndCommit = React.useCallback(() => {
    if (!state || !currentBranch) return;

    const name = forkName.trim();
    if (!name) return;

    const { decisions, evals } = overlay;

    const newBranchId = `b-${makeId().slice(0, 8)}`;
    const commitId = makeId();
    const message = commitMsg.trim() || `Work on ${name}`;

    const c: Commit = {
      id: commitId,
      parentId: currentBranch.head,
      createdAt: nowIso(),
      message,
      decisions,
      evals,
    };

    const b: Branch = {
      id: newBranchId,
      name,
      head: commitId,
      createdAt: nowIso(),
      // NEW
      forkFromCommitId: currentBranch.head,
      forkFromBranchId: currentBranch.id,
    };

    const next: WorkspaceState = {
      ...state,
      currentBranchId: b.id,
      commits: { ...state.commits, [commitId]: c },
      branches: { ...state.branches, [b.id]: b },
    };

    persist(next);
    setForkName("");
    setCommitMsg("");
    setPicked(null);

    // keep NeedsTable in sync
    writeJson(DECISIONS_KEY, decisions);
    writeJson(EVALS_KEY, evals);
    dispatchNeedsTableReload(tabId);
  }, [state, currentBranch, forkName, commitMsg, overlay, persist, DECISIONS_KEY, EVALS_KEY, tabId]);

  const checkout = React.useCallback(
    (branchId: string) => {
      if (!state) return;
      const b = state.branches[branchId];
      if (!b) return;
      const c = state.commits[b.head];

      writeJson(DECISIONS_KEY, c?.decisions ?? {});
      writeJson(EVALS_KEY, c?.evals ?? {});
      dispatchNeedsTableReload(tabId);

      persist({ ...state, currentBranchId: branchId });
      setPicked(null);
    },
    [state, persist, DECISIONS_KEY, EVALS_KEY, tabId]
  );

  React.useEffect(() => {
      checkoutRef.current = checkout;
  }, [checkout]);

  if (!mounted || !state || !currentBranch) return null;

  return (
    <Card className={`w-full border border-border rounded-lg overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 border-b bg-accent/20 px-3 py-2">
        <div className="inline-flex items-center gap-2 text-[12px] font-semibold text-foreground">
          <GitBranch className="h-4 w-4" />
          Working set history
        </div>

        <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
          branch: {currentBranch.name}
        </Badge>

        {dirty ? (
          <Badge variant="outline" className="h-5 px-2 text-[10px] rounded-full">
            unsaved changes
          </Badge>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            saved
          </span>
        )}
      </div>

      <div className="p-3 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <Input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder='Commit message (e.g. "De-scope Not, pin applies")'
            className="h-8 text-[12px]"
          />

          <div className="flex items-center gap-2">
            <Button
              onClick={commitToCurrent}
              disabled={!dirty}
              size="sm"
              className="h-8 text-[12px]"
              type="button"
              title="Save changes as a new commit on the current branch"
            >
              <Save className="h-4 w-4 mr-1.5" />
              Commit
            </Button>

            <Input
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              placeholder='Fork name (e.g. "Materials")'
              className="h-8 text-[12px]"
            />

            <Button
              onClick={forkAndCommit}
              disabled={!dirty || !forkName.trim()}
              size="sm"
              variant="outline"
              className="h-8 text-[12px]"
              type="button"
              title="Create a new branch AND save changes as its first commit"
            >
              <GitFork className="h-4 w-4 mr-1.5" />
              Fork + Commit
            </Button>

            {currentBranch.id !== "main" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[10px]"
                onClick={deleteCurrentBranch}
                title="Delete this branch"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-md border border-border bg-background p-2 overflow-auto">
          <div ref={graphRef} />
        </div>

        {picked && (
          <div className="rounded-md border border-border bg-background/60 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-foreground/80">Commit details</div>
              <button
                type="button"
                className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setPicked(null)}
              >
                close
              </button>
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words text-foreground/90">{picked.full}</div>
          </div>
        )}

        <div className="text-[10px] text-muted-foreground/70">
          Tip: hover a commit label to see the full message; click it to pin details here. Nested forks (fork-from-fork) are
          now rendered correctly.
        </div>
        <div className="text-[10px] text-muted-foreground/70">
              Tip: click a branch name on the left of the graph to switch branches.
        </div>
      </div>
    </Card>
  );
}