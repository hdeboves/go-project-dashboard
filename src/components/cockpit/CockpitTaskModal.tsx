"use client";

import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Flag,
  Plus,
  User,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { getParisTodayIso } from "@/lib/shared/dates";
import { showToast } from "@/lib/toast";
import type { CockpitTaskItem } from "@/components/cockpit/UpcomingTasksCard";

export const COCKPIT_TASK_CREATED_EVENT = "go:cockpit-task-created";
export const COCKPIT_OPEN_TASK_MODAL_EVENT = "go:open-cockpit-task-modal";

export interface CockpitTeamUserOption {
  id: string;
  name: string;
  email: string;
}

interface CockpitTaskCreatorProps {
  projectId: string;
  projectLabel: string;
  phases: string[];
  teamUsers: CockpitTeamUserOption[];
  currentUserId: string | null;
}

const STATUS_OPTIONS = [
  { value: "A_FAIRE", label: "À faire" },
  { value: "EN_COURS", label: "En cours" },
  { value: "EN_ATTENTE_CLIENT", label: "Attente client" },
] as const;

const MILESTONE_OPTIONS = [
  { value: "CUSTOM", label: "Jalon personnalisé" },
  { value: "INFLUENCE", label: "Influence" },
  { value: "LANCEMENT_MAP", label: "Lancement" },
  { value: "WEEKLY", label: "Weekly client" },
] as const;

function addCalendarDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return next.toISOString().slice(0, 10);
}

