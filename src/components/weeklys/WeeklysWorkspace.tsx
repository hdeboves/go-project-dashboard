"use client";

import {
  FileText,
  Mail,
  Plus,
  Presentation,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { WeeklyTemplateEditor } from "@/components/templates/WeeklyTemplateEditor";
import {
  VisualPicker,
  type WeeklyVisualView,
} from "@/components/weeklys/VisualPicker";
import {
  WeeklyDigestPreview,
  type WeeklyDigestTaskView,
} from "@/components/weeklys/WeeklyDigestPreview";
import type { BlankWeeklyTemplate } from "@/lib/templates/project-templates";
import { getParisWorkWeekWindow } from "@/lib/shared/dates";
import { showToast } from "@/lib/toast";

interface WeeklyReportView {
  id: string;
  weekStart: string;
  weekEnd: string;
  title: string;
  slidesFileId: string | null;
  gmailDraftId: string | null;
  status: string;
  createdAt: string;
}

interface ShellStatusResponse {
  activeProjectId: string | null;
  projects: Array<{
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
  }>;
  googleConnected: boolean;
}

function currentWorkWeekWindow(): { weekStart: string; weekEnd: string } {
  return getParisWorkWeekWindow();
}

export function WeeklysWorkspace() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");
  const queryTab = searchParams.get("tab");
  const lastProjectIdRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<"composer" | "template">(
    queryTab === "template" ? "template" : "composer"
  );
  const [lastQueryTab, setLastQueryTab] = useState(queryTab);
  if (lastQueryTab !== queryTab) {
    setLastQueryTab(queryTab);
    if (queryTab === "template") setActiveTab("template");
    else if (queryTab === "composer") setActiveTab("composer");
  }

  const [projectId, setProjectId] = useState<string | null>(queryProjectId);
  const [projectLabel, setProjectLabel] = useState("");
  const [weekStart, setWeekStart] = useState(
    () => currentWorkWeekWindow().weekStart
  );
  const [weekEnd, setWeekEnd] = useState(() => currentWorkWeekWindow().weekEnd);
  const [tasks, setTasks] = useState<WeeklyDigestTaskView[]>([]);
  const [visuals, setVisuals] = useState<WeeklyVisualView[]>([]);
  const [selectedVisualIds, setSelectedVisualIds] = useState<string[]>([]);
  const [nextStepsClient, setNextStepsClient] = useState<string[]>([]);
  const [nextStepsGo, setNextStepsGo] = useState<string[]>([]);
  const [suggestedClient, setSuggestedClient] = useState<string[]>([]);
  const [suggestedGo, setSuggestedGo] = useState<string[]>([]);
  const [krispMeetingsCount, setKrispMeetingsCount] = useState(0);
  const [krispHighlights, setKrispHighlights] = useState<string[]>([]);
  const [newClientStep, setNewClientStep] = useState("");
  const [newGoStep, setNewGoStep] = useState("");
  const [weeklys, setWeeklys] = useState<WeeklyReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [setupRequiredMsg, setSetupRequiredMsg] = useState<string | null>(null);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // 1. Resolve active project from shell (only on mount / shell refresh, NOT on date change!)
  const resolveShell = useCallback(async () => {
    try {
      const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
      if (!shellRes.ok) return;
      const shell = (await shellRes.json()) as ShellStatusResponse;
      const targetId = queryProjectId || shell.activeProjectId || null;
      setProjectId(targetId);
      const proj = shell.projects.find((p) => p.id === targetId);
      setProjectLabel(
        proj
          ? `${proj.client} — ${proj.nomJeu} (CP ${proj.codeProjet})`
          : "Projet actif"
      );
      if (!shell.googleConnected) {
        setSetupRequiredMsg(
          "Connectez Google Workspace dans Paramètres pour créer vos Slides et brouillons Gmail."
        );
      } else {
        setSetupRequiredMsg(null);
      }
    } catch {
      // ignore transient error
    }
  }, [queryProjectId]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await resolveShell();
    };
    void init();
    const onRefresh = () => void resolveShell();
    window.addEventListener("go:shell-refresh", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", onRefresh);
    };
  }, [resolveShell]);

  // 2. Load Weekly preview when project or dates change
  const loadWeeklys = useCallback(async () => {
    if (!projectId || !weekStart || !weekEnd) {
      setLoading(false);
      return;
    }
    const isProjectSwitch = lastProjectIdRef.current !== projectId;
    lastProjectIdRef.current = projectId;
    if (isProjectSwitch) {
      setLoading(true);
      setSelectedVisualIds([]);
      setNextStepsClient([]);
      setNextStepsGo([]);
      setSuggestedClient([]);
      setSuggestedGo([]);
      setKrispMeetingsCount(0);
      setKrispHighlights([]);
      setNewClientStep("");
      setNewGoStep("");
      setApiWarnings([]);
      setFeedback(null);
      setWeeklys([]);
      setTasks([]);
      setVisuals([]);
    }
    try {
      const res = await fetch(
        `/api/projects/${projectId}/weeklys?preview=1&weekStart=${encodeURIComponent(weekStart)}&weekEnd=${encodeURIComponent(weekEnd)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        weeklys?: WeeklyReportView[];
        preview?: {
          tasks: WeeklyDigestTaskView[];
          availableVisuals: WeeklyVisualView[];
          suggestedNextStepsClient?: string[];
          suggestedNextStepsGo?: string[];
          krispMeetingsCount?: number;
          krispHighlights?: string[];
        };
        error?: string;
      };

      if (res.ok) {
        setWeeklys(json.weeklys ?? []);
        setTasks(json.preview?.tasks ?? []);
        setSuggestedClient(json.preview?.suggestedNextStepsClient ?? []);
        setSuggestedGo(json.preview?.suggestedNextStepsGo ?? []);
        setKrispMeetingsCount(json.preview?.krispMeetingsCount ?? 0);
        setKrispHighlights(json.preview?.krispHighlights ?? []);
        const avail = json.preview?.availableVisuals ?? [];
        setVisuals(avail);
        setSelectedVisualIds((prev) => {
          if (isProjectSwitch) return avail.slice(0, 3).map((v) => v.id);
          const validPrev = prev.filter((id) => avail.some((v) => v.id === id));
          return validPrev.length > 0
            ? validPrev
            : avail.slice(0, 3).map((v) => v.id);
        });
      } else {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de charger le Weekly.",
        });
      }
    } catch {
      setFeedback({ type: "error", text: "Erreur réseau." });
    } finally {
      setLoading(false);
    }
  }, [projectId, weekStart, weekEnd]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await loadWeeklys();
    };
    void init();
    return () => {
      active = false;
    };
  }, [loadWeeklys]);

  async function handleLoadSavedBlankTemplate() {
    try {
      const res = await fetch("/api/templates", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as {
          weeklyTemplate?: BlankWeeklyTemplate;
        };
        if (json.weeklyTemplate) {
          setNextStepsClient([...json.weeklyTemplate.nextStepsClient]);
          setNextStepsGo([...json.weeklyTemplate.nextStepsGo]);
          setSelectedVisualIds([]);
          showToast("Modèle vierge Weekly chargé !");
          return;
        }
      }
    } catch {
      // fallback
    }
    setNextStepsClient([]);
    setNextStepsGo([]);
    setSelectedVisualIds([]);
    showToast("Brouillon Weekly réinitialisé.");
  }

  function toggleVisual(id: string) {
    setSelectedVisualIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleGenerateWeekly() {
    if (!projectId) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/weeklys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart,
          weekEnd,
          nextStepsClient,
          nextStepsGo,
          visualDriveIds: selectedVisualIds,
        }),
      });
      const json = (await res.json()) as {
        weekly?: WeeklyReportView;
        warnings?: string[];
        error?: string;
      };

      if (res.status === 412) {
        setSetupRequiredMsg(
          json.error ?? "Connectez Google Workspace dans Paramètres."
        );
        return;
      }
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de générer le Weekly.",
        });
        return;
      }

      setApiWarnings(json.warnings ?? []);
      const okMsg =
        json.warnings && json.warnings.length > 0
          ? `Weekly généré (${json.weekly?.title ?? "OK"}) avec ${json.warnings.length} point(s) à vérifier ci-dessous.`
          : `Weekly prêt ! Slides et brouillon Gmail créés (${json.weekly?.title ?? "OK"}).`;
      setFeedback({ type: "success", text: okMsg });
      showToast(okMsg);
      await loadWeeklys();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Calm Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Weeklys Clients
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Mail className="h-3 w-3" />
              Brouillon Gmail uniquement (zéro envoi auto)
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {projectLabel || "Sélectionnez un projet dans la barre latérale."}
          </p>
        </div>
      </div>

      {setupRequiredMsg && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200"
        >
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>{setupRequiredMsg}</span>
          </div>
          <Link
            href="/settings"
            className="rounded-xl bg-indigo-600 px-3.5 py-1.5 font-semibold text-white hover:bg-indigo-700"
          >
            Paramètres
          </Link>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`rounded-2xl border p-3.5 text-xs ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {apiWarnings.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200"
        >
          <p className="font-semibold">Points à vérifier avant envoi client :</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {apiWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabs: Composer vs Blank Template */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("composer")}
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "composer"
                ? "border-rose-600 text-slate-900 dark:border-rose-400 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Presentation className="h-3.5 w-3.5" />
            Compositeur Weekly
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("template")}
            data-testid="weekly-tab-template"
            className={`inline-flex items-center gap-1.5 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "template"
                ? "border-rose-600 text-rose-700 dark:border-rose-400 dark:text-rose-300"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-rose-500" />
            Modèle vierge
          </button>
        </div>
      </div>

      {activeTab === "template" ? (
        <WeeklyTemplateEditor
          onApplyToComposer={(tpl) => {
            setNextStepsClient([...tpl.nextStepsClient]);
            setNextStepsGo([...tpl.nextStepsGo]);
            setSelectedVisualIds([]);
            setActiveTab("composer");
            showToast("Modèle vierge chargé dans le compositeur Weekly.");
          }}
        />
      ) : (
      /* 2-Column Executive Composer */
      <div className="grid gap-6 lg:grid-cols-12">
        {/* LEFT (7 cols): Period + Next Steps + Visuals */}
        <div className="space-y-6 lg:col-span-7">
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
            {/* Compact Period Strip with Quick Week Presets */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-3.5 dark:border-slate-800/80 dark:bg-slate-800/30">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Période
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const day = (now.getDay() + 6) % 7;
                    const mon = new Date(now.getTime() - day * 86_400_000);
                    const fri = new Date(mon.getTime() + 4 * 86_400_000);
                    setWeekStart(mon.toISOString().slice(0, 10));
                    setWeekEnd(fri.toISOString().slice(0, 10));
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#111827] dark:text-slate-300"
                >
                  Cette semaine
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const day = (now.getDay() + 6) % 7;
                    const mon = new Date(
                      now.getTime() - (day + 7) * 86_400_000
                    );
                    const fri = new Date(mon.getTime() + 4 * 86_400_000);
                    setWeekStart(mon.toISOString().slice(0, 10));
                    setWeekEnd(fri.toISOString().slice(0, 10));
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#111827] dark:text-slate-300"
                >
                  Semaine dernière
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Du
                  <input
                    type="date"
                    value={weekStart}
                    onChange={(e) => setWeekStart(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-[#111827] dark:text-white"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  au
                  <input
                    type="date"
                    value={weekEnd}
                    onChange={(e) => setWeekEnd(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-[#111827] dark:text-white"
                  />
                </label>
              </div>
            </div>

            {/* Next Steps (2 Hairline-Divided Columns) */}
            <div className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Prochaines étapes
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Affichées directement sur la slide « Prochaines étapes » du
                    client.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLoadSavedBlankTemplate()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Charger modèle vierge
                  </button>
                  {(tasks.length > 0 ||
                    suggestedClient.length > 0 ||
                    suggestedGo.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        const nextC =
                          suggestedClient.length > 0
                            ? suggestedClient
                            : tasks
                                .filter((t) => t.status === "EN_ATTENTE_CLIENT")
                                .slice(0, 4)
                                .map((t) => t.tache);
                        const nextG =
                          suggestedGo.length > 0
                            ? suggestedGo
                            : tasks
                                .filter((t) => t.status === "EN_COURS")
                                .slice(0, 4)
                                .map((t) => t.tache);
                        if (nextC.length > 0) setNextStepsClient(nextC);
                        if (nextG.length > 0) setNextStepsGo(nextG);
                        showToast(
                          nextC.length + nextG.length > 0
                            ? krispMeetingsCount > 0
                              ? `Pré-rempli depuis le planning + ${krispMeetingsCount} CR Krisp de la semaine !`
                              : "Prochaines étapes pré-remplies depuis votre planning !"
                            : "Aucune tâche ou action Krisp détectée sur la période."
                        );
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100/80 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300"
                    >
                      <Sparkles className="h-3 w-3" />
                      {krispMeetingsCount > 0
                        ? `Pré-remplir (Planning + ${krispMeetingsCount} CR Krisp)`
                        : "Pré-remplir depuis le planning"}
                    </button>
                  )}
                </div>
              </div>

              {krispHighlights.length > 0 && (
                <div className="mb-4 rounded-xl border border-indigo-200/70 bg-indigo-50/40 px-3.5 py-2.5 text-[11px] text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                  <p className="font-semibold text-indigo-700 dark:text-indigo-300">
                    Décisions clés issues de vos CR Krisp de la semaine :
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {krispHighlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-5 md:grid-cols-2 md:divide-x md:divide-slate-100 dark:md:divide-slate-800/80">
                {/* Côté Client */}
                <div className="flex flex-col justify-between gap-2.5">
                  <div className="space-y-2.5">
                    <h3 className="text-[11px] font-bold tracking-wider text-indigo-700 uppercase dark:text-indigo-300">
                      Côté Client
                    </h3>
                    <ul className="space-y-1.5">
                      {nextStepsClient.map((step, idx) => (
                        <li
                          key={`${step}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-100"
                        >
                          <span className="leading-snug">{step}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setNextStepsClient((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="shrink-0 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <input
                      type="text"
                      value={newClientStep}
                      onChange={(e) => setNewClientStep(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newClientStep.trim()) {
                          e.preventDefault();
                          setNextStepsClient((prev) => [
                            ...prev,
                            newClientStep.trim(),
                          ]);
                          setNewClientStep("");
                        }
                      }}
                      placeholder="Ajouter une action client..."
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-[#111827] dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newClientStep.trim()) return;
                        setNextStepsClient((prev) => [
                          ...prev,
                          newClientStep.trim(),
                        ]);
                        setNewClientStep("");
                      }}
                      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                      title="Ajouter"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Côté GO */}
                <div className="flex flex-col justify-between gap-2.5 md:pl-5">
                  <div className="space-y-2.5">
                    <h3 className="text-[11px] font-bold tracking-wider text-indigo-700 uppercase dark:text-indigo-300">
                      Côté Agence
                    </h3>
                    <ul className="space-y-1.5">
                      {nextStepsGo.map((step, idx) => (
                        <li
                          key={`${step}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-100"
                        >
                          <span className="leading-snug">{step}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setNextStepsGo((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="shrink-0 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <input
                      type="text"
                      value={newGoStep}
                      onChange={(e) => setNewGoStep(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newGoStep.trim()) {
                          e.preventDefault();
                          setNextStepsGo((prev) => [...prev, newGoStep.trim()]);
                          setNewGoStep("");
                        }
                      }}
                      placeholder="Ajouter une action équipe..."
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-[#111827] dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newGoStep.trim()) return;
                        setNextStepsGo((prev) => [...prev, newGoStep.trim()]);
                        setNewGoStep("");
                      }}
                      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                      title="Ajouter"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {!loading && (
            <VisualPicker
              visuals={visuals}
              selectedIds={selectedVisualIds}
              onToggle={toggleVisual}
            />
          )}
        </div>

        {/* RIGHT (5 cols, sticky): Live Preview + Primary Generate CTA + Compact History */}
        <aside className="space-y-5 self-start lg:sticky lg:top-16 lg:col-span-5">
          {/* Action Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Prêt à générer
              </h2>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {selectedVisualIds.length} visuel(s) ·{" "}
                {nextStepsClient.length + nextStepsGo.length} étape(s)
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Crée la présentation Google Slides dans le dossier client et
              prépare le brouillon Gmail prêt à relire.
            </p>
            <button
              type="button"
              disabled={!projectId || generating}
              onClick={() => void handleGenerateWeekly()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Création en cours..." : "Générer le Weekly"}
            </button>
          </div>

          {!loading && (
            <WeeklyDigestPreview
              weekStart={weekStart}
              weekEnd={weekEnd}
              tasks={tasks}
            />
          )}

          {/* Compact History */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800/80">
              <div className="flex items-center gap-2">
                <Presentation className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Weeklys déjà créés
                </h2>
              </div>
              <span className="text-xs text-slate-400">{weeklys.length}</span>
            </div>

            {weeklys.length === 0 ? (
              <p className="py-5 text-center text-xs text-slate-500 dark:text-slate-400">
                Aucun Weekly généré pour ce projet.
              </p>
            ) : (
              <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800/70">
                {weeklys.map((w) => (
                  <div
                    key={w.id}
                    data-testid={`weekly-report-${w.id}`}
                    className="py-2.5 text-xs"
                  >
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {w.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      Du {w.weekStart.slice(0, 10)} au {w.weekEnd.slice(0, 10)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {w.slidesFileId && (
                        <a
                          href={`https://docs.google.com/presentation/d/${w.slidesFileId}/edit`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
                        >
                          <FileText className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                          Slides
                        </a>
                      )}
                      {w.gmailDraftId && (
                        <a
                          href="https://mail.google.com/mail/u/0/#drafts"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300"
                        >
                          <Mail className="h-3 w-3" />
                          Ouvrir brouillon Gmail
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
      )}
    </div>
  );
}
