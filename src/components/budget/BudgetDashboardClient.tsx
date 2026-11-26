"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  PieChart,
  Receipt,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sparkles,
  Table2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BudgetTable } from "@/components/budget/BudgetTable";
import { CategoryChart } from "@/components/budget/CategoryChart";
import { InvoicePipelinePanel } from "@/components/budget/InvoicePipelinePanel";
import { QuotesPanel } from "@/components/budget/QuotesPanel";
import { BudgetTemplateEditor } from "@/components/templates/BudgetTemplateEditor";
import {
  type BudgetDataDto,
  type InvoiceDto,
  type QuoteDto,
  formatEur,
} from "@/components/budget/types";
import {
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_META,
  normalizeProjectCategory,
  type ProjectCategory,
} from "@/lib/templates/project-templates";
import { showToast } from "@/lib/toast";

const PROD_BUDGET_SHEET_ID = "1QUSOShHJmAlch3kP5F0RIf5txwyQ7Y6wf20A0jgCtMw";

interface ShellStatusResponse {
  activeProjectId: string | null;
  activeProject: {
    id: string;
    codeProjet: string;
    client: string;
    nomJeu: string;
    category?: string;
    isSandbox: boolean;
  } | null;
}

type BudgetTab = "overview" | "table" | "quotes" | "invoices" | "template";

