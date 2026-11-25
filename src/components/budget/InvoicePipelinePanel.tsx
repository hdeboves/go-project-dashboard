"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Mail,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import {
  type BudgetLineDto,
  type InvoiceDto,
  type QuoteDto,
  formatEur,
} from "@/components/budget/types";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";
import { showToast } from "@/lib/toast";

interface InvoicePipelinePanelProps {
  projectId: string;
  projectCode?: string;
  budgetLines: BudgetLineDto[];
  invoices: InvoiceDto[];
  quotes?: QuoteDto[];
  onRefresh: () => Promise<void>;
  onError: (status: number, payload: { error?: string; code?: string }) => void;
  onCpConflictDetected: (message: string, detectedCps?: string[]) => void;
}

interface DraftEdits {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountHt: string;
  prestationLabel: string;
  budgetLineId: string;
  quoteId: string;
}

export function InvoicePipelinePanel({
  projectId,
  projectCode = "000000",
  budgetLines,
  invoices,
  quotes = [],
  onRefresh,
  onError,
  onCpConflictDetected,
}: InvoicePipelinePanelProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [scanningGmail, setScanningGmail] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "PENDING" | "BLOCKED" | "VALIDATED" | "ALL"
  >("PENDING");
  const [dragOver, setDragOver] = useState(false);
  const [openPdfIds, setOpenPdfIds] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [editsById, setEditsById] = useState<Record<string, DraftEdits>>({});

  const firstPendingId =
    invoices.find((i) => i.status === "PENDING_VALIDATION" && !i.cpConflict)
      ?.id ?? null;

  function isPdfOpen(inv: InvoiceDto): boolean {
    if (inv.id in openPdfIds) return openPdfIds[inv.id];
    // Pennylane UX: auto-open ONLY the first pending invoice (prevents loading 20 PDFs at once)
    return inv.id === firstPendingId;
  }

  function togglePdf(inv: InvoiceDto) {
    setOpenPdfIds((prev) => ({
      ...prev,
      [inv.id]: !isPdfOpen(inv),
    }));
  }

  function getEdits(inv: InvoiceDto): DraftEdits {
    const existing = editsById[inv.id];
    if (existing) return existing;
    return {
      vendorName: inv.vendorName ?? "",
      invoiceNumber: inv.invoiceNumber ?? "",
      invoiceDate: inv.invoiceDate ?? new Date().toISOString().slice(0, 10),
      amountHt: String(inv.amountHt ?? 0),
      prestationLabel: inv.prestationLabel ?? "",
      budgetLineId: inv.budgetLineId ?? "",
      quoteId: inv.quoteId ?? "",
    };
  }

  function updateEdit(inv: InvoiceDto, field: keyof DraftEdits, value: string) {
    const cur = getEdits(inv);
    setEditsById((prev) => ({
      ...prev,
      [inv.id]: { ...cur, [field]: value },
    }));
  }

  async function uploadPdfFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (files.length === 0) return;
    setUploading(true);
    setFeedback(null);
    let okCount = 0;
    let conflictCount = 0;
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (files.length > 1) {
          setUploadProgress(`Lecture ${i + 1}/${files.length} : ${file.name}`);
        }
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/projects/${projectId}/invoices`, {
          method: "POST",
          body: formData,
        });
        const json = (await res.json()) as {
          error?: string;
          code?: string;
          detectedCps?: string[];
          isDuplicate?: boolean;
          invoice?: InvoiceDto;
        };

        if (res.status === 409 && json.code === "CP_CONFLICT") {
          conflictCount += 1;
          onCpConflictDetected(
            json.error ?? "Cette facture appartient à un autre projet.",
            json.detectedCps
          );
          continue;
        }
        if (!res.ok) {
          onError(res.status, json);
          setFeedback({
            type: "error",
            text: json.error ?? `Erreur sur ${file.name}.`,
          });
          continue;
        }
        okCount += 1;
      }

      if (okCount > 0 || conflictCount > 0) {
        const msg =
          files.length === 1 && okCount === 1
            ? "Facture PDF lue ! Vérifiez les champs puis cliquez sur Valider."
            : `${okCount} facture(s) lue(s)${conflictCount > 0 ? ` · ${conflictCount} bloquée(s) (autre CP)` : ""}.`;
        setFeedback({
          type: conflictCount > 0 && okCount === 0 ? "error" : "success",
          text: msg,
        });
        showToast(msg, conflictCount > 0 && okCount === 0 ? "error" : "success");
        await onRefresh();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleDeleteInvoice(inv: InvoiceDto) {
    setDeletingId(inv.id);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/invoices/${inv.id}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Impossible de supprimer la facture.", "error");
        return;
      }
      showToast("Facture retirée de la file.");
      await onRefresh();
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleScanGmail() {
    setScanningGmail(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/invoices/scan-gmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        ingestedCount?: number;
        conflictCount?: number;
      };

      if (!res.ok) {
        onError(res.status, json);
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de rechercher dans Gmail.",
        });
        return;
      }

      if ((json.conflictCount ?? 0) > 0) {
        onCpConflictDetected(
          `${json.conflictCount} facture(s) bloquée(s) car elles concernent un autre projet.`
        );
      }

      const msg = `Recherche Gmail terminée : ${json.ingestedCount ?? 0} nouvelle(s) facture(s).`;
      setFeedback({ type: "success", text: msg });
      showToast(msg);
      await onRefresh();
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setScanningGmail(false);
    }
  }

  async function handleValidate(inv: InvoiceDto) {
    setValidatingId(inv.id);
    setFeedback(null);
    try {
      const edits = getEdits(inv);
      const res = await fetch(
        `/api/projects/${projectId}/invoices/${inv.id}/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendorName: edits.vendorName.trim() || undefined,
            invoiceNumber: edits.invoiceNumber.trim() || undefined,
            invoiceDate: edits.invoiceDate.trim() || undefined,
            amountHt: Number(edits.amountHt),
            prestationLabel: edits.prestationLabel.trim() || undefined,
            budgetLineId: edits.budgetLineId || undefined,
            quoteId: edits.quoteId || null,
          }),
        }
      );

      const json = (await res.json()) as {
        error?: string;
        code?: string;
      };

      if (!res.ok) {
        if (res.status === 409 && json.code === "CP_CONFLICT") {
          onCpConflictDetected(json.error ?? "Autre Code Projet détecté.");
        } else {
          onError(res.status, json);
        }
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de valider la facture.",
        });
        return;
      }

      const msg =
        "Facture validée : classée Drive, ajoutée au budget et brouillon Pennylane prêt.";
      setFeedback({ type: "success", text: msg });
      showToast(msg);
      await onRefresh();
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setValidatingId(null);
    }
  }

  return (
    <section className="space-y-5">
      {/* Pennylane-style Dropzone Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Ajouter une facture prestataire
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Déposez un PDF ou importez depuis Gmail — contrôlez la facture
              côte à côte avant validation Pennylane.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleScanGmail()}
            disabled={scanningGmail}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {scanningGmail ? (
              <RefreshCw className="h-4 w-4 animate-spin text-indigo-600 dark:text-indigo-400" />
            ) : (
              <Mail className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            )}
            Rechercher dans Gmail
          </button>
        </div>

        <label
          htmlFor="invoice-pdf-upload"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) {
              void uploadPdfFiles(e.dataTransfer.files);
            }
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragOver
              ? "border-rose-500 bg-rose-50/50 dark:bg-rose-500/15"
              : "border-slate-200 bg-slate-50/60 hover:border-indigo-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-slate-800/70"
          }`}
        >
          <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-rose-600 shadow-2xs ring-1 ring-slate-200/80 dark:bg-slate-900 dark:text-rose-400 dark:ring-slate-700">
            <Upload className="h-5 w-5" />
          </div>
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {uploading
              ? (uploadProgress ?? "Lecture des PDF en cours...")
              : "Glissez une ou plusieurs factures PDF ici ou cliquez pour choisir"}
          </span>
          <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Multi-upload PDF · Vérification côte à côte & brouillon Pennylane
          </span>
          <input
            id="invoice-pdf-upload"
            type="file"
            multiple
            accept=".pdf,application/pdf"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files?.length) {
                void uploadPdfFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </label>

        {feedback && (
          <div
            role="status"
            className={`mt-4 rounded-xl border px-4 py-3 text-xs ${
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
            }`}
          >
            {feedback.text}
          </div>
        )}
      </div>

      {/* Queue Filter Tabs & Pending Totals */}
      {invoices.length > 0 && (() => {
        const pendingList = invoices.filter(
          (i) => i.status === "PENDING_VALIDATION" && !i.cpConflict
        );
        const blockedList = invoices.filter(
          (i) => i.cpConflict || i.status === "CONFLICT_BLOCKED"
        );
        const validatedList = invoices.filter((i) => i.status === "VALIDATED");
        const pendingTotalHt = pendingList.reduce(
          (acc, i) => acc + (i.amountHt || 0),
          0
        );
        const effectiveFilter =
          statusFilter === "PENDING" && pendingList.length === 0
            ? blockedList.length > 0
              ? "BLOCKED"
              : validatedList.length > 0
                ? "ALL"
                : "PENDING"
            : statusFilter;

        return (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-[#111827]">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "PENDING", label: `À valider (${pendingList.length})` },
                  { id: "BLOCKED", label: `Bloquées (${blockedList.length})` },
                  { id: "VALIDATED", label: `Validées (${validatedList.length})` },
                  { id: "ALL", label: `Toutes (${invoices.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    effectiveFilter === tab.id
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                      : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {pendingList.length > 0 && (
              <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">
                En attente : {formatEur(pendingTotalHt)} HT
              </span>
            )}
          </div>
        );
      })()}

      {/* Invoice Cards with Side-by-Side Pennylane PDF Preview */}
      {invoices.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          Aucune facture enregistrée pour ce projet.
        </div>
      ) : (
        <div className="space-y-4">
          {invoices
            .filter((inv) => {
              const pendingCount = invoices.filter(
                (i) => i.status === "PENDING_VALIDATION" && !i.cpConflict
              ).length;
              const blockedCount = invoices.filter(
                (i) => i.cpConflict || i.status === "CONFLICT_BLOCKED"
              ).length;
              const validatedCount = invoices.filter(
                (i) => i.status === "VALIDATED"
              ).length;
              const active =
                statusFilter === "PENDING" && pendingCount === 0
                  ? blockedCount > 0
                    ? "BLOCKED"
                    : validatedCount > 0
                      ? "ALL"
                      : "PENDING"
                  : statusFilter;
              if (active === "ALL") return true;
              const blocked =
                inv.cpConflict || inv.status === "CONFLICT_BLOCKED";
              if (active === "BLOCKED") return blocked;
              if (active === "VALIDATED") return inv.status === "VALIDATED";
              return inv.status === "PENDING_VALIDATION" && !blocked;
            })
            .map((inv) => {
            const edits = getEdits(inv);
            const isBlocked =
              inv.cpConflict || inv.status === "CONFLICT_BLOCKED";
            const isValidated = inv.status === "VALIDATED";
            const showPdf = isPdfOpen(inv);
            const previewUrl = `/api/projects/${projectId}/invoices/${inv.id}/preview`;

            let rawWarnings: string[] = [];
            let isDuplicate = false;
            try {
              const parsed = JSON.parse(inv.extractedJson || "{}") as {
                rawWarnings?: string[];
                isDuplicate?: boolean;
              };
              rawWarnings = parsed.rawWarnings ?? [];
              isDuplicate = Boolean(parsed.isDuplicate);
            } catch {
              rawWarnings = [];
            }

            return (
              <div
                key={inv.id}
                data-testid={`invoice-card-${inv.id}`}
                className={`rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-[#111827] ${
                  isBlocked
                    ? "border-rose-300 bg-rose-50/30 dark:border-rose-500/40 dark:bg-rose-950/20"
                    : isValidated
                      ? "border-slate-200/80 dark:border-slate-800"
                      : "border-indigo-200 dark:border-indigo-500/40"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {inv.renamedFilename ?? inv.originalFilename}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        isBlocked
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                          : isValidated
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/20 dark:bg-indigo-500/15 dark:text-indigo-300"
                      }`}
                    >
                      {isBlocked
                        ? "Autre projet (bloquée)"
                        : isValidated
                          ? "Validée"
                          : "À valider"}
                    </span>
                    {isDuplicate && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                        <AlertTriangle className="h-3 w-3" />
                        Doublon possible
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isValidated && (
                      <>
                        {inv.driveFileId && (
                          <a
                            href={`https://drive.google.com/file/d/${inv.driveFileId}/view`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300"
                          >
                            Drive
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {inv.pennylaneDraftId && (
                          <a
                            href="https://mail.google.com/mail/u/0/#drafts"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
                          >
                            Brouillon Pennylane
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {!inv.driveFileId && !inv.pennylaneDraftId && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Drive & Pennylane OK
                          </span>
                        )}
                      </>
                    )}
                    {!isValidated && (
                      <button
                        type="button"
                        disabled={deletingId === inv.id}
                        onClick={() => void handleDeleteInvoice(inv)}
                        title="Rejeter / retirer cette facture"
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Rejeter
                      </button>
                    )}
                    {!isBlocked && (
                      <button
                        type="button"
                        onClick={() => togglePdf(inv)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
                      >
                        {showPdf ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        )}
                        {showPdf ? "Masquer le PDF" : "Voir le PDF"}
                      </button>
                    )}
                  </div>
                </div>

                {isBlocked && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>
                      Cette facture mentionne un autre Code Projet (
                      {inv.detectedCodeProjet ?? "différent"}) et a été bloquée
                      par sécurité.
                    </span>
                  </div>
                )}

                {rawWarnings.length > 0 && (
                  <div className="mb-3 space-y-1 text-xs text-rose-700 dark:text-rose-300">
                    {rawWarnings.map((w, i) => (
                      <p key={i}>• {w}</p>
                    ))}
                  </div>
                )}

                {/* Pennylane Split View: PDF left + Fields right */}
                <div
                  className={
                    showPdf ? "grid gap-5 lg:grid-cols-12" : "space-y-3"
                  }
                >
                  {showPdf && (
                    <div
                      data-testid={`invoice-pdf-preview-${inv.id}`}
                      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900 lg:col-span-5"
                    >
                      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:text-slate-400">
                        <span>Aperçu PDF original</span>
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Plein écran
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <iframe
                        src={previewUrl}
                        title={`PDF ${inv.originalFilename}`}
                        className="h-72 w-full bg-white lg:h-80"
                      />
                    </div>
                  )}

                  <div className={showPdf ? "lg:col-span-7" : ""}>
                    {isValidated ? (
                      <div className="grid gap-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 sm:grid-cols-2">
                        <div>
                          <span className="block text-[11px] text-slate-400">
                            Prestataire
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {inv.vendorName}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-slate-400">
                            N° Facture
                          </span>
                          <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                            {inv.invoiceNumber}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-slate-400">
                            Montant HT
                          </span>
                          <span className="font-mono font-bold text-slate-900 dark:text-white">
                            {formatEur(inv.amountHt)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[11px] text-slate-400">
                            Prestation
                          </span>
                          <span className="text-slate-800 dark:text-slate-200">
                            {inv.prestationLabel}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`inv-vendor-${inv.id}`}
                              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                            >
                              Prestataire
                            </label>
                            <input
                              id={`inv-vendor-${inv.id}`}
                              type="text"
                              value={edits.vendorName}
                              disabled={isBlocked}
                              onChange={(e) =>
                                updateEdit(inv, "vendorName", e.target.value)
                              }
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`inv-num-${inv.id}`}
                              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                            >
                              N° Facture
                            </label>
                            <input
                              id={`inv-num-${inv.id}`}
                              type="text"
                              value={edits.invoiceNumber}
                              disabled={isBlocked}
                              onChange={(e) =>
                                updateEdit(inv, "invoiceNumber", e.target.value)
                              }
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`inv-date-${inv.id}`}
                              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                            >
                              Date
                            </label>
                            <input
                              id={`inv-date-${inv.id}`}
                              type="date"
                              value={edits.invoiceDate}
                              disabled={isBlocked}
                              onChange={(e) =>
                                updateEdit(inv, "invoiceDate", e.target.value)
                              }
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`inv-ht-${inv.id}`}
                              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                            >
                              Montant HT (€)
                            </label>
                            <input
                              id={`inv-ht-${inv.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              value={edits.amountHt}
                              disabled={isBlocked}
                              onChange={(e) =>
                                updateEdit(inv, "amountHt", e.target.value)
                              }
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`inv-label-${inv.id}`}
                              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                            >
                              Prestation
                            </label>
                            <input
                              id={`inv-label-${inv.id}`}
                              type="text"
                              value={edits.prestationLabel}
                              disabled={isBlocked}
                              onChange={(e) =>
                                updateEdit(
                                  inv,
                                  "prestationLabel",
                                  e.target.value
                                )
                              }
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`inv-line-${inv.id}`}
                              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                            >
                              Poste budgétaire
                            </label>
                            <select
                              id={`inv-line-${inv.id}`}
                              value={edits.budgetLineId}
                              disabled={isBlocked}
                              onChange={(e) =>
                                updateEdit(inv, "budgetLineId", e.target.value)
                              }
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            >
                              <option value="">— Choisir un poste —</option>
                              {budgetLines.map((line) => {
                                const rem = line.preOpTotalHt - line.postOpTotalHt;
                                return (
                                  <option key={line.id} value={line.id}>
                                    {line.category} — {line.objet} (Reste :{" "}
                                    {formatEur(rem)})
                                  </option>
                                );
                              })}
                            </select>
                            {(() => {
                              const picked = budgetLines.find(
                                (l) => l.id === edits.budgetLineId
                              );
                              if (!picked) return null;
                              const amt = Number(edits.amountHt) || 0;
                              const nextTotal = picked.postOpTotalHt + amt;
                              const over = nextTotal - picked.preOpTotalHt;
                              if (over > 0) {
                                return (
                                  <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                    Impact : dépassement de +{formatEur(over)}{" "}
                                    sur ce poste après validation
                                  </p>
                                );
                              }
                              return (
                                <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                                  Reste disponible après validation :{" "}
                                  {formatEur(picked.preOpTotalHt - nextTotal)}
                                </p>
                              );
                            })()}
                          </div>

                          <div className="sm:col-span-2">
                            <label
                              htmlFor={`inv-quote-${inv.id}`}
                              className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                            >
                              Devis associé (optionnel)
                            </label>
                            <select
                              id={`inv-quote-${inv.id}`}
                              value={edits.quoteId}
                              disabled={isBlocked}
                              onChange={(e) => {
                                const qId = e.target.value;
                                updateEdit(inv, "quoteId", qId);
                                const pickedQuote = quotes.find(
                                  (q) => q.id === qId
                                );
                                if (
                                  pickedQuote?.budgetLineId &&
                                  !edits.budgetLineId
                                ) {
                                  updateEdit(
                                    inv,
                                    "budgetLineId",
                                    pickedQuote.budgetLineId
                                  );
                                }
                              }}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            >
                              <option value="">— Aucun devis relié —</option>
                              {quotes.map((q) => (
                                <option key={q.id} value={q.id}>
                                  {q.quoteNumber} — {q.vendorName} (
                                  {formatEur(q.amountHt)} HT)
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-2 rounded-xl border border-indigo-200/70 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                            <span className="font-semibold">
                              Nomenclature Drive :{" "}
                            </span>
                            <code className="break-all font-mono text-[11px]">
                              {buildValidatedInvoiceFilename({
                                invoiceNumber: edits.invoiceNumber,
                                codeProjet: projectCode,
                                vendorName: edits.vendorName,
                                invoiceDate: edits.invoiceDate,
                              })}
                            </code>
                          </div>
                        </div>

                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            disabled={
                              isBlocked ||
                              validatingId === inv.id ||
                              !edits.budgetLineId
                            }
                            onClick={() => void handleValidate(inv)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {validatingId === inv.id
                              ? "Validation..."
                              : "Valider et préparer Pennylane"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