export function CockpitTaskCreator({
  projectId,
  projectLabel,
  phases,
  teamUsers,
  currentUserId,
}: CockpitTaskCreatorProps) {
  const router = useRouter();
  const titleId = useId();
  const phaseListId = useId();
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const todayIso = getParisTodayIso();
  const tomorrowIso = useMemo(() => addCalendarDays(todayIso, 1), [todayIso]);
  const plusSevenIso = useMemo(() => addCalendarDays(todayIso, 7), [todayIso]);

  const phaseSuggestions = useMemo(() => {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const raw of [...phases, "Production", "Pré-production", "Livraison"]) {
      const clean = raw.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(clean);
      }
    }
    return unique;
  }, [phases]);

  const defaultPhase = phases[0]?.trim() || "Production";

  const [open, setOpen] = useState(false);
  const [tache, setTache] = useState("");
  const [phase, setPhase] = useState(defaultPhase);
  const [etape, setEtape] = useState("Général");
  const [endDate, setEndDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [status, setStatus] = useState<string>("A_FAIRE");
  const [selectedUserId, setSelectedUserId] = useState<string>(
    currentUserId ?? ""
  );
  const [customOwner, setCustomOwner] = useState("");
  const [isMilestone, setIsMilestone] = useState(false);
  const [milestoneType, setMilestoneType] = useState("CUSTOM");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openModal = useCallback(
    (prefill?: { title?: string; endDate?: string }) => {
      setErrorMsg(null);
      setTache(prefill?.title ?? "");
      setPhase(defaultPhase);
      setEtape("Général");
      setEndDate(prefill?.endDate ?? "");
      setStartDate("");
      setStatus("A_FAIRE");
      setSelectedUserId(currentUserId ?? "");
      setCustomOwner("");
      setIsMilestone(false);
      setMilestoneType("CUSTOM");
      setShowAdvanced(false);
      setOpen(true);
    },
    [currentUserId, defaultPhase]
  );

  const closeModal = useCallback(() => {
    if (submitting) return;
    setOpen(false);
    setErrorMsg(null);
  }, [submitting]);

  useEffect(() => {
    const onOpenRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          projectId?: string;
          title?: string;
          endDate?: string;
        }>
      ).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      openModal({ title: detail?.title, endDate: detail?.endDate });
    };
    window.addEventListener(COCKPIT_OPEN_TASK_MODAL_EVENT, onOpenRequest);
    return () =>
      window.removeEventListener(COCKPIT_OPEN_TASK_MODAL_EVENT, onOpenRequest);
  }, [openModal, projectId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const sortedTeamUsers = useMemo(() => {
    return [...teamUsers].sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      return a.name.localeCompare(b.name, "fr");
    });
  }, [teamUsers, currentUserId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const cleanTitle = tache.trim();
    if (!cleanTitle) {
      setErrorMsg("Indiquez un intitulé pour la tâche.");
      titleInputRef.current?.focus();
      return;
    }

    if (startDate && endDate && endDate < startDate) {
      setErrorMsg(
        "La date d'échéance doit être postérieure ou égale à la date de début."
      );
      return;
    }

    let ownerName: string | null = null;
    let ownerUserId: string | null = null;
    if (selectedUserId === "__custom__") {
      ownerName = customOwner.trim() || null;
    } else if (selectedUserId) {
      const matched = teamUsers.find((u) => u.id === selectedUserId);
      if (matched) {
        ownerName = matched.name;
        ownerUserId = matched.id;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/retroplanning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: phase.trim() || defaultPhase,
          etape: etape.trim() || "Général",
          tache: cleanTitle,
          owner: ownerName,
          ownerUserId,
          startDate: startDate || null,
          endDate: endDate || null,
          status,
          isMilestone,
          milestoneType: isMilestone ? milestoneType : null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        task?: CockpitTaskItem;
        error?: string;
      };

      if (!res.ok || !json.task) {
        setErrorMsg(json.error ?? "Impossible de créer la tâche.");
        return;
      }

      window.dispatchEvent(
        new CustomEvent(COCKPIT_TASK_CREATED_EVENT, {
          detail: { projectId, task: json.task },
        })
      );
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      showToast(`Tâche ajoutée : « ${cleanTitle} »`);
      setOpen(false);
      router.refresh();
    } catch {
      setErrorMsg("Erreur réseau lors de la création de la tâche.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openModal()}
        data-testid="cockpit-new-task-btn"
        className="group flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-left text-xs font-semibold text-slate-800 transition-all hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-600 group-hover:text-white dark:bg-indigo-500/15 dark:text-indigo-400 dark:group-hover:bg-indigo-500 dark:group-hover:text-white">
          <Plus className="h-4 w-4" />
        </span>
        <span>Nouvelle tâche</span>
      </button>

      <Modal
        open={open}
        onClose={closeModal}
        labelledBy={titleId}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={(e) => void handleSubmit(e)}>
          {/* Modal Header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                <Plus className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3
                  id={titleId}
                  className="text-sm font-bold text-slate-900 dark:text-white"
                >
                  Nouvelle tâche
                </h3>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {projectLabel}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeModal}
              aria-label="Fermer la fenêtre"
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="space-y-4 px-5 py-4">
            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Task Title */}
            <div>
              <label
                htmlFor="cockpit-task-title"
                className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                Intitulé de la tâche <span className="text-rose-600">*</span>
              </label>
              <input
                ref={titleInputRef}
                id="cockpit-task-title"
                type="text"
                required
                value={tache}
                onChange={(e) => setTache(e.target.value)}
                placeholder="Ex : Valider le montage V2 avec le client"
                className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-400 dark:focus:bg-slate-900"
              />
            </div>

            {/* Due Date + Quick Pills */}
            <div>
              <label
                htmlFor="cockpit-task-end-date"
                className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
              >
                <Calendar className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                Échéance
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="cockpit-task-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: "Aujourd'hui", value: todayIso },
                    { label: "Demain", value: tomorrowIso },
                    { label: "+7 jours", value: plusSevenIso },
                  ].map((preset) => {
                    const active = endDate === preset.value;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setEndDate(preset.value)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                          active
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                  {endDate && (
                    <button
                      type="button"
                      onClick={() => setEndDate("")}
                      className="rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      Effacer
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Phase & Owner */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="cockpit-task-phase"
                  className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  Phase / Section
                </label>
                <input
                  id="cockpit-task-phase"
                  type="text"
                  list={phaseListId}
                  value={phase}
                  onChange={(e) => setPhase(e.target.value)}
                  placeholder="Production"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
                <datalist id={phaseListId}>
                  {phaseSuggestions.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              <div>
                <label
                  htmlFor="cockpit-task-owner"
                  className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  <User className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                  Responsable
                </label>
                <select
                  id="cockpit-task-owner"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                >
                  <option value="">Non assigné</option>
                  {sortedTeamUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === currentUserId ? `${u.name} (moi)` : u.name}
                    </option>
                  ))}
                  <option value="__custom__">Autre personne…</option>
                </select>
                {selectedUserId === "__custom__" && (
                  <input
                    type="text"
                    value={customOwner}
                    onChange={(e) => setCustomOwner(e.target.value)}
                    placeholder="Nom du responsable"
                    aria-label="Nom du responsable"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                )}
              </div>
            </div>

            {/* Status pills */}
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                Statut
              </span>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((opt) => {
                  const active = status === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setStatus(opt.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                        active
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-indigo-500/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Collapsible Advanced Options */}
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
              >
                {showAdvanced ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                Options avancées (étape, date de début, jalon)
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="cockpit-task-etape"
                        className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                      >
                        Étape
                      </label>
                      <input
                        id="cockpit-task-etape"
                        type="text"
                        value={etape}
                        onChange={(e) => setEtape(e.target.value)}
                        placeholder="Général"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="cockpit-task-start-date"
                        className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                      >
                        Date de début (optionnel)
                      </label>
                      <input
                        id="cockpit-task-start-date"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={isMilestone}
                        onChange={(e) => setIsMilestone(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <Flag className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      Marquer comme jalon clé
                    </label>
                    {isMilestone && (
                      <select
                        value={milestoneType}
                        onChange={(e) => setMilestoneType(e.target.value)}
                        aria-label="Type de jalon"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-indigo-500 focus-visible:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {MILESTONE_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/40">
            <button
              type="button"
              onClick={closeModal}
              disabled={submitting}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting || !tache.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting ? "Création…" : "Créer la tâche"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
