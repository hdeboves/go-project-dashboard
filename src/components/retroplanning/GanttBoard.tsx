"use client";

import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Flag,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

export interface RetroTaskView {
  id: string;
  phase: string;
  etape: string | null;
  tache: string;
  owner: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "A_FAIRE" | "EN_COURS" | "EN_ATTENTE_CLIENT" | "TERMINE" | string;
  sheetRowIndex: number | null;
  isMilestone: boolean;
  milestoneType: string | null;
  updatedAt: string;
  version?: number;
}

const KANBAN_COLUMNS = [
  {
    id: "A_FAIRE",
    label: "À faire",
    dot: "bg-slate-400",
    headerTint: "border-t-slate-400",
  },
  {
    id: "EN_COURS",
    label: "En cours",
    dot: "bg-sky-500",
    headerTint: "border-t-sky-500",
  },
  {
    id: "EN_ATTENTE_CLIENT",
    label: "Attente client",
    dot: "bg-amber-500",
    headerTint: "border-t-amber-500",
  },
  {
    id: "TERMINE",
    label: "Terminé",
    dot: "bg-emerald-500",
    headerTint: "border-t-emerald-500",
  },
] as const;

const STATUS_LABEL: Record<string, string> = {
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_ATTENTE_CLIENT: "Attente client",
  TERMINE: "Terminé",
};

const STATUS_SELECT_CLASS: Record<string, string> = {
  A_FAIRE:
    "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  EN_COURS:
    "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  EN_ATTENTE_CLIENT:
    "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  TERMINE:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
};

function isoPrefix(val: string | null | undefined): string {
  return val ? val.slice(0, 10) : "";
}

