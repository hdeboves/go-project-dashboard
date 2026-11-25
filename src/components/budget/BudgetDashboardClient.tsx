"use client";

import {
  AlertTriangle,
  Copy,
  FileSpreadsheet,
  RefreshCw,
  Settings,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BudgetTable } from "@/components/budget/BudgetTable";
import { CategoryChart } from "@/components/budget/CategoryChart";
import { InvoicePipelinePanel } from "@/components/budget/InvoicePipelinePanel";
import {
  type BudgetDataDto,
  type InvoiceDto,
  formatEur,
} from "@/components/budget/types";

const PROD_BUDGET_SHEET_ID = "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw";

interface ShellStatusResponse {
  activeProjectId: string | null;
  activeProject: {
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
    isSandbox: boolean;
  } | null;
}

export function BudgetDashboardClient() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");

  const [projectId, setProjectId] = useState<string | null>(queryProjectId);
  const [projectLabel, setProjectLabel] = useState<string>("");
  const [budget, setBudget] = useState<BudgetDataDto | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [setupRequiredMessage, setSetupRequiredMessage] = useState<
    string | null
  >(null);
  const [cpConflictAlert, setCpConflictAlert] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      let targetId = queryProjectId;
      let label = "";

      const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
      if (shellRes.ok) {
        const shell = (await shellRes.json()) as ShellStatusResponse;
        if (!targetId) {
          targetId = shell.activeProjectId;
        }
        if (shell.activeProject && shell.activeProject.id === targetId) {
          label = `CP ${shell.activeProject.codeProjet} | ${shell.activeProject.client} — ${shell.activeProject.nomJeu}`;
        }
      }

      if (!targetId) {
        setProjectId(null);
        setBudget(null);
        setInvoices([]);
        return;
      }

      setProjectId(targetId);
      setProjectLabel(label);

      const [budgetRes, invoicesRes] = await Promise.all([
        fetch(`/api/projects/${targetId}/budget`, { cache: "no-store" }),
        fetch(`/api/projects/${targetId}/invoices`, { cache: "no-store" }),
      ]);

      if (budgetRes.ok) {
        const bData = (await budgetRes.json()) as BudgetDataDto;
        setBudget(bData);
        if (bData.warnings && bData.warnings.length > 0) {
          setWarnings(bData.warnings);
        }
      }

      if (invoicesRes.ok) {
        const iData = (await invoicesRes.json()) as { invoices: InvoiceDto[] };
        setInvoices(iData.invoices ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [queryProjectId]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        let targetId = queryProjectId;
        let label = "";

        const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
        if (!active) return;
        if (shellRes.ok) {
          const shell = (await shellRes.json()) as ShellStatusResponse;
          if (!targetId) {
            targetId = shell.activeProjectId;
          }
          if (shell.activeProject && shell.activeProject.id === targetId) {
            label = `CP ${shell.activeProject.codeProjet} | ${shell.activeProject.client} — ${shell.activeProject.nomJeu}`;
          }
        }

        if (!targetId) {
          if (active) {
            setProjectId(null);
            setBudget(null);
            setInvoices([]);
          }
          return;
        }

        if (active) {
          setProjectId(targetId);
          setProjectLabel(label);
        }

        const [budgetRes, invoicesRes] = await Promise.all([
          fetch(`/api/projects/${targetId}/budget`, { cache: "no-store" }),
          fetch(`/api/projects/${targetId}/invoices`, { cache: "no-store" }),
        ]);

        if (!active) return;

        if (budgetRes.ok) {
          const bData = (await budgetRes.json()) as BudgetDataDto;
          setBudget(bData);
          if (bData.warnings && bData.warnings.length > 0) {
            setWarnings(bData.warnings);
          }
        }

        if (invoicesRes.ok) {
          const iData = (await invoicesRes.json()) as {
            invoices: InvoiceDto[];
          };
          setInvoices(iData.invoices ?? []);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();

    const handler = () => {
      void loadData();
    };
    window.addEventListener("go:shell-refresh", handler);
    return () => {
      active = false;
      window.removeEventListener("go:shell-refresh", handler);
    };
  }, [loadData, queryProjectId]);

  function handleApiError(
    status: number,
    payload: { error?: string; code?: string }
  ) {
    if (status === 412) {
      setSetupRequiredMessage(
        payload.error ??
          "Configuration Google Workspace OAuth2 ou clé API Gemini requise dans Paramètres."
      );
      return;
    }
    setActionError(payload.error ?? "Une erreur est survenue.");
  }

  async function handleXlsxUpload(file: File) {
    if (!projectId) return;
    setImporting(true);
    setActionError(null);
    setSetupRequiredMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/budget/import`, {
        method: "POST",
        body: formData,
      });
      const json = (await res.json()) as BudgetDataDto & {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      setWarnings(json.warnings ?? []);
      setBudget(json);
      await loadData();
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setImporting(false);
    }
  }

  async function handleCopyProdBudget() {
    if (!projectId) return;
    setImporting(true);
    setActionError(null);
    setSetupRequiredMessage(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSheetId: PROD_BUDGET_SHEET_ID }),
      });
      const json = (await res.json()) as BudgetDataDto & {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      setWarnings(json.warnings ?? []);
      setBudget(json);
      await loadData();
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setImporting(false);
    }
  }

  async function handleSyncFromSheet() {
    if (!projectId) return;
    setSyncing(true);
    setActionError(null);
    setSetupRequiredMessage(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "sync_from_sheet" }),
      });
      const json = (await res.json()) as BudgetDataDto & {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      setWarnings(json.warnings ?? []);
      setBudget(json);
      await loadData();
    } finally {
      setSyncing(false);
    }
  }

  const blockedInvoices = invoices.filter(
    (inv) => inv.cpConflict || inv.status === "CONFLICT_BLOCKED"
  );
  const hasCpConflict = blockedInvoices.length > 0 || Boolean(cpConflictAlert);
  const conflictingCpsDisplay = Array.from(
    new Set(
      blockedInvoices
        .map((i) => i.detectedCodeProjet)
        .filter((cp): cp is string => Boolean(cp))
    )
  ).join(", ");

  if (loading && !budget) {
    return (
      <div className="mx-auto max-w-7xl py-12 text-center text-sm text-slate-400">
        Chargement du module Budget & Factures...
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-[#232b3d] bg-[#11151f] p-8 text-center">
        <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-[#ff2e58]" />
        <h1 className="text-lg font-bold text-white">
          Aucun projet actif sélectionné
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Créez ou sélectionnez le projet pilote bac à sable pour gérer son
          budget 3-blocs et ses factures.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center rounded-lg bg-[#e11d48] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff2e58]"
        >
          Aller vers Projets & Pilote
        </Link>
      </div>
    );
  }

  const summary = budget?.summary;
  const alerts = budget?.alerts ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header & Import Controls */}
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#ff2e58]" />
            <h1 className="text-xl font-bold text-white">
              Budget 3-Blocs & Pipeline Factures
            </h1>
            <span className="rounded bg-[#171d2b] px-2 py-0.5 font-mono text-[11px] text-cyan-300 ring-1 ring-[#232b3d]">
              Jalon 1 · M2
            </span>
          </div>
          {projectLabel && (
            <p className="mt-1 font-mono text-xs text-slate-400">
              {projectLabel}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-500/60 hover:text-white">
            <FileSpreadsheet className="h-4 w-4 text-cyan-400" />
            <span>{importing ? "Import..." : "Importer .xlsx"}</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleXlsxUpload(file);
                  e.target.value = "";
                }
              }}
            />
          </label>

          <button
            type="button"
            disabled={importing}
            onClick={() => void handleCopyProdBudget()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#ff2e58] disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            Copier le Budget PROD (001.1)
          </button>

          <button
            type="button"
            disabled={syncing || !budget?.budgetSheetId}
            onClick={() => void handleSyncFromSheet()}
            className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-500/50 hover:text-white disabled:opacity-40"
          >
            <RefreshCw
              className={`h-4 w-4 text-cyan-400 ${syncing ? "animate-spin" : ""}`}
            />
            Synchroniser depuis Sheet
          </button>
        </div>
      </header>

      {/* Setup Required Banner (412) */}
      {setupRequiredMessage && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/60 bg-amber-950/60 px-5 py-3.5 text-sm text-amber-100"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <span>{setupRequiredMessage}</span>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-900/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
          >
            <Settings className="h-3.5 w-3.5" />
            Configurer dans Paramètres
          </Link>
        </div>
      )}

      {/* CP Conflict Red Alert Banner */}
      {hasCpConflict && (
        <div
          role="alert"
          data-testid="cp-conflict-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500 bg-red-950/70 px-5 py-3.5 text-sm text-red-100"
        >
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 shrink-0 text-red-400" />
            <div>
              <p className="font-bold">
                ALERTE ISOLATION CODE PROJET — Injection bloquée
              </p>
              <p className="text-xs text-red-200">
                {cpConflictAlert ??
                  `${blockedInvoices.length} facture(s) bloquée(s) (${conflictingCpsDisplay || "CP étranger"}). Aucun fichier Drive, ligne Sheet ou brouillon Pennylane n'a été généré.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Non-fatal Sheet/Header Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          {warnings.map((w, idx) => (
            <p key={idx}>⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Action Error */}
      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/50 bg-red-950/40 px-4 py-3 text-xs text-red-200"
        >
          {actionError}
        </div>
      )}

      {/* KPI Strip */}
      {summary && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="Prix vendu HT"
            value={formatEur(summary.soldTotalHt)}
            sub="Bloc 1 · Prix de vente"
            accent="text-cyan-300"
          />
          <KpiCard
            label="Coûts réels pré-op"
            value={formatEur(summary.preOpTotalHt)}
            sub={`Ext ${formatEur(summary.preOpExternalHt)} · RH ${formatEur(summary.preOpRhHt)}`}
            accent="text-amber-300"
          />
          <KpiCard
            label="Coûts réels post-op"
            value={formatEur(summary.postOpTotalHt)}
            sub="Cumul factures validées"
            accent="text-rose-300"
          />
          <KpiCard
            label="Reste à engager"
            value={formatEur(summary.remainingToCommitHt)}
            sub="Pré-op − Post-op"
            accent="text-slate-100"
          />
          <KpiCard
            label="Marge prévue"
            value={`${formatEur(summary.plannedMarginHt)} (${summary.plannedMarginPct.toFixed(1)}%)`}
            sub={`Brute : ${formatEur(summary.grossMarginHt)} (${summary.grossMarginPct.toFixed(1)}%)`}
            accent={
              summary.plannedMarginHt >= 0
                ? "text-emerald-300"
                : "text-red-300"
            }
          />
          <KpiCard
            label="Marge réelle"
            value={`${formatEur(summary.realMarginHt)} (${summary.realMarginPct.toFixed(1)}%)`}
            sub="Vendu HT − Post-op"
            accent={
              summary.realMarginHt >= 0 ? "text-emerald-300" : "text-red-300"
            }
          />
        </section>
      )}

      {/* 85% / 100% Budget Threshold Alerts */}
      {alerts.length > 0 && (
        <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-4">
          <div className="mb-2.5 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">
              Alertes Seuils Budgétaires (85% / 100%)
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {alerts.map((alert) => (
              <div
                key={alert.budgetLineId}
                data-testid="budget-alert-badge"
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                  alert.level === "CRITICAL"
                    ? "border-red-500/60 bg-red-950/60 text-red-200"
                    : "border-amber-500/60 bg-amber-950/50 text-amber-200"
                }`}
              >
                <span className="font-mono font-bold">
                  {alert.thresholdPct}%
                </span>
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Category Breakdown Chart */}
      <CategoryChart categories={budget?.categories ?? []} />

      {/* 3-Block Budget Table */}
      <BudgetTable
        projectId={projectId}
        lines={budget?.lines ?? []}
        alerts={alerts}
        onLineSaved={loadData}
        onError={handleApiError}
      />

      {/* Invoice Ingestion & 1-Click Validation Queue */}
      <InvoicePipelinePanel
        projectId={projectId}
        budgetLines={budget?.lines ?? []}
        invoices={invoices}
        onRefresh={loadData}
        onError={handleApiError}
        onCpConflictDetected={(msg, cps) => {
          setCpConflictAlert(
            cps && cps.length > 0 ? `${msg} (CP: ${cps.join(", ")})` : msg
          );
        }}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`mt-1.5 font-mono text-base font-bold ${accent}`}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}