export function BudgetDashboardClient() {
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("projectId");
  const queryTab = searchParams.get("tab");
  const queryOverruns = searchParams.get("overruns") === "1";

  const [projectId, setProjectId] = useState<string | null>(queryProjectId);
  const [projectLabel, setProjectLabel] = useState<string>("");
  const [projectCode, setProjectCode] = useState<string>("000000");
  const [projectCategory, setProjectCategory] = useState<ProjectCategory>("JEU");
  const [budget, setBudget] = useState<BudgetDataDto | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [quotes, setQuotes] = useState<QuoteDto[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [setupRequiredMessage, setSetupRequiredMessage] = useState<
    string | null
  >(null);
  const [cpConflictAlert, setCpConflictAlert] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<BudgetTab>(
    queryTab === "invoices"
      ? "invoices"
      : queryTab === "quotes"
        ? "quotes"
        : queryTab === "template"
          ? "template"
          : queryTab === "table" || queryOverruns
            ? "table"
            : "overview"
  );
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [overrunsOnly, setOverrunsOnly] = useState(queryOverruns);
  const autoOpenedBlankTableRef = useRef<string | null>(null);

  const prevTargetIdRef = useRef<string | null>(queryProjectId);
  const querySyncKey = `${queryTab ?? ""}|${queryOverruns ? "1" : "0"}`;
  const [lastQuerySyncKey, setLastQuerySyncKey] = useState(querySyncKey);
  if (lastQuerySyncKey !== querySyncKey) {
    setLastQuerySyncKey(querySyncKey);
    if (queryTab === "invoices") {
      setActiveTab("invoices");
    } else if (queryTab === "quotes") {
      setActiveTab("quotes");
    } else if (queryTab === "template") {
      setActiveTab("template");
    } else if (queryTab === "table" || queryOverruns) {
      setActiveTab("table");
      if (queryOverruns) setOverrunsOnly(true);
    }
  }

  const loadData = useCallback(async () => {
    try {
      let targetId = queryProjectId;
      let label = "";

      const shellRes = await fetch("/api/shell/status", { cache: "no-store" });
      if (shellRes.ok) {
        const shell = (await shellRes.json()) as ShellStatusResponse;
        if (!targetId) targetId = shell.activeProjectId;
        if (shell.activeProject && shell.activeProject.id === targetId) {
          label = `${shell.activeProject.client} — ${shell.activeProject.nomJeu} (CP ${shell.activeProject.codeProjet})`;
          setProjectCode(shell.activeProject.codeProjet);
          setProjectCategory(
            normalizeProjectCategory(shell.activeProject.category)
          );
        }
      }

      const normalizedTargetId = targetId ?? null;
      if (prevTargetIdRef.current !== normalizedTargetId) {
        prevTargetIdRef.current = normalizedTargetId;
        setWarnings([]);
        setCpConflictAlert(null);
        setSetupRequiredMessage(null);
        setActionError(null);
        setSelectedCategory(null);
        setOverrunsOnly(false);
      }

      if (!targetId) {
        setProjectId(null);
        setBudget(null);
        setInvoices([]);
        return;
      }

      setProjectId(targetId);
      setProjectLabel(label);

      const [budgetRes, invoicesRes, quotesRes] = await Promise.all([
        fetch(`/api/projects/${targetId}/budget`, { cache: "no-store" }),
        fetch(`/api/projects/${targetId}/invoices`, { cache: "no-store" }),
        fetch(`/api/projects/${targetId}/quotes`, { cache: "no-store" }),
      ]);

      if (budgetRes.ok) {
        const bData = (await budgetRes.json()) as BudgetDataDto;
        setBudget(bData);
        if (bData.warnings && bData.warnings.length > 0) {
          setWarnings(bData.warnings);
        }
        // Smart UX: if a project has blank budget lines (all 0 €) and no tab was forced, open Table directly
        if (
          !queryTab &&
          !queryOverruns &&
          autoOpenedBlankTableRef.current !== targetId &&
          bData.lines.length > 0 &&
          bData.summary.soldTotalHt === 0 &&
          bData.summary.preOpTotalHt === 0 &&
          bData.summary.postOpTotalHt === 0
        ) {
          autoOpenedBlankTableRef.current = targetId;
          setActiveTab("table");
        }
      }

      if (invoicesRes.ok) {
        const iData = (await invoicesRes.json()) as { invoices: InvoiceDto[] };
        setInvoices(iData.invoices ?? []);
      }

      if (quotesRes.ok) {
        const qData = (await quotesRes.json()) as { quotes: QuoteDto[] };
        setQuotes(qData.quotes ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [queryProjectId, queryTab, queryOverruns]);

  useEffect(() => {
    void loadData();
    const handler = () => void loadData();
    window.addEventListener("go:shell-refresh", handler);
    return () => window.removeEventListener("go:shell-refresh", handler);
  }, [loadData]);

  function handleApiError(
    status: number,
    payload: { error?: string; code?: string }
  ) {
    if (status === 412) {
      setSetupRequiredMessage(
        payload.error ??
          "Connectez Google Workspace et votre clé IA dans Paramètres."
      );
      return;
    }
    setActionError(payload.error ?? "Une erreur est survenue.");
  }

  async function handleXlsxUpload(file: File) {
    if (!projectId) return;
    setImporting(true);
    setImportMenuOpen(false);
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
      showToast("Budget Excel importé avec succès.");
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setImporting(false);
    }
  }

  async function handleCopyProdBudget() {
    if (!projectId) return;
    setImporting(true);
    setImportMenuOpen(false);
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
      showToast("Budget modèle copié et prêt à l'emploi.");
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setImporting(false);
    }
  }

  async function handleApplyBlankCategoryTemplate(
    cat: ProjectCategory,
    replaceExisting = true
  ) {
    if (!projectId) return;
    setImporting(true);
    setImportMenuOpen(false);
    setActionError(null);
    setSetupRequiredMessage(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "apply_blank_template",
          category: cat,
          replaceExisting,
        }),
      });
      const json = (await res.json()) as BudgetDataDto & {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        handleApiError(res.status, json);
        return;
      }
      setProjectCategory(cat);
      setBudget(json);
      setActiveTab("table");
      showToast(
        `Modèle budget vierge « ${PROJECT_CATEGORY_META[cat].label} » appliqué (montants à 0 €).`
      );
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setImporting(false);
    }
  }

  async function handleSmartSync(
    forceDirection: "auto" | "pull" | "push" = "auto"
  ) {
    if (!projectId) return;
    setSyncing(true);
    setImportMenuOpen(false);
    setActionError(null);
    setSetupRequiredMessage(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/budget/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "smart_sync", forceDirection }),
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
      showToast(
        json.syncResult?.reason ?? "Budget synchronisé avec Google Sheets."
      );
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setSyncing(false);
    }
  }

  const overrunAlerts = useMemo(() => {
    const raw = budget?.alerts ?? [];
    return raw
      .filter((a) => a.postOpTotalHt > a.preOpTotalHt)
      .map((a) => ({
        ...a,
        overrunAmount:
          Math.round((a.postOpTotalHt - a.preOpTotalHt) * 100) / 100,
      }))
      .sort((a, b) => b.overrunAmount - a.overrunAmount);
  }, [budget?.alerts]);

  const warning90Alerts = useMemo(() => {
    const raw = budget?.alerts ?? [];
    return raw.filter(
      (a) => a.level === "WARNING" && a.postOpTotalHt < a.preOpTotalHt
    );
  }, [budget?.alerts]);

  const totalOverrunHt = useMemo(
    () => overrunAlerts.reduce((s, a) => s + a.overrunAmount, 0),
    [overrunAlerts]
  );

  const pendingInvoicesCount = invoices.filter(
    (inv) => inv.status === "PENDING_VALIDATION"
  ).length;
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
      <div className="mx-auto max-w-6xl py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        Chargement de votre budget...
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200/80 bg-white p-10 text-center shadow-xs dark:border-slate-800 dark:bg-[#111827]">
        <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-rose-600" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">
          Aucun projet sélectionné
        </h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          Ouvrez ou créez un projet pour suivre son budget et ses factures.
        </p>
        <Link
          href="/projects"
          className="mt-5 inline-flex items-center rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700"
        >
          Voir mes projets
        </Link>
      </div>
    );
  }

  const summary = budget?.summary;
  const alerts = budget?.alerts ?? [];
  const consumedPct =
    summary && summary.preOpTotalHt > 0
      ? Math.round((summary.postOpTotalHt / summary.preOpTotalHt) * 1000) / 10
      : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Budget
            </h1>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PROJECT_CATEGORY_META[projectCategory].badgeClass}`}
            >
              {PROJECT_CATEGORY_META[projectCategory].label}
            </span>
            {overrunAlerts.length === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Dans le budget
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setOverrunsOnly(true);
                  setSelectedCategory(null);
                  setActiveTab("table");
                }}
                className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-600/20 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {overrunAlerts.length} dépassement
                {overrunAlerts.length > 1 ? "s" : ""} (+
                {formatEur(totalOverrunHt)})
              </button>
            )}
          </div>
          {projectLabel && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {projectLabel}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncing || importing}
            onClick={() => void handleSmartSync("auto")}
            data-testid="budget-smart-sync-btn"
            title="Synchronisation bidirectionnelle automatique : détecte si le site ou le Google Sheet a les modifications les plus récentes"
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50 ${
              budget?.syncMeta?.hasPendingLocalChanges
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 ${
                syncing ? "animate-spin" : ""
              }`}
            />
            <span>{syncing ? "Synchro..." : "Synchroniser"}</span>
            {budget?.syncMeta?.hasPendingLocalChanges && !syncing && (
              <span
                className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400"
                aria-label="Modifications locales à synchroniser"
              />
            )}
          </button>

          {budget?.budgetSheetId && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${budget.budgetSheetId}/edit`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
            >
              <span>Ouvrir le Sheet</span>
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </a>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setImportMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FileSpreadsheet className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              {importing ? "Import..." : "Importer / Options"}
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {importMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setImportMenuOpen(false)}
                />
                <div className="absolute right-0 z-30 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                    <Upload className="h-4 w-4 text-slate-400" />
                    <span>Importer un fichier Excel (.xlsx)</span>
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
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Copy className="h-4 w-4 text-slate-400" />
                    <span>Importer le budget modèle</span>
                  </button>
                  <div className="my-1 border-t border-slate-100 pt-1 dark:border-slate-800">
                    <button
                      type="button"
                      disabled={syncing || !budget?.budgetSheetId}
                      onClick={() => void handleSmartSync("pull")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
                      <span>Forcer : Google Sheets → Site</span>
                    </button>
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => void handleSmartSync("push")}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-indigo-500" />
                      <span>Forcer : Site → Google Sheets</span>
                    </button>
                  </div>
                  <div className="my-1.5 border-t border-slate-100 pt-1.5 dark:border-slate-800">
                    <p className="px-3 py-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      Modèle vierge (0 €) par catégorie
                    </p>
                    {PROJECT_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        disabled={importing}
                        onClick={() => void handleApplyBlankCategoryTemplate(cat)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <span className="flex items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                          {PROJECT_CATEGORY_META[cat].label}
                        </span>
                        {cat === projectCategory && (
                          <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                            Actuel
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setActiveTab("invoices")}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
          >
            <Receipt className="h-4 w-4" />
            Ajouter une facture
          </button>
        </div>
      </div>

      {/* Banners */}
      {setupRequiredMessage && (
        <div
          role="alert"
          data-testid="setup-required-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-3.5 text-xs text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-200"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
            <span>{setupRequiredMessage}</span>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700"
          >
            <Settings className="h-3.5 w-3.5" />
            Paramètres
          </Link>
        </div>
      )}

      {hasCpConflict && (
        <div
          role="alert"
          data-testid="cp-conflict-banner"
          className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-xs text-rose-900 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div>
            <p className="font-semibold">
              Facture bloquée : numéro de projet différent
            </p>
            <p className="mt-0.5 text-rose-700 dark:text-rose-300">
              {cpConflictAlert ??
                `${blockedInvoices.length} facture(s) bloquée(s) (${conflictingCpsDisplay || "autre projet"}).`}
            </p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
          {warnings.map((w, idx) => (
            <p key={idx}>• {w}</p>
          ))}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {actionError}
        </div>
      )}

      {/* Radar Factures Manquantes (FNP — Devis acceptés non soldés) */}
      {budget?.fnpAlerts && budget.fnpAlerts.length > 0 && (
        <div
          data-testid="fnp-radar-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-5 py-3.5 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">
                Radar Factures à recevoir (FNP) : {budget.fnpAlerts.length} devis
                accepté(s) avec{" "}
                <span className="font-mono font-bold">
                  {formatEur(
                    budget.fnpAlerts.reduce((s, a) => s + a.remainingHt, 0)
                  )}{" "}
                  HT
                </span>{" "}
                non facturés
              </p>
              <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-200">
                {budget.fnpAlerts
                  .slice(0, 3)
                  .map(
                    (a) => `${a.vendorName} (${a.quoteNumber} : reste ${formatEur(a.remainingHt)})`
                  )
                  .join(" · ")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("quotes")}
              className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-slate-900 dark:text-amber-200"
            >
              Voir les devis
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("invoices")}
              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
            >
              Déposer une facture
            </button>
          </div>
        </div>
      )}

      {/* Unified Pennylane / Stripe Financial Strip (1 sleek card instead of 4 competing boxes) */}
      {summary && (
        <section className="grid divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827] sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <div className="p-5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Prix de vente HT
            </p>
            <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatEur(summary.soldTotalHt)}
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Marge brute {summary.grossMarginPct.toFixed(1)}%
            </p>
          </div>

          <div className="p-5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Coût réel pré-op
            </p>
            <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatEur(summary.preOpTotalHt)}
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Ext {formatEur(summary.preOpExternalHt)} · Int{" "}
              {formatEur(summary.preOpRhHt)}
              {summary.preOpAmortHt > 0
                ? ` · Amort ${formatEur(summary.preOpAmortHt)}`
                : ""}
            </p>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Coût réel post-op
              </p>
              <span
                className={`font-mono text-xs font-bold ${
                  consumedPct > 100
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-indigo-600 dark:text-indigo-400"
                }`}
              >
                {consumedPct.toFixed(0)}%
              </span>
            </div>
            <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatEur(summary.postOpTotalHt)}
            </p>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                style={{ width: `${Math.min(100, consumedPct)}%` }}
                className={`h-full rounded-full ${
                  consumedPct > 100
                    ? "bg-rose-600"
                    : "bg-indigo-600 dark:bg-indigo-500"
                }`}
              />
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Marge à terminaison
              </p>
              {(() => {
                const fcPct =
                  summary.forecastMarginPct ?? summary.plannedMarginPct;
                const deltaFc = fcPct - summary.plannedMarginPct;
                return (
                  <span
                    className={`font-mono text-[11px] font-semibold ${
                      deltaFc >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {deltaFc >= 0 ? "+" : ""}
                    {deltaFc.toFixed(1)} pts
                  </span>
                );
              })()}
            </div>
            <p
              className={`mt-1.5 font-mono text-2xl font-bold tracking-tight ${
                (summary.forecastMarginHt ?? summary.plannedMarginHt) >= 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {(summary.forecastMarginPct ?? summary.plannedMarginPct).toFixed(1)}%
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">
              {formatEur(summary.forecastMarginHt ?? summary.plannedMarginHt)}{" "}
              (prévu {summary.plannedMarginPct.toFixed(1)}%)
            </p>
          </div>
        </section>
      )}

      {/* Unified Underline Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "overview"
                ? "border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <PieChart className="h-3.5 w-3.5" />
            Synthèse
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("table")}
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "table"
                ? "border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            Tableau ({budget?.lines.length ?? 0})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("quotes")}
            data-testid="budget-tab-quotes"
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "quotes"
                ? "border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Devis ({quotes.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("invoices")}
            className={`inline-flex items-center gap-2 border-b-2 pb-3 text-xs font-semibold transition-colors ${
              activeTab === "invoices"
                ? "border-indigo-600 text-slate-900 dark:border-indigo-400 dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            Factures ({invoices.length})
            {pendingInvoicesCount > 0 && (
              <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                {pendingInvoicesCount}
              </span>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab("template")}
          data-testid="budget-tab-template"
          className={`inline-flex items-center gap-1.5 border-b-2 pb-3 text-xs font-semibold transition-colors ${
            activeTab === "template"
              ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
          Modèle vierge
        </button>
      </div>

      {/* TAB 1: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-5">
          {overrunAlerts.length > 0 && (
            <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 dark:border-rose-500/30 dark:bg-rose-950/20">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  <h2 className="text-sm font-semibold text-rose-950 dark:text-rose-200">
                    Postes en dépassement ({overrunAlerts.length})
                  </h2>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 font-mono text-xs font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                    +{formatEur(totalOverrunHt)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOverrunsOnly(true);
                    setSelectedCategory(null);
                    setActiveTab("table");
                  }}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-900 dark:text-rose-300"
                >
                  Ouvrir dans le tableau →
                </button>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {overrunAlerts.map((alert) => (
                  <button
                    key={alert.budgetLineId}
                    type="button"
                    data-testid="budget-alert-badge"
                    onClick={() => {
                      setSelectedCategory(alert.category);
                      setOverrunsOnly(true);
                      setActiveTab("table");
                    }}
                    className="flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-xl border border-rose-200/80 bg-white px-3.5 py-2.5 text-left shadow-2xs transition-colors hover:border-rose-300 dark:border-rose-500/30 dark:bg-[#111827]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                        {alert.objet}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {alert.category} ·{" "}
                        {alert.unbudgeted
                          ? "Hors budget"
                          : `${formatEur(alert.preOpTotalHt)} → ${formatEur(alert.postOpTotalHt)}`}
                      </p>
                    </div>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs font-bold text-rose-600 dark:text-rose-400">
                      +{formatEur(alert.overrunAmount)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {warning90Alerts.length > 0 && (
            <section className="rounded-2xl border border-amber-200/90 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  Vigilance budget (≥ 90% consommé) —{" "}
                  {warning90Alerts.length} poste
                  {warning90Alerts.length > 1 ? "s" : ""} proche
                  {warning90Alerts.length > 1 ? "s" : ""} du plafond
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOverrunsOnly(false);
                    setActiveTab("table");
                  }}
                  className="text-xs font-semibold text-amber-800 hover:underline dark:text-amber-300"
                >
                  Voir dans le tableau →
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {warning90Alerts.map((w) => (
                  <button
                    key={w.budgetLineId}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(w.category);
                      setOverrunsOnly(false);
                      setActiveTab("table");
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-amber-400 dark:border-amber-500/30 dark:bg-[#111827] dark:text-slate-200"
                  >
                    <span className="max-w-[180px] truncate font-medium">
                      {w.objet}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400">
                      {w.ratioPct.toFixed(0)}%
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(budget?.lines.length ?? 0) === 0 ? (
            <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-[#111827]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                Démarrez votre suivi budgétaire en 1 clic
              </h2>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                Importez votre fichier Excel existant ou copiez directement le
                modèle agence pour afficher les graphiques et le suivi de marge.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-rose-700">
                  <Upload className="h-4 w-4" />
                  <span>{importing ? "Import..." : "Importer un Excel (.xlsx)"}</span>
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
                  onClick={() =>
                    void handleApplyBlankCategoryTemplate(projectCategory)
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  Modèle vierge ({PROJECT_CATEGORY_META[projectCategory].label})
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => void handleCopyProdBudget()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Copy className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  Utiliser le budget modèle Sheet
                </button>
              </div>
            </section>
          ) : (
            <CategoryChart
              categories={budget?.categories ?? []}
              summary={summary}
              selectedCategory={selectedCategory}
              onSelectCategory={(cat) => {
                setSelectedCategory(cat);
                setOverrunsOnly(false);
                if (cat) setActiveTab("table");
              }}
            />
          )}
        </div>
      )}

      {/* TAB 2: Spreadsheet */}
      {activeTab === "table" && (
        <BudgetTable
          key={`budget-table-${projectId}`}
          projectId={projectId}
          lines={budget?.lines ?? []}
          invoices={invoices}
          quotes={quotes}
          alerts={alerts}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          overrunsOnly={overrunsOnly}
          onToggleOverrunsOnly={setOverrunsOnly}
          onLineSaved={loadData}
          onError={handleApiError}
        />
      )}

      {/* TAB 3: Quotes (Devis) */}
      {activeTab === "quotes" && (
        <QuotesPanel
          key={`quotes-panel-${projectId}`}
          projectId={projectId}
          quotes={quotes}
          invoices={invoices}
          budgetLines={budget?.lines ?? []}
          onRefresh={loadData}
          onError={handleApiError}
        />
      )}

      {/* TAB 4: Invoices */}
      {activeTab === "invoices" && (
        <InvoicePipelinePanel
          key={`invoices-panel-${projectId}`}
          projectId={projectId}
          projectCode={projectCode}
          budgetLines={budget?.lines ?? []}
          invoices={invoices}
          quotes={quotes}
          onRefresh={loadData}
          onError={handleApiError}
          onCpConflictDetected={(msg, cps) => {
            setCpConflictAlert(
              cps && cps.length > 0 ? `${msg} (CP: ${cps.join(", ")})` : msg
            );
          }}
        />
      )}

      {/* TAB 5: Blank Budget Template Editor */}
      {activeTab === "template" && (
        <BudgetTemplateEditor
          initialCategory={projectCategory}
          projectHasLines={(budget?.lines.length ?? 0) > 0}
          applying={importing}
          onApply={async (cat, { replaceExisting }) => {
            await handleApplyBlankCategoryTemplate(cat, replaceExisting);
          }}
        />
      )}
    </div>
  );
}
