"use client";

import {
  CalendarPlus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CascadeRulesPanel,
  type CalendarRuleView,
} from "@/components/calendar/CascadeRulesPanel";
import {
  CascadeTimeline,
  type CalendarEventView,
} from "@/components/calendar/CascadeTimeline";

interface ShellStatusResponse {
  activeProjectId: string | null;
  projects: Array<{
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
    isSandbox: boolean;
  }>;
  googleConnected: boolean;
}

export function CalendarWorkspace() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState("");
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [calendarSummary, setCalendarSummary] = useState("");
  const [rules, setRules] = useState<CalendarRuleView[]>([]);
  const [events, setEvents] = useState<CalendarEventView[]>([]);
  const [shareEmailsInput, setShareEmailsInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingCal, setCreatingCal] = useState(false);
  const [syncingCascades, setSyncingCascades] = useState(false);
  const [setupRequiredMsg, setSetupRequiredMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
      const shell = shellRes.ok
        ? ((await shellRes.json()) as ShellStatusResponse)
        : null;
      const targetId = queryProjectId || shell?.activeProjectId || null;

      if (!targetId) {
        setProjectId(null);
        setRules([]);
        setEvents([]);
        return;
      }

      setProjectId(targetId);
      const proj = shell?.projects.find((p) => p.id === targetId);
      setProjectLabel(
        proj
          ? `${proj.client} — ${proj.nomJeu} (CP ${proj.codeProjet})`
          : `Projet actif`
      );

      if (shell && !shell.googleConnected) {
        setSetupRequiredMsg(
          "Connectez Google Workspace dans Paramètres pour activer l'agenda projet."
        );
      } else {
        setSetupRequiredMsg(null);
      }

      const res = await fetch(`/api/projects/${targetId}/calendar`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        calendarId?: string | null;
        calendarSummary?: string;
        rules?: CalendarRuleView[];
        events?: CalendarEventView[];
        error?: string;
      };

      if (res.ok) {
        setCalendarId(json.calendarId ?? null);
        setCalendarSummary(json.calendarSummary ?? "");
        setRules(json.rules ?? []);
        setEvents(json.events ?? []);
      } else {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de charger l'agenda.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [queryProjectId]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) {
        await loadCalendar();
      }
    };
    void init();
    const onRefresh = () => void loadCalendar();
    window.addEventListener("go:shell-refresh", onRefresh);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", onRefresh);
    };
  }, [loadCalendar]);

  async function handleCreateCalendar() {
    if (!projectId) return;
    setCreatingCal(true);
    setFeedback(null);
    try {
      const shareWithEmails = shareEmailsInput
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);

      const res = await fetch(`/api/projects/${projectId}/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(shareWithEmails.length > 0
            ? { shareWithEmails, role: "writer" }
            : {}),
        }),
      });
      const json = (await res.json()) as {
        calendarId?: string;
        summary?: string;
        error?: string;
      };

      if (res.status === 412) {
        setSetupRequiredMsg(json.error ?? "Google Agenda non connecté.");
        return;
      }
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de créer l'agenda.",
        });
        return;
      }

      setFeedback({
        type: "success",
        text: `Agenda projet prêt : ${json.summary ?? "OK"}`,
      });
      await loadCalendar();
    } finally {
      setCreatingCal(false);
    }
  }

  async function handleSyncCascades() {
    if (!projectId) return;
    setSyncingCascades(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/calendar/sync-cascades`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const json = (await res.json()) as {
        syncedCount?: number;
        cancelledCount?: number;
        error?: string;
      };

      if (res.status === 412) {
        setSetupRequiredMsg(json.error ?? "Google Agenda non connecté.");
        return;
      }
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de mettre à jour les rappels.",
        });
        return;
      }

      setFeedback({
        type: "success",
        text: `Rappels mis à jour : ${json.syncedCount ?? 0} événement(s) actif(s).`,
      });
      await loadCalendar();
    } finally {
      setSyncingCascades(false);
    }
  }

  async function handleAddRule(rule: {
    milestoneType: "INFLUENCE" | "LANCEMENT_MAP" | "WEEKLY" | "CUSTOM";
    offsetDays: number;
    titleTemplate: string;
  }) {
    if (!projectId) return;
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UPSERT_RULE", ...rule }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible d'ajouter la règle.",
        });
        return;
      }
      setFeedback({ type: "success", text: "Rappel automatique ajouté." });
      await loadCalendar();
    } catch {
      setFeedback({ type: "error", text: "Erreur réseau." });
    }
  }

  async function handleDeleteRule(ruleId: string) {
    if (!projectId) return;
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/calendar?ruleId=${encodeURIComponent(ruleId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de supprimer la règle.",
        });
        return;
      }
      await loadCalendar();
    } catch {
      setFeedback({ type: "error", text: "Erreur réseau." });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Agenda & Rappels
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {projectLabel || "Sélectionnez un projet dans la barre du haut."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!projectId || creatingCal}
            onClick={() => void handleCreateCalendar()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <CalendarPlus className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            {creatingCal
              ? "Création..."
              : calendarId
                ? "Partager à l'équipe"
                : "Créer l'agenda projet"}
          </button>

          <button
            type="button"
            disabled={!projectId || syncingCascades}
            onClick={() => void handleSyncCascades()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncingCascades ? "animate-spin" : ""}`}
            />
            {syncingCascades ? "Synchronisation..." : "Mettre à jour les rappels"}
          </button>
        </div>
      </div>

      {/* Dedicated Calendar Info Card */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Agenda dédié — votre agenda personnel n&apos;est jamais touché
          </div>
          <p className="text-base font-bold text-slate-900 dark:text-white">
            {calendarSummary || "Agenda projet à créer"}
          </p>
        </div>

        <div className="flex min-w-[260px] flex-1 items-center gap-2 sm:max-w-md">
          <Users className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={shareEmailsInput}
            onChange={(e) => setShareEmailsInput(e.target.value)}
            placeholder="Partager avec des collègues (emails séparés par virgule)"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
          />
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

      {loading ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          Chargement de l&apos;agenda...
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <CascadeTimeline events={events} />
          <CascadeRulesPanel
            rules={rules}
            onAddRule={handleAddRule}
            onDeleteRule={handleDeleteRule}
          />
        </div>
      )}
    </div>
  );
}