function formatShortDate(iso: string | null | undefined): string {
  const s = isoPrefix(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const [y, m, d] = s.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(new Date(y, m - 1, d));
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function buildWeekWindows(
  tasks: RetroTaskView[]
): Array<{ label: string; startIso: string; endIso: string }> {
  const dated = tasks
    .flatMap((t) => [isoPrefix(t.startDate), isoPrefix(t.endDate)])
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  const anchorStr = dated[0] ?? "2026-09-01";
  const lastStr = dated[dated.length - 1] ?? anchorStr;
  const [ay, am, ad] = anchorStr.split("-").map((n) => Number.parseInt(n, 10));
  const [ly, lm, ld] = lastStr.split("-").map((n) => Number.parseInt(n, 10));
  const startMs = Date.UTC(ay, am - 1, ad);
  const endMs = Date.UTC(ly, lm - 1, ld);
  const totalWeeks = Math.max(
    6,
    Math.min(16, Math.ceil((endMs - startMs) / (7 * 86_400_000)) + 1)
  );

  const weeks: Array<{ label: string; startIso: string; endIso: string }> = [];
  for (let i = 0; i < totalWeeks; i++) {
    const ws = new Date(startMs + i * 7 * 86_400_000);
    const we = new Date(startMs + (i * 7 + 6) * 86_400_000);
    weeks.push({
      label: `S${i + 1}`,
      startIso: ws.toISOString().slice(0, 10),
      endIso: we.toISOString().slice(0, 10),
    });
  }
  return weeks;
}

export function GanttBoard({
  viewMode = "list",
  tasks,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}: {
  viewMode?: "list" | "kanban" | "timeline";
  tasks: RetroTaskView[];
  onCreateTask: (payload: {
    phase: string;
    etape: string;
    tache: string;
    owner?: string;
    startDate?: string;
    endDate?: string;
    status: string;
    isMilestone: boolean;
    milestoneType?: string | null;
  }) => Promise<boolean>;
  onUpdateTask: (payload: {
    id: string;
    phase?: string;
    etape?: string;
    tache?: string;
    owner?: string;
    startDate?: string | null;
    endDate?: string | null;
    status?: string;
    isMilestone?: boolean;
    milestoneType?: string | null;
    expectedUpdatedAt?: string;
  }) => Promise<boolean>;
  onDeleteTask: (taskId: string) => Promise<void>;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [topQuickTitle, setTopQuickTitle] = useState("");
  const [topQuickDate, setTopQuickDate] = useState("");
  const [addingTopQuick, setAddingTopQuick] = useState(false);
  const [phase, setPhase] = useState("Phase 1 : Production");
  const [etape, setEtape] = useState("Général");
  const [tache, setTache] = useState("");
  const [owner, setOwner] = useState("");
  const [startDate, setStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  );
  const [status, setStatus] = useState("A_FAIRE");
  const [isMilestone, setIsMilestone] = useState(false);
  const [milestoneType, setMilestoneType] = useState("INFLUENCE");
  const [submitting, setSubmitting] = useState(false);

  // Asana Filters + Inline Quick-Add + Safe Delete + Drag-and-Drop Kanban
  const [searchQuery, setSearchQuery] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "LATE" | "EN_ATTENTE_CLIENT" | "EN_COURS"
  >("ALL");
  const [hideDone, setHideDone] = useState(false);
  const [quickAddByPhase, setQuickAddByPhase] = useState<Record<string, string>>(
    {}
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [inlineDateTaskId, setInlineDateTaskId] = useState<string | null>(null);

  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(
    () => new Set()
  );
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [editingTask, setEditingTask] = useState<RetroTaskView | null>(null);
  const [editTache, setEditTache] = useState("");
  const [editPhase, setEditPhase] = useState("");
  const [editEtape, setEditEtape] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editStatus, setEditStatus] = useState("A_FAIRE");
  const [editOwner, setEditOwner] = useState("");
  const [editMilestone, setEditMilestone] = useState(false);
  const [editMilestoneType, setEditMilestoneType] = useState("CUSTOM");
  const [savingEdit, setSavingEdit] = useState(false);

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.owner?.trim()) set.add(t.owner.trim());
    }
    return Array.from(set).sort();
  }, [tasks]);

  const todayIso = new Date().toISOString().slice(0, 10);

  const lateCount = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status !== "TERMINE" &&
          Boolean(t.endDate) &&
          isoPrefix(t.endDate) < todayIso
      ).length,
    [tasks, todayIso]
  );

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (hideDone && t.status === "TERMINE") return false;
      if (statusFilter === "LATE") {
        if (
          t.status === "TERMINE" ||
          !t.endDate ||
          isoPrefix(t.endDate) >= todayIso
        ) {
          return false;
        }
      } else if (statusFilter !== "ALL" && t.status !== statusFilter) {
        return false;
      }
      if (ownerFilter !== "ALL" && (t.owner?.trim() || "") !== ownerFilter) {
        return false;
      }
      if (
        q &&
        !t.tache.toLowerCase().includes(q) &&
        !t.phase.toLowerCase().includes(q) &&
        !(t.owner ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [tasks, ownerFilter, statusFilter, hideDone, searchQuery, todayIso]);

  const weekWindows = useMemo(
    () => buildWeekWindows(filteredTasks),
    [filteredTasks]
  );

  const groupedByPhase = useMemo(() => {
    const groups: Array<{ phase: string; items: RetroTaskView[] }> = [];
    const idxMap = new Map<string, number>();
    for (const task of filteredTasks) {
      const key = task.phase?.trim() || "Sans section";
      let idx = idxMap.get(key);
      if (idx === undefined) {
        idx = groups.length;
        idxMap.set(key, idx);
        groups.push({ phase: key, items: [] });
      }
      groups[idx].items.push(task);
    }
    return groups;
  }, [filteredTasks]);

  function togglePhase(phaseName: string) {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseName)) next.delete(phaseName);
      else next.add(phaseName);
      return next;
    });
  }

  async function handleQuickStatus(task: RetroTaskView, nextStatus: string) {
    if (task.status === nextStatus) return;
    setUpdatingId(task.id);
    try {
      await onUpdateTask({
        id: task.id,
        status: nextStatus,
        expectedUpdatedAt: task.updatedAt,
      });
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleQuickAddInPhase(phaseName: string) {
    const title = (quickAddByPhase[phaseName] ?? "").trim();
    if (!title) return;
    setSubmitting(true);
    try {
      const ok = await onCreateTask({
        phase: phaseName,
        etape: "Général",
        tache: title,
        owner: ownerFilter !== "ALL" ? ownerFilter : undefined,
        status: "A_FAIRE",
        isMilestone: false,
      });
      if (ok) {
        setQuickAddByPhase((prev) => ({ ...prev, [phaseName]: "" }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const ok = await onCreateTask({
        phase,
        etape,
        tache,
        owner: owner || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status,
        isMilestone,
        milestoneType: isMilestone ? milestoneType : null,
      });
      if (ok) {
        setTache("");
        setOwner("");
        setShowCreateForm(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openEditModal(task: RetroTaskView) {
    setEditingTask(task);
    setEditTache(task.tache);
    setEditPhase(task.phase);
    setEditEtape(task.etape ?? "");
    setEditStart(isoPrefix(task.startDate));
    setEditEnd(isoPrefix(task.endDate));
    setEditStatus(task.status);
    setEditOwner(task.owner ?? "");
    setEditMilestone(task.isMilestone);
    setEditMilestoneType(task.milestoneType ?? "CUSTOM");
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTask) return;
    setSavingEdit(true);
    try {
      const ok = await onUpdateTask({
        id: editingTask.id,
        tache: editTache.trim() || editingTask.tache,
        phase: editPhase.trim() || editingTask.phase,
        etape: editEtape.trim(),
        owner: editOwner,
        startDate: editStart || null,
        endDate: editEnd || null,
        status: editStatus,
        isMilestone: editMilestone,
        milestoneType: editMilestone ? editMilestoneType : null,
        expectedUpdatedAt: editingTask.updatedAt,
      });
      if (ok) setEditingTask(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleTopQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = topQuickTitle.trim();
    if (!title) return;
    setAddingTopQuick(true);
    try {
      const defaultPhase = groupedByPhase[0]?.phase || phase || "Production";
      const ok = await onCreateTask({
        phase: defaultPhase,
        etape: "Général",
        tache: title,
        owner: ownerFilter !== "ALL" ? ownerFilter : undefined,
        startDate: todayIso,
        endDate: topQuickDate || undefined,
        status: "A_FAIRE",
        isMilestone: false,
        milestoneType: null,
      });
      if (ok) {
        setTopQuickTitle("");
        setTopQuickDate("");
      }
    } finally {
      setAddingTopQuick(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      {/* 1-Line Instant Task Bar (Asana / Todoist simplicity!) */}
      <form
        onSubmit={(e) => void handleTopQuickAdd(e)}
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/70 p-2 transition-colors focus-within:border-sky-400 focus-within:bg-white dark:border-slate-700/80 dark:bg-slate-800/50 dark:focus-within:bg-slate-900"
      >
        <Plus className="ml-2 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
        <input
          type="text"
          value={topQuickTitle}
          onChange={(e) => setTopQuickTitle(e.target.value)}
          placeholder="Ajouter une tâche rapidement… (appuyez sur Entrée)"
          className="min-w-[180px] flex-1 bg-transparent px-1 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
        />
        <input
          type="date"
          aria-label="Échéance rapide"
          value={topQuickDate}
          onChange={(e) => setTopQuickDate(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        />
        <button
          type="submit"
          disabled={addingTopQuick || !topQuickTitle.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-rose-700 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          {addingTopQuick ? "Ajout..." : "Ajouter"}
        </button>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {showCreateForm ? "Masquer options" : "Options avancées"}
        </button>
      </form>

      {/* Slim, Uncluttered Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "ALL", label: "Toutes" },
              { id: "LATE", label: `En retard (${lateCount})` },
              { id: "EN_COURS", label: "En cours" },
              { id: "EN_ATTENTE_CLIENT", label: "Attente client" },
            ] as const
          ).map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStatusFilter(st.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === st.id
                  ? st.id === "LATE"
                    ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:ring-rose-500/30"
                    : st.id === "EN_ATTENTE_CLIENT"
                      ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-500/30"
                      : st.id === "EN_COURS"
                        ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:ring-sky-500/30"
                        : "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrer…"
              className="w-40 rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pr-6 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {owners.length > 0 && (
            <div className="relative flex items-center">
              <User className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
              <select
                aria-label="Filtrer par responsable"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs font-medium text-slate-700 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="ALL">Toute l&apos;équipe</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-600"
            />
            Masquer terminées
          </label>
        </div>
      </div>

      {/* Create Task Drawer */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleCreateSubmit(e)}
          className="mb-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/60 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Section / Phase
            </label>
            <input
              type="text"
              required
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Nom de la tâche
            </label>
            <input
              type="text"
              required
              placeholder="ex : Validation du Key Art"
              value={tache}
              onChange={(e) => setTache(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Responsable
            </label>
            <input
              type="text"
              placeholder="ex : Hugo, Paul..."
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Étape
            </label>
            <input
              type="text"
              required
              value={etape}
              onChange={(e) => setEtape(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Début
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Échéance
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Statut
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="A_FAIRE">À faire</option>
              <option value="EN_COURS">En cours</option>
              <option value="EN_ATTENTE_CLIENT">Attente client</option>
              <option value="TERMINE">Terminé</option>
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={isMilestone}
                onChange={(e) => setIsMilestone(e.target.checked)}
                className="accent-rose-600"
              />
              Jalon clé (Agenda)
              {isMilestone && (
                <select
                  value={milestoneType}
                  onChange={(e) => setMilestoneType(e.target.value)}
                  className="ml-auto rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="INFLUENCE">Influence</option>
                  <option value="LANCEMENT_MAP">Lancement</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="CUSTOM">Autre</option>
                </select>
              )}
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting ? "Ajout..." : "Créer la tâche"}
            </button>
          </div>
        </form>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/30">
          <Calendar className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
          <p className="mt-2.5 text-sm font-semibold text-slate-800 dark:text-white">
            Aucune tâche pour le moment
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Créez votre première tâche ou importez votre Google Sheet de
            rétroplanning.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <Plus className="h-4 w-4" />
            Créer la première tâche
          </button>
        </div>
      ) : viewMode === "kanban" ? (
        /* ASANA KANBAN VIEW (with Drag & Drop) */
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {KANBAN_COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.id);
            const isDropTarget = dragOverCol === col.id;
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.id);
                }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  if (!draggingTaskId) return;
                  const dragged = tasks.find((t) => t.id === draggingTaskId);
                  setDraggingTaskId(null);
                  if (dragged && dragged.status !== col.id) {
                    void handleQuickStatus(dragged, col.id);
                  }
                }}
                className={`flex min-h-[340px] flex-col rounded-2xl border border-t-2 bg-slate-50/70 p-3 transition-colors dark:bg-slate-800/40 ${col.headerTint} ${
                  isDropTarget
                    ? "border-indigo-400 bg-indigo-50/40 dark:border-indigo-400 dark:bg-indigo-500/10"
                    : "border-slate-200/80 dark:border-slate-800"
                }`}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                    <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      {col.label}
                    </h3>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200/80 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700">
                    {colTasks.length}
                  </span>
                </div>

                <div className="flex-1 space-y-2.5">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDraggingTaskId(task.id)}
                      onDragEnd={() => {
                        setDraggingTaskId(null);
                        setDragOverCol(null);
                      }}
                      className="cursor-grab rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs transition-all hover:border-indigo-300 active:cursor-grabbing dark:border-slate-700/80 dark:bg-[#111827] dark:hover:border-indigo-500/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold leading-snug text-slate-900 dark:text-white">
                          {task.tache}
                        </p>
                        <button
                          type="button"
                          onClick={() => openEditModal(task)}
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="h-3 w-3" />
                        </button>
                      </div>

                      <p className="mt-1 text-[11px] text-slate-400">
                        {task.phase}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                        <div className="flex items-center gap-1.5">
                          {task.owner && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                              {initials(task.owner)}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatShortDate(task.endDate ?? task.startDate)}
                          </span>
                        </div>
                        {task.isMilestone && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                            <Flag className="h-2.5 w-2.5" />
                            Jalon
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === "list" ? (
        /* ASANA LIST VIEW (with inline quick-add per phase, inline due date, safe delete) */
        <div className="space-y-5">
          {groupedByPhase.map((group) => {
            const collapsed = collapsedPhases.has(group.phase);
            const groupDone = group.items.filter(
              (t) => t.status === "TERMINE"
            ).length;
            const groupPct =
              group.items.length > 0
                ? Math.round((groupDone / group.items.length) * 100)
                : 0;

            return (
              <div key={group.phase}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => togglePhase(group.phase)}
                    className="flex items-center gap-1.5 text-sm font-bold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                    <span>{group.phase}</span>
                    <span className="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                      {groupDone}/{group.items.length}
                    </span>
                  </button>

                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        style={{ width: `${groupPct}%` }}
                        className={`h-full rounded-full ${
                          groupPct === 100
                            ? "bg-emerald-500"
                            : "bg-indigo-600 dark:bg-indigo-400"
                        }`}
                      />
                    </div>
                    <span className="w-8 text-right font-mono text-[11px] text-slate-400">
                      {groupPct}%
                    </span>
                  </div>
                </div>

                {!collapsed && (
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:divide-slate-800/80 dark:border-slate-800 dark:bg-[#111827]">
                    {group.items.map((task) => {
                      const isDone = task.status === "TERMINE";
                      const isLate =
                        !isDone &&
                        Boolean(task.endDate) &&
                        isoPrefix(task.endDate) < todayIso;
                      const selectStyle =
                        STATUS_SELECT_CLASS[task.status] ??
                        STATUS_SELECT_CLASS.A_FAIRE;

                      return (
                        <div
                          key={task.id}
                          data-testid={`retro-task-${task.id}`}
                          data-task-id={task.id}
                          className="group flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50/90 dark:hover:bg-slate-800/40"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <button
                              type="button"
                              disabled={updatingId === task.id}
                              onClick={() =>
                                void handleQuickStatus(
                                  task,
                                  isDone ? "EN_COURS" : "TERMINE"
                                )
                              }
                              aria-label={
                                isDone
                                  ? `Marquer ${task.tache} non terminée`
                                  : `Terminer ${task.tache}`
                              }
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                isDone
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-slate-300 bg-white text-transparent hover:border-emerald-500 hover:text-emerald-500 dark:border-slate-600 dark:bg-slate-900"
                              }`}
                            >
                              <Check className="h-3 w-3 stroke-[3]" />
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditModal(task)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`text-[14px] font-medium leading-snug ${
                                    isDone
                                      ? "text-slate-400 line-through dark:text-slate-500"
                                      : "text-slate-900 group-hover:text-sky-700 dark:text-slate-100 dark:group-hover:text-sky-300"
                                  }`}
                                >
                                  {task.tache}
                                </span>
                                {task.isMilestone && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-600/20 dark:bg-violet-500/15 dark:text-violet-300">
                                    <Flag className="h-2.5 w-2.5" />
                                    Jalon
                                  </span>
                                )}
                                {isLate && (
                                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                                    Retard
                                  </span>
                                )}
                              </div>
                              {task.etape && (
                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  {task.etape}
                                </p>
                              )}
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5">
                            {task.owner && (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pr-2.5 pl-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-[10px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                                  {initials(task.owner)}
                                </span>
                                {task.owner}
                              </span>
                            )}

                            {/* Inline Due Date Editor */}
                            {inlineDateTaskId === task.id ? (
                              <input
                                type="date"
                                autoFocus
                                defaultValue={isoPrefix(task.endDate)}
                                onBlur={(e) => {
                                  const nextVal = e.target.value;
                                  setInlineDateTaskId(null);
                                  if (nextVal !== isoPrefix(task.endDate)) {
                                    void onUpdateTask({
                                      id: task.id,
                                      endDate: nextVal || null,
                                      expectedUpdatedAt: task.updatedAt,
                                    });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    setInlineDateTaskId(null);
                                  }
                                }}
                                className="rounded-lg border border-sky-500 bg-white px-2 py-0.5 text-xs text-slate-900 dark:bg-slate-900 dark:text-white"
                              />
                            ) : (
                              <button
                                type="button"
                                title="Cliquer pour changer la date"
                                onClick={() => setInlineDateTaskId(task.id)}
                                className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                                  isLate
                                    ? "bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
                                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                                }`}
                              >
                                {formatShortDate(task.endDate ?? task.startDate)}
                              </button>
                            )}

                            <select
                              aria-label={`Statut de ${task.tache}`}
                              disabled={updatingId === task.id}
                              value={task.status}
                              onChange={(e) =>
                                void handleQuickStatus(task, e.target.value)
                              }
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold focus:outline-none ${selectStyle}`}
                            >
                              <option value="A_FAIRE">À faire</option>
                              <option value="EN_COURS">En cours</option>
                              <option value="EN_ATTENTE_CLIENT">
                                Attente client
                              </option>
                              <option value="TERMINE">Terminé</option>
                            </select>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(task)}
                                title="Modifier la tâche"
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              {confirmDeleteId === task.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDeleteId(null);
                                      void onDeleteTask(task.id);
                                    }}
                                    className="rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-rose-700"
                                  >
                                    Confirmer
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="rounded-lg px-1.5 py-1 text-[10px] text-slate-500 hover:text-slate-700"
                                  >
                                    Annuler
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(task.id)}
                                  aria-label={`Supprimer ${task.tache}`}
                                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Asana-style Inline Quick-Add Row per Phase */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleQuickAddInPhase(group.phase);
                      }}
                      className="flex items-center gap-3 bg-slate-50/40 px-4 py-2 dark:bg-slate-800/30"
                    >
                      <Plus className="h-4 w-4 shrink-0 text-slate-400" />
                      <input
                        type="text"
                        value={quickAddByPhase[group.phase] ?? ""}
                        onChange={(e) =>
                          setQuickAddByPhase((prev) => ({
                            ...prev,
                            [group.phase]: e.target.value,
                          }))
                        }
                        placeholder="Ajouter une tâche rapide et appuyer sur Entrée..."
                        className="flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-200"
                      />
                      {(quickAddByPhase[group.phase] ?? "").trim() && (
                        <button
                          type="submit"
                          disabled={submitting}
                          className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Ajouter
                        </button>
                      )}
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ASANA TIMELINE / GANTT VIEW */
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <th className="px-3.5 py-2.5 font-semibold">Tâche</th>
                <th className="px-3 py-2.5 font-semibold">Dates</th>
                <th className="px-3 py-2.5 font-semibold">Statut</th>
                {weekWindows.map((w) => {
                  const isCurrentWeek =
                    todayIso >= w.startIso && todayIso <= w.endIso;
                  return (
                    <th
                      key={w.label}
                      className={`min-w-[68px] border-l border-slate-200/70 px-1.5 py-2 text-center font-mono text-[10px] font-semibold dark:border-slate-800 ${
                        isCurrentWeek
                          ? "bg-rose-50/80 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                          : "text-slate-400"
                      }`}
                      title={`${w.startIso} → ${w.endIso}`}
                    >
                      <div>
                        {w.label}
                        {isCurrentWeek ? " · Auj." : ""}
                      </div>
                      <div className="font-sans text-[9px] font-normal opacity-80">
                        {formatShortDate(w.startIso)}
                      </div>
                    </th>
                  );
                })}
                <th className="px-3 py-2.5 text-right font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800/80 dark:bg-[#111827]">
              {filteredTasks.map((task) => {
                const tStart = isoPrefix(task.startDate);
                const tEnd = isoPrefix(task.endDate) || tStart;
                const badgeClass =
                  STATUS_SELECT_CLASS[task.status] ??
                  STATUS_SELECT_CLASS.A_FAIRE;
                const statusLabel = STATUS_LABEL[task.status] ?? task.status;

                return (
                  <tr
                    key={task.id}
                    data-testid={`retro-task-${task.id}`}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-3.5 py-2.5">
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {task.tache}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {task.phase}
                        {task.owner ? ` · ${task.owner}` : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {formatShortDate(tStart)} → {formatShortDate(tEnd)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    {weekWindows.map((w) => {
                      const active =
                        Boolean(tStart) &&
                        Boolean(tEnd) &&
                        tStart <= w.endIso &&
                        tEnd >= w.startIso;
                      return (
                        <td
                          key={w.label}
                          className="border-l border-slate-100 px-1 py-2 text-center dark:border-slate-800/70"
                        >
                          {active && (
                            <div
                              className={`mx-auto h-3 w-full rounded-full ${
                                task.status === "TERMINE"
                                  ? "bg-emerald-600 dark:bg-emerald-500"
                                  : task.status === "EN_ATTENTE_CLIENT"
                                    ? "bg-rose-500"
                                    : task.isMilestone
                                      ? "bg-rose-600"
                                      : "bg-indigo-600 dark:bg-indigo-500"
                              }`}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEditModal(task)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        Modifier
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Modal */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-[#111827]"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Modifier la tâche
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {editingTask.tache}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveEdit(e)}
              className="mt-4 space-y-3"
            >
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Titre de la tâche
                </label>
                <input
                  type="text"
                  required
                  value={editTache}
                  onChange={(e) => setEditTache(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Section / Phase
                  </label>
                  <input
                    type="text"
                    list="go-phases-list"
                    value={editPhase}
                    onChange={(e) => setEditPhase(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <datalist id="go-phases-list">
                    {Array.from(new Set(tasks.map((t) => t.phase))).map((ph) => (
                      <option key={ph} value={ph} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Étape
                  </label>
                  <input
                    type="text"
                    value={editEtape}
                    onChange={(e) => setEditEtape(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Début
                  </label>
                  <input
                    type="date"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Échéance
                  </label>
                  <input
                    type="date"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Statut
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="A_FAIRE">À faire</option>
                  <option value="EN_COURS">En cours</option>
                  <option value="EN_ATTENTE_CLIENT">Attente client</option>
                  <option value="TERMINE">Terminé</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Responsable
                </label>
                <input
                  type="text"
                  value={editOwner}
                  onChange={(e) => setEditOwner(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={editMilestone}
                  onChange={(e) => setEditMilestone(e.target.checked)}
                  className="accent-rose-600"
                />
                Jalon Google Agenda
                {editMilestone && (
                  <select
                    value={editMilestoneType}
                    onChange={(e) => setEditMilestoneType(e.target.value)}
                    className="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="INFLUENCE">Influence</option>
                    <option value="LANCEMENT_MAP">Lancement</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="CUSTOM">Autre</option>
                  </select>
                )}
              </label>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {savingEdit ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
