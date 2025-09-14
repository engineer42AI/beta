import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TdpKey =
  | "notional_application"
  | "technology_goals"
  | "technology_description"
  | "development_rationale"
  | "technology_baseline";

export type TdpSection = { title: string; content: any }; // TipTap JSON or string; we'll store TipTap JSON

export type TDP = Record<TdpKey, TdpSection>;

export type Project = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;

  // case-study awareness
  isCaseStudy?: boolean;
  caseStudyId?: string;

  // MVP snapshot used by app pages
  tdp: TDP;
};

type Store = {
  projects: Project[];
  activeProjectId: string | null;

  // CRUD
  add: (p: Omit<Project, "id" | "createdAt" | "updatedAt" | "tdp">) => string; // returns id
  addFromCaseStudy: (meta: { title: string; description?: string; caseStudyId: string }, tdp: TDP) => string;
  update: (id: string, patch: Partial<Project>) => void;
  remove: (id: string) => void;

  // TDP section edit
  setTdpSection: (projectId: string, key: TdpKey, tiptapJson: any) => void;

  // Active project
  setActiveProject: (id: string | null) => void;
  getActiveProject: () => Project | null;
  getProject: (id: string) => Project | undefined;
};

const emptyTdp = (): TDP => ({
  notional_application:   { title: "Notional application",   content: { type: "doc", content: [] } },
  technology_goals:       { title: "Technology goals",       content: { type: "doc", content: [] } },
  technology_description: { title: "Technology description", content: { type: "doc", content: [] } },
  development_rationale:  { title: "Development rationale",  content: { type: "doc", content: [] } },
  technology_baseline:    { title: "Technology baseline",    content: { type: "doc", content: [] } },
});

export const useProjectsStore = create<Store>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      add: (p) => {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const proj: Project = {
          id,
          name: p.name,
          description: p.description,
          isCaseStudy: false,
          caseStudyId: undefined,
          tdp: emptyTdp(),
          createdAt: now,
          updatedAt: now,
        };
        set(state => ({ projects: [proj, ...state.projects] }));
        return id;
      },

      addFromCaseStudy: (meta, tdp) => {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        // convert string content -> TipTap minimal doc
        const toDoc = (s: string) => ({ type: "doc", content: s ? [{ type: "paragraph", content: [{ type: "text", text: s }]}] : [] });
        const tdpJson: TDP = {
          notional_application:   { title: "Notional application",   content: toDoc(tdp.notional_application?.content ?? "") },
          technology_goals:       { title: "Technology goals",       content: toDoc(tdp.technology_goals?.content ?? "") },
          technology_description: { title: "Technology description", content: toDoc(tdp.technology_description?.content ?? "") },
          development_rationale:  { title: "Development rationale",  content: toDoc(tdp.development_rationale?.content ?? "") },
          technology_baseline:    { title: "Technology baseline",    content: toDoc(tdp.technology_baseline?.content ?? "") },
        };

        const proj: Project = {
          id,
          name: meta.title,
          description: meta.description,
          isCaseStudy: true,
          caseStudyId: meta.caseStudyId,
          tdp: tdpJson,
          createdAt: now,
          updatedAt: now,
        };
        set(state => ({ projects: [proj, ...state.projects] }));
        return id;
      },

      update: (id, patch) => {
        set(state => ({
          projects: state.projects.map(p => p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p)
        }));
      },

      remove: (id) => set(state => ({ projects: state.projects.filter(p => p.id !== id) })),

      setTdpSection: (projectId, key, tiptapJson) => {
        set(state => ({
          projects: state.projects.map(p => {
            if (p.id !== projectId) return p;
            return {
              ...p,
              updatedAt: new Date().toISOString(),
              tdp: { ...p.tdp, [key]: { ...p.tdp[key], content: tiptapJson } },
            };
          })
        }));
      },

      setActiveProject: (id) => set({ activeProjectId: id }),
      getActiveProject: () => {
        const s = get();
        return s.projects.find(p => p.id === s.activeProjectId) ?? null;
      },
      getProject: (id) => get().projects.find(p => p.id === id),
    }),
    { name: "e42-projects" }
  )
);
