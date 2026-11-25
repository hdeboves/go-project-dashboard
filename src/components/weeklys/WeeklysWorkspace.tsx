"use client";

import {
  FileText,
  Mail,
  Plus,
  Presentation,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  VisualPicker,
  type WeeklyVisualView,
} from "@/components/weeklys/VisualPicker";
import {
  WeeklyDigestPreview,
  type WeeklyDigestTaskView,
} from "@/components/weeklys/WeeklyDigestPreview";

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

function defaultWindow(): { weekStart: string; weekEnd: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { weekStart: start, weekEnd: end };
}

export function WeeklysWorkspace() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");
  const lastProjectIdRef = useRef<string | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [tasks, setTasks] = useState<WeeklyDigestTaskView[]>([]);
  const [visuals, setVisuals] = useState<WeeklyVisualView[]>([]);
  const [selectedVisualIds, setSelectedVisualIds] = useState<string[]>([]);
  const [nextStepsClient, setNextStepsClient] = useState<string[]>([
    "Validation des derniers livrables",
  ]);
  const [nextStepsGo, setNextStepsGo] = useState<string[]>([
    "Poursuite de la production et suivi planning",
  ]);
  const [newClientStep, setNewClientStep] = useState("");
  const [newGoStep, setNewGoStep] = useState("");
  const [weeklys, setWeeklys] = useState<WeeklyReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [setupRequiredMsg, setSetupRequiredMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadWeeklys = useCallback(async () => {
    if (!weekStart || !weekEnd) {
      return;
    }
    setLoading(true);
    try {
      const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
      const shell = shellRes.ok
        ? ((await shellRes.json()) as ShellStatusResponse)
        : null;

      const targetId = queryProjectId || shell?.activeProjectId || null;
      const isProjectSwitch = lastProjectIdRef.current !== targetId;
      lastProjectIdRef.current = targetId;

      if (!targetId) {
        setProjectId(null);
        setWeeklys([]);
        setTasks([]);
        setVisuals([]);
        setSelectedVisualIds([]);
        return;
      }

      if (isProjectSwitch) {
        setSelectedVisualIds([]);
      }

      setProjectId(targetId);
      const proj = shell?.projects.find((p) => p.id === targetId);
      setProjectLabel(
        proj
          ? `CP ${proj.codeProjet} | ${proj.client} — ${proj.nomJeu}`
          : `Projet ${targetId}`
      );

      if (shell && !shell.googleConnected) {
        setSetupRequiredMsg(
          "Connecteur Google Slides / Gmail non configuré. Connectez OAuth2 dans Paramètres."
        );
      } else {
        setSetupRequiredMsg(null);
      }

      const res = await fetch(
        `/api/projects/${targetId}/weeklys?preview=1&weekStart=${encodeURIComponent(weekStart)}&weekEnd=${encodeURIComponent(weekEnd)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        weeklys?: WeeklyReportView[];
        preview?: {
          tasks: WeeklyDigestTaskView[];
          availableVisuals: WeeklyVisualView[];
        };
        error?: string;
      };

      if (res.ok) {
        setWeeklys(json.weeklys ?? []);
        setTasks(json.preview?.tasks ?? []);
        const avail = json.preview?.availableVisuals ?? [];
        setVisuals(avail);
        setSelectedVisualIds((prev) => {
          if (isProjectSwitch) {
            return avail.slice(0, 3).map((v) => v.id);
          }
          const validPrev = prev.filter((id) => avail.some((v) => v.id === id));
          return validPrev.length > 0
            ? validPrev
            : avail.slice(0, 3).map((v) => v.id);
        });
      } else {
        setFeedback({
          type: "error",
          text:
            json.error ?? "Impossible de charger la prévisualisation du Weekly.",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        text: "Erreur réseau lors du chargement des Weeklys.",
      });
    } finally {
      setLoading(false);
    }
  }, [queryProjectId, weekStart, weekEnd]);

  useEffect(() => {
    let active = true;
    const initDates = async () => {
      await Promise.resolve();
      if (!active) return;
      const win = defaultWindow();
      setWeekStart((prev) => prev || win.weekStart);
      setWeekEnd((prev) => prev || win.weekEnd);
    };
    void initDates();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) {
        await loadWeeklys();
      }
    };
    void init();
    const onRefresh = () => void loadWeeklys();
    window.addEventListener("go:shell-refresh", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", onRefresh);
    };
  }, [loadWeeklys]);

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
          text: json.error ?? "Échec de la génération du Weekly.",
        });
        return;
      }

      const warnSuffix =
        json.warnings && json.warnings.length > 0
          ? ` (Avertissement partage : ${json.warnings.join(", ")})`
          : "";
      setFeedback({
        type: "success",
        text: `Weekly généré dans 003.2 + Brouillon Gmail créé : ${json.weekly?.title ?? "OK"}${warnSuffix}`,
      });
      await loadWeeklys();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Générateur Weeklys Clients (Slides 003.2 + Brouillon Gmail)
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {projectLabel || "Sélectionnez ou initialisez un projet."}
          </p>
        </div>

        <button
          type="button"
          disabled={!projectId || generating}
          onClick={() => void handleGenerateWeekly()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {generating ? "Génération..." : "Générer le Weekly"}
        </button>
      </div>

      {/* Period Window J-7 -> J */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-[#232b3d] bg-[#11151f] p-4 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400">
              Début fenêtre (J-7)
            </label>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="mt-1 rounded border border-[#232b3d] bg-[#171d2b] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400">
              Fin fenêtre (J)
            </label>
            <input
              type="date"
              value={weekEnd}
              onChange={(e) => setWeekEnd(e.target.value)}
              className="mt-1 rounded border border-[#232b3d] bg-[#171d2b] px-2.5 py-1.5 text-xs text-white"
            />
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] text-emerald-300">
          <Mail className="h-3.5 w-3.5" />
          Draft-First : brouillon Gmail uniquement (zéro envoi auto)
        </div>
      </div>

      {setupRequiredMsg && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-amber-950/40 p-4 text-xs text-amber-100"
        >
          <div className="flex items-center gap-2.5">
            <Settings className="h-4 w-4 text-amber-300" />
            <span>{setupRequiredMsg}</span>
          </div>
          <Link
            href="/settings"
            className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-amber-400"
          >
            Configurer dans Paramètres
          </Link>
        </div>
      )}

      {feedback && (
        <div
          role="status"
          className={`rounded-xl border p-3.5 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              : "border-red-500/40 bg-red-950/40 text-red-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 2-Column Prochaines étapes Editor */}
      <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
        <div className="border-b border-[#232b3d] pb-3">
          <h2 className="text-base font-bold text-white">
            Prochaines étapes — Structure 2 colonnes
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Injectées sur la slide dédiée du deck Weekly (Côté Client vs Côté GO)
          </p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Côté Client */}
          <div className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4">
            <h3 className="text-xs font-bold tracking-wide text-cyan-300 uppercase">
              Côté Client
            </h3>
            <ul className="mt-3 space-y-2">
              {nextStepsClient.map((step, idx) => (
                <li
                  key={`${step}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <span>{step}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNextStepsClient((prev) =>
                        prev.filter((_, i) => i !== idx)
                      )
                    }
                    className="text-slate-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newClientStep}
                onChange={(e) => setNewClientStep(e.target.value)}
                placeholder="Ajouter action Côté Client..."
                className="flex-1 rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newClientStep.trim()) return;
                  setNextStepsClient((prev) => [...prev, newClientStep.trim()]);
                  setNewClientStep("");
                }}
                className="inline-flex items-center gap-1 rounded bg-cyan-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter
              </button>
            </div>
          </div>

          {/* Côté GO */}
          <div className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4">
            <h3 className="text-xs font-bold tracking-wide text-rose-300 uppercase">
              Côté GO
            </h3>
            <ul className="mt-3 space-y-2">
              {nextStepsGo.map((step, idx) => (
                <li
                  key={`${step}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <span>{step}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNextStepsGo((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-slate-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newGoStep}
                onChange={(e) => setNewGoStep(e.target.value)}
                placeholder="Ajouter action Côté GO..."
                className="flex-1 rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newGoStep.trim()) return;
                  setNextStepsGo((prev) => [...prev, newGoStep.trim()]);
                  setNewGoStep("");
                }}
                className="inline-flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter
              </button>
            </div>
          </div>
        </div>
      </section>

      {!loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          <WeeklyDigestPreview
            weekStart={weekStart}
            weekEnd={weekEnd}
            tasks={tasks}
          />
          <VisualPicker
            visuals={visuals}
            selectedIds={selectedVisualIds}
            onToggle={toggleVisual}
          />
        </div>
      )}

      {/* Weekly History */}
      <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
        <div className="flex items-center justify-between border-b border-[#232b3d] pb-3">
          <div className="flex items-center gap-2">
            <Presentation className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Historique Weeklys Clients (003.2)
            </h2>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            {weeklys.length} deck(s)
          </span>
        </div>

        {weeklys.length === 0 ? (
          <p className="mt-4 text-xs text-slate-400">
            Aucun Weekly généré pour ce projet.
          </p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {weeklys.map((w) => (
              <div
                key={w.id}
                data-testid={`weekly-report-${w.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-3 text-xs"
              >
                <div>
                  <p className="font-semibold text-white">{w.title}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                    Fenêtre : {w.weekStart.slice(0, 10)} → {w.weekEnd.slice(0, 10)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {w.slidesFileId && (
                    <a
                      href={`https://docs.google.com/presentation/d/${w.slidesFileId}/edit`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                    >
                      <FileText className="h-3 w-3" />
                      Slides 003.2
                    </a>
                  )}
                  {w.gmailDraftId && (
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-200">
                      <Mail className="h-3 w-3" />
                      Brouillon Gmail ({w.gmailDraftId})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
