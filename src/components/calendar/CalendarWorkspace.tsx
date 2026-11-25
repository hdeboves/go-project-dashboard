"use client";

import { CalendarPlus, RefreshCw, Settings, ShieldCheck, Users } from "lucide-react";
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
          ? `CP ${proj.codeProjet} | ${proj.client} — ${proj.nomJeu}`
          : `Projet ${targetId}`
      );

      if (shell && !shell.googleConnected) {
        setSetupRequiredMsg(
          "Connecteur Google Calendar non configuré. Connectez votre compte dans Paramètres."
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
          text: json.error ?? "Impossible de charger le module Agenda.",
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
          ...(shareWithEmails.length > 0 ? { shareWithEmails, role: "writer" } : {}),
        }),
      });
      const json = (await res.json()) as {
        calendarId?: string;
        summary?: string;
        error?: string;
      };

      if (res.status === 412) {
        setSetupRequiredMsg(
          json.error ?? "Google Calendar OAuth2 non connecté."
        );
        return;
      }
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Échec de la création du calendrier.",
        });
        return;
      }

      setFeedback({
        type: "success",
        text: `Calendrier secondaire dédié créé : ${json.summary ?? json.calendarId}`,
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
        setSetupRequiredMsg(
          json.error ?? "Google Calendar OAuth2 non connecté."
        );
        return;
      }
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Échec de la synchronisation des cascades.",
        });
        return;
      }

      setFeedback({
        type: "success",
        text: `Cascades synchronisées en place : ${json.syncedCount ?? 0} événement(s) actif(s), ${json.cancelledCount ?? 0} annulé(s).`,
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
          text: json.error ?? "Échec de l'enregistrement de la règle Agenda.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: "Règle Agenda enregistrée.",
      });
      await loadCalendar();
    } catch {
      setFeedback({
        type: "error",
        text: "Erreur réseau lors de l'enregistrement de la règle Agenda.",
      });
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
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Échec de la suppression de la règle Agenda.",
        });
        return;
      }
      setFeedback({
        type: "success",
        text: "Règle Agenda supprimée.",
      });
      await loadCalendar();
    } catch {
      setFeedback({
        type: "error",
        text: "Erreur réseau lors de la suppression de la règle Agenda.",
      });
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Google Agenda Dédié & Cascades Automatiques
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {projectLabel || "Sélectionnez ou initialisez un projet."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={!projectId || creatingCal}
            onClick={() => void handleCreateCalendar()}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            {creatingCal
              ? "Initialisation..."
              : calendarId
                ? "Mettre à jour / Partager le calendrier"
                : "Créer le calendrier dédié"}
          </button>

          <button
            type="button"
            disabled={!projectId || syncingCascades}
            onClick={() => void handleSyncCascades()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingCascades ? "animate-spin" : ""}`} />
            {syncingCascades ? "Synchronisation..." : "Synchroniser les cascades"}
          </button>
        </div>
      </div>

      {/* Secondary Calendar Sandbox Guard Card */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#232b3d] bg-[#11151f] p-5 text-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            <span className="font-semibold">
              Agenda secondaire isolé (<code className="font-mono">&apos;primary&apos;</code> strictement bloqué)
            </span>
          </div>
          <p className="font-mono text-sm font-bold text-white">
            {calendarSummary || "Calendrier secondaire à initialiser"}
          </p>
          <p className="font-mono text-[11px] text-slate-400">
            calendarId : {calendarId ?? "Non créé"}
          </p>
        </div>

        <div className="flex min-w-[260px] flex-1 items-center gap-2 sm:max-w-md">
          <Users className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            type="text"
            value={shareEmailsInput}
            onChange={(e) => setShareEmailsInput(e.target.value)}
            placeholder="Partager équipe (ex: paul@gamersorigin.com, souleimane@...)"
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-1.5 text-xs text-white"
          />
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

      {loading ? (
        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-8 text-center text-sm text-slate-400">
          Chargement de l&apos;agenda projet...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <CascadeRulesPanel
            rules={rules}
            onAddRule={handleAddRule}
            onDeleteRule={handleDeleteRule}
          />
          <CascadeTimeline events={events} />
        </div>
      )}
    </div>
  );
}
