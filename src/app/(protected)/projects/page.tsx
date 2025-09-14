"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";

// shadcn/ui
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

// icons
import { Plus, Search, FolderOpen, Pencil, Trash2, ChevronDown } from "lucide-react";

// Zustand store
import { useProjectsStore, type Project } from "@/stores/projects";


// -----------------------------------------------------------------------------
// Create / Edit Dialogs
// -----------------------------------------------------------------------------

const CreateProjectDialog: React.FC<{
  onCreate: (p: Omit<Project, "id" | "createdAt" | "updatedAt">) => void;
}> = ({ onCreate }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const reset = () => { setName(""); setDescription(""); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Project name is required"); return; }
    setCreating(true);
    setTimeout(() => {
      onCreate({ name: name.trim(), description: description.trim() });
      setCreating(false);
      setOpen(false);
      reset();
      toast.success("Project created");
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="h-4 w-4"/> New project</Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create new project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Compliance Workspace"/>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary..." rows={4}/>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={creating} className="min-w-24">
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const EditProjectDialog: React.FC<{
  project: Project | null;
  onSave: (id: string, patch: Partial<Project>) => void;
  onClose: () => void;
}> = ({ project, onSave, onClose }) => {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");

  useEffect(() => {
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
  }, [project]);

  if (!project) return null;

  return (
    <Dialog open={Boolean(project)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="ename">Name</Label>
            <Input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edesc">Description</Label>
            <Textarea id="edesc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4}/>
          </div>
          <DialogFooter>
            <Button onClick={() => { if (!name.trim()) { toast.error("Name required"); return; } onSave(project.id, { name: name.trim(), description: description.trim() }); onClose(); }}>Save</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// -----------------------------------------------------------------------------
// Next.js Page (page.tsx)
// -----------------------------------------------------------------------------

export default function Page() {
  const { projects, add, update, remove } = useProjectsStore();

  const [globalFilter, setGlobalFilter] = useState("");
  const [editing, setEditing] = useState<Project | null>(null);

  // ---- Case studies
  type CaseStudy = { id: string; file: string; title: string; description?: string };
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");

  useEffect(() => {
    // fetch list from API route
    (async () => {
      try {
        const res = await fetch("/api/case-studies");
        if (!res.ok) throw new Error("Failed to load case studies");
        const data = await res.json();
        setCaseStudies(data);
      } catch (e) {
        console.error(e);
        toast.error("Could not load case studies");
      }
    })();
  }, []);

  const onCreate = (p: Omit<Project, "id" | "createdAt" | "updatedAt">) => add(p);
  const onDelete = (id: string) => { remove(id); toast.message("Project deleted"); };
  const onEditSave = (id: string, patch: Partial<Project>) => { update(id, patch); toast.success("Changes saved"); };
  const onOpen = (p: Project) => {
    // Replace with your router push
    // const router = useRouter(); router.push(`/projects/${p.id}`)
    toast.message("Open project", { description: p.name });
  };

  // Create immediately when a case study is selected
  const handleCaseSelect = (value: string) => {
    setSelectedCaseId(value);
    const cs = caseStudies.find((c) => c.id === value);
    if (!cs) return;
    add({ name: cs.title, description: cs.description });
    toast.success("Created project from case study");
    // reset select for nicer UX
    setTimeout(() => setSelectedCaseId(""), 0);
  };

  const filtered = useMemo(() => {
    const text = globalFilter.toLowerCase();
    return projects.filter((p) => !text || [p.name, p.description].join(" ").toLowerCase().includes(text));
  }, [projects, globalFilter]);



  return (
    <main className="w-full p-6">
      <div className="mfiltered mx-auto flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-sm text-muted-foreground">Create a new project or start from a case study.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedCaseId} onValueChange={handleCaseSelect}>
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Create from a case study" />
              </SelectTrigger>
              <SelectContent>
                {caseStudies.map((cs) => (
                  <SelectItem key={cs.id} value={cs.id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{cs.title}</span>
                      {cs.description ? (
                        <span className="text-xs text-muted-foreground line-clamp-1">{cs.description}</span>
                      ) : null}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CreateProjectDialog onCreate={onCreate} />
          </div>
        </div>

        <Card className="flex-1 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your projects</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex flex-col">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 pb-3">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search projects..."
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                />
              </div>
              <div className="ml-auto hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
                <span className="pl-2">{filtered.length} total</span>
              </div>
            </div>

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[55%]">Project</TableHead>
                    <TableHead className="w-[25%]">Updated</TableHead>
                    <TableHead className="w-[20%] text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                        No projects yet. Create your first one or start from a case study.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((p) => (
                      <TableRow key={p.id} className="hover:bg-accent/40">
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium tracking-tight">{p.name}</span>
                            {p.description ? (
                              <span className="text-xs text-muted-foreground line-clamp-1">{p.description}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <time dateTime={p.updatedAt} className="text-sm text-muted-foreground">
                            {new Date(p.updatedAt).toLocaleString()}
                          </time>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onOpen(p)} title="Open">
                              <FolderOpen className="h-4 w-4"/>
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(p)} title="Edit">
                              <Pencil className="h-4 w-4"/>
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(p.id)} title="Delete">
                              <Trash2 className="h-4 w-4"/>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            </CardContent>
        </Card>
      </div>

      {/* Edit dialog */}
      <EditProjectDialog project={editing} onSave={onEditSave} onClose={() => setEditing(null)} />
    </main>
  );
}
