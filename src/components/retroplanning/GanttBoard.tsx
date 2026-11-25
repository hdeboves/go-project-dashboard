"use client";

import { AlertTriangle, Calendar, CheckCircle2, Edit3, Flag, Plus, Trash2, X } from "lucide-react";
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

const STATUS_LABEL: Record<string, string> = {
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_ATTENTE_CLIENT: "En attente client",
  TERMINE: "Terminé",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  A_FAIRE: "border-slate-600 bg-slate-800/70 text-slate-300",
  EN_COURS: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  EN_ATTENTE_CLIENT: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  TERMINE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

function isoPrefix(val: string | null | undefined): string {
  return val ? val.slice(0, 10) : "";
}

function buildWeekWindows(tasks: RetroTaskView[]): Array<{ label: string; startIso: string; endIso: string }> {
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
  const totalWeeks = Math.max(6, Math.min(16, Math.ceil((endMs - startMs) / (7 * 86_400_000)) + 1));

  const weeks: Array<{ label: string; startIso: string; endIso: string }> = [];
  for (let i = 0; i < totalWeeks; i++) {
    const ws = new Date(startMs + i * 7 * 86_400_000);
    const we = new Date(startMs + (i * 7 + 6) * 86_400_000);
    weeks.push({
      label: `Semaine ${i + 1}`,
      startIso: ws.toISOString().slice(0, 10),
      endIso: we.toISOString().slice(0, 10),
    });
  }
  return weeks;
}

export function GanttBoard({
  tasks,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}: {
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
  const [phase, setPhase] = useState("Phase 1 : Production");
  const [etape, setEtape] = useState("Mapping");
  const [tache, setTache] = useState("");
  const [owner, setOwner] = useState("");
  const [startDate, setStartDate] = useState("2026-09-01");
  const [endDate, setEndDate] = useState("2026-09-07");
  const [status, setStatus] = useState("A_FAIRE");
  const [isMilestone, setIsMilestone] = useState(false);
  const [milestoneType, setMilestoneType] = useState("INFLUENCE");
  const [submitting, setSubmitting] = useState(false);

  const [editingTask, setEditingTask] = useState<RetroTaskView | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editStatus, setEditStatus] = useState("A_FAIRE");
  const [editOwner, setEditOwner] = useState("");
  const [editMilestone, setEditMilestone] = useState(false);
  const [editMilestoneType, setEditMilestoneType] = useState("CUSTOM");
  const [savingEdit, setSavingEdit] = useState(false);

  const weekWindows = useMemo(() => buildWeekWindows(tasks), [tasks]);

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
        owner: editOwner,
        startDate: editStart || null,
        endDate: editEnd || null,
        status: editStatus,
        isMilestone: editMilestone,
        milestoneType: editMilestone ? editMilestoneType : null,
        expectedUpdatedAt: editingTask.updatedAt,
      });
      if (ok) {
        setEditingTask(null);
      }
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232b3d] pb-3">
        <div>
          <h2 className="text-base font-bold text-white">
            Gantt Rétroplanning — Onglet <span className="font-mono text-cyan-300">Par semaine</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Colonnes <span className="font-mono">PHASES / ÉTAPES / TACHES / SEMAINES</span> synchronisées avec{" "}
            <span className="font-mono">002.1 Rétroplanning Actif</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#e11d48] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#ff2e58]"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvelle tâche
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={(e) => void handleCreateSubmit(e)}
          className="mt-4 grid gap-3 rounded-lg border border-[#232b3d] bg-[#171d2b] p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <label className="block text-[11px] font-semibold text-slate-300">PHASES</label>
            <input
              type="text"
              required
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300">ÉTAPES</label>
            <input
              type="text"
              required
              value={etape}
              onChange={(e) => setEtape(e.target.value)}
              className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300">TACHES</label>
            <input
              type="text"
              required
              placeholder="Ex : Validation Key Art"
              value={tache}
              onChange={(e) => setTache(e.target.value)}
              className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300">Responsable</label>
            <input
              type="text"
              placeholder="Hugo / Louis / Paul"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300">Début</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300">Fin</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300">Statut</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
            >
              <option value="A_FAIRE">À faire</option>
              <option value="EN_COURS">En cours</option>
              <option value="EN_ATTENTE_CLIENT">En attente client</option>
              <option value="TERMINE">Terminé</option>
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={isMilestone}
                onChange={(e) => setIsMilestone(e.target.checked)}
              />
              Jalon Agenda
              {isMilestone && (
                <select
                  value={milestoneType}
                  onChange={(e) => setMilestoneType(e.target.value)}
                  className="ml-auto rounded border border-[#232b3d] bg-[#0d111a] px-1.5 py-0.5 text-[11px] text-cyan-300"
                >
                  <option value="INFLUENCE">INFLUENCE</option>
                  <option value="LANCEMENT_MAP">LANCEMENT_MAP</option>
                  <option value="WEEKLY">WEEKLY</option>
                  <option value="CUSTOM">CUSTOM</option>
                </select>
              )}
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {submitting ? "Création..." : "Ajouter au Gantt"}
            </button>
          </div>
        </form>
      )}

      {tasks.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-[#232b3d] bg-[#0d111a]/60 p-8 text-center">
          <Calendar className="mx-auto h-8 w-8 text-slate-500" />
          <p className="mt-2 text-sm font-medium text-slate-300">
            Aucune tâche dans le rétroplanning.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Importez l&apos;onglet <span className="font-mono">Par semaine</span> depuis 002.1 ou créez une tâche ci-dessus.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#232b3d] bg-[#171d2b]/70 text-[11px] text-slate-300">
                <th className="px-3 py-2.5 font-semibold">PHASES</th>
                <th className="px-3 py-2.5 font-semibold">ÉTAPES</th>
                <th className="px-3 py-2.5 font-semibold">TACHES</th>
                <th className="px-3 py-2.5 font-semibold">Dates</th>
                <th className="px-3 py-2.5 font-semibold">Statut</th>
                {weekWindows.map((w) => (
                  <th
                    key={w.label}
                    className="min-w-[78px] border-l border-[#232b3d]/60 px-2 py-2.5 text-center font-mono text-[10px] text-slate-400"
                    title={`${w.startIso} → ${w.endIso}`}
                  >
                    {w.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232b3d]/60">
              {tasks.map((task) => {
                const tStart = isoPrefix(task.startDate);
                const tEnd = isoPrefix(task.endDate) || tStart;
                const badgeClass =
                  STATUS_BADGE_CLASS[task.status] ?? STATUS_BADGE_CLASS.A_FAIRE;
                const statusLabel = STATUS_LABEL[task.status] ?? task.status;

                return (
                  <tr
                    key={task.id}
                    data-testid={`retro-task-${task.id}`}
                    data-task-id={task.id}
                    className="hover:bg-[#171d2b]/40"
                  >
                    <td className="px-3 py-2.5 font-medium text-slate-200">{task.phase}</td>
                    <td className="px-3 py-2.5 text-slate-400">{task.etape || "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium text-white">
                        {task.isMilestone && (
                          <span
                            title={`Jalon ${task.milestoneType ?? "CUSTOM"}`}
                            className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-300 ring-1 ring-rose-500/30"
                          >
                            <Flag className="h-2.5 w-2.5" />
                            {task.milestoneType ?? "JALON"}
                          </span>
                        )}
                        <span>{task.tache}</span>
                      </div>
                      {task.owner && (
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {task.owner}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-slate-300">
                      {tStart || "—"} → {tEnd || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}
                      >
                        {task.status === "TERMINE" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : task.status === "EN_ATTENTE_CLIENT" ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : null}
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
                          className="border-l border-[#232b3d]/50 px-1 py-2 text-center"
                        >
                          {active && (
                            <div
                              className={`mx-auto h-3 w-full rounded ${
                                task.status === "TERMINE"
                                  ? "bg-emerald-500/70"
                                  : task.status === "EN_ATTENTE_CLIENT"
                                    ? "bg-blue-600/80"
                                    : task.isMilestone
                                      ? "bg-rose-500/80"
                                      : "bg-cyan-500/70"
                              }`}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(task)}
                          className="inline-flex items-center gap-1 rounded border border-[#232b3d] bg-[#171d2b] px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-[#232b3d]"
                        >
                          <Edit3 className="h-3 w-3" />
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteTask(task.id)}
                          aria-label={`Supprimer ${task.tache}`}
                          className="rounded border border-red-500/30 bg-red-950/30 p-1 text-red-300 hover:bg-red-900/40"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-[#232b3d] bg-[#11151f] p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-white">
                  Modifier la tâche
                </h3>
                <p className="mt-0.5 text-xs text-cyan-300">{editingTask.tache}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className="rounded p-1 text-slate-400 hover:bg-[#171d2b] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveEdit(e)} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300">
                    Date début
                  </label>
                  <input
                    type="date"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    className="mt-1 w-full rounded border border-[#232b3d] bg-[#171d2b] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300">
                    Date fin
                  </label>
                  <input
                    type="date"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                    className="mt-1 w-full rounded border border-[#232b3d] bg-[#171d2b] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300">
                  Statut
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="mt-1 w-full rounded border border-[#232b3d] bg-[#171d2b] px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="A_FAIRE">À faire</option>
                  <option value="EN_COURS">En cours</option>
                  <option value="EN_ATTENTE_CLIENT">En attente client</option>
                  <option value="TERMINE">Terminé</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300">
                  Responsable
                </label>
                <input
                  type="text"
                  value={editOwner}
                  onChange={(e) => setEditOwner(e.target.value)}
                  className="mt-1 w-full rounded border border-[#232b3d] bg-[#171d2b] px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={editMilestone}
                  onChange={(e) => setEditMilestone(e.target.checked)}
                />
                Jalon Google Agenda
                {editMilestone && (
                  <select
                    value={editMilestoneType}
                    onChange={(e) => setEditMilestoneType(e.target.value)}
                    className="ml-auto rounded border border-[#232b3d] bg-[#171d2b] px-2 py-1 text-[11px] text-cyan-300"
                  >
                    <option value="INFLUENCE">INFLUENCE</option>
                    <option value="LANCEMENT_MAP">LANCEMENT_MAP</option>
                    <option value="WEEKLY">WEEKLY</option>
                    <option value="CUSTOM">CUSTOM</option>
                  </select>
                )}
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="rounded-lg border border-[#232b3d] bg-[#171d2b] px-3.5 py-1.5 text-xs font-semibold text-slate-300"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-lg bg-[#e11d48] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
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
