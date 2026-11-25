"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  Mail,
  RefreshCw,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { useState } from "react";
import {
  type BudgetLineDto,
  type InvoiceDto,
  formatEur,
} from "@/components/budget/types";

interface InvoicePipelinePanelProps {
  projectId: string;
  budgetLines: BudgetLineDto[];
  invoices: InvoiceDto[];
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
}

export function InvoicePipelinePanel({
  projectId,
  budgetLines,
  invoices,
  onRefresh,
  onError,
  onCpConflictDetected,
}: InvoicePipelinePanelProps) {
  const [uploading, setUploading] = useState(false);
  const [scanningGmail, setScanningGmail] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [editsById, setEditsById] = useState<Record<string, DraftEdits>>({});

  function getEdits(inv: InvoiceDto): DraftEdits {
    const existing = editsById[inv.id];
    if (existing) return existing;
    return {
      vendorName: inv.vendorName ?? "",
      invoiceNumber: inv.invoiceNumber ?? "",
      invoiceDate: inv.invoiceDate ?? new Date().toISOString().slice(0, 10),
      amountHt: String(inv.amountHt ?? 0),
      prestationLabel: inv.prestationLabel ?? "",
      budgetLineId: inv.budgetLineId ?? budgetLines[0]?.id ?? "",
    };
  }

  function updateEdit(inv: InvoiceDto, field: keyof DraftEdits, value: string) {
    const cur = getEdits(inv);
    setEditsById((prev) => ({
      ...prev,
      [inv.id]: {
        ...cur,
        [field]: value,
      },
    }));
  }

  async function uploadPdfFile(file: File) {
    setUploading(true);
    setFeedback(null);
    try {
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
        onCpConflictDetected(
          json.error ?? "Conflit de Code Projet détecté.",
          json.detectedCps
        );
        await onRefresh();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
        return;
      }

      if (!res.ok) {
        onError(res.status, json);
        setFeedback({
          type: "error",
          text: json.error ?? "Échec de l'ingestion de la facture PDF.",
        });
        return;
      }

      setFeedback({
        type: "success",
        text: json.isDuplicate
          ? `Facture "${file.name}" ingérée (Doublon N° Facture signalé).`
          : `Facture "${file.name}" extraite par Gemini et prête pour validation.`,
      });
      await onRefresh();
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setUploading(false);
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
        skippedDuplicates?: number;
      };

      if (!res.ok) {
        onError(res.status, json);
        setFeedback({
          type: "error",
          text: json.error ?? "Échec du scan Gmail.",
        });
        return;
      }

      if ((json.conflictCount ?? 0) > 0) {
        onCpConflictDetected(
          `${json.conflictCount} facture(s) bloquée(s) pour conflit de Code Projet lors du scan Gmail.`
        );
      }

      setFeedback({
        type: "success",
        text: `Scan Gmail terminé : ${json.ingestedCount ?? 0} ingérée(s), ${json.conflictCount ?? 0} conflit(s) bloqué(s), ${json.skippedDuplicates ?? 0} ignorée(s).`,
      });
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
          }),
        }
      );

      const json = (await res.json()) as {
        error?: string;
        code?: string;
        invoice?: InvoiceDto;
        pennylaneDraft?: { draftId?: string; subject?: string };
      };

      if (!res.ok) {
        if (res.status === 409 && json.code === "CP_CONFLICT") {
          onCpConflictDetected(json.error ?? "Conflit de Code Projet détecté.");
        } else {
          onError(res.status, json);
        }
        setFeedback({
          type: "error",
          text: json.error ?? "Échec de la validation de facture.",
        });
        return;
      }

      setFeedback({
        type: "success",
        text: `Facture validée : ${json.invoice?.renamedFilename ?? "PDF"} archivée dans 001.3 Factures, cumulée dans le Sheet et brouillon Pennylane créé.`,
      });
      await onRefresh();
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } finally {
      setValidatingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-[#ff2e58]" />
          <h2 className="text-base font-semibold text-white">
            Pipeline Factures PDF (Gmail + Dépôt Manuel + Pennylane)
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void handleScanGmail()}
          disabled={scanningGmail}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {scanningGmail ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
          Scanner Gmail
        </button>
      </div>

      {/* PDF Dropzone */}
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
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) void uploadPdfFile(dropped);
        }}
        className={`mb-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragOver
            ? "border-[#ff2e58] bg-[#e11d48]/10"
            : "border-[#232b3d] bg-[#171d2b]/60 hover:border-cyan-500/60"
        }`}
      >
        <Upload className="mb-2 h-6 w-6 text-cyan-400" />
        <span className="text-sm font-medium text-white">
          {uploading
            ? "Extraction Gemini en cours..."
            : "Glisser-déposer une facture PDF ici ou cliquer pour sélectionner"}
        </span>
        <span className="mt-1 text-xs text-slate-400">
          Vérification Code Projet automatique + proposition de ligne budgétaire
        </span>
        <input
          id="invoice-pdf-upload"
          type="file"
          accept=".pdf,application/pdf"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void uploadPdfFile(file);
              e.target.value = "";
            }
          }}
        />
      </label>

      {feedback && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-4 py-2.5 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
              : "border-red-500/40 bg-red-950/40 text-red-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Invoice Cards */}
      {invoices.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">
          Aucune facture ingérée sur ce projet.
        </p>
      ) : (
        <div className="space-y-4">
          {invoices.map((inv) => {
            const edits = getEdits(inv);
            const isBlocked =
              inv.cpConflict || inv.status === "CONFLICT_BLOCKED";
            const isValidated = inv.status === "VALIDATED";

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
                className={`rounded-xl border p-4 ${
                  isBlocked
                    ? "border-red-500/70 bg-red-950/30"
                    : isValidated
                      ? "border-emerald-500/40 bg-[#171d2b]/70"
                      : "border-[#232b3d] bg-[#171d2b]"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-white">
                      {inv.renamedFilename ?? inv.originalFilename}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${
                        isBlocked
                          ? "bg-red-500/20 text-red-300"
                          : isValidated
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {isBlocked
                        ? "CONFLICT_BLOCKED"
                        : isValidated
                          ? "VALIDATED · Validée"
                          : "PENDING_VALIDATION"}
                    </span>
                    {isDuplicate && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                        <AlertTriangle className="h-3 w-3" />
                        Doublon N° Facture
                      </span>
                    )}
                    {inv.detectedCodeProjet && (
                      <span className="rounded bg-[#090b10] px-2 py-0.5 font-mono text-[11px] text-slate-300">
                        CP détecté : {inv.detectedCodeProjet}
                      </span>
                    )}
                  </div>

                  {isValidated && (
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-emerald-300">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Drive 001.3
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Sheet + Note
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Brouillon Pennylane
                      </span>
                    </div>
                  )}
                </div>

                {isBlocked && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-950/60 px-3 py-2 text-xs text-red-200">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
                    <span>
                      Injection bloquée : Code Projet détecté (
                      {inv.detectedCodeProjet ?? "différent"}) incompatible avec
                      le projet actif.
                    </span>
                  </div>
                )}

                {rawWarnings.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {rawWarnings.map((w, i) => (
                      <p
                        key={i}
                        className="text-xs text-amber-300"
                      >
                        ⚠ {w}
                      </p>
                    ))}
                  </div>
                )}

                {isValidated ? (
                  <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-4">
                    <div>
                      <span className="text-slate-400">Prestataire : </span>
                      <span className="font-medium text-white">
                        {inv.vendorName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">N° Facture : </span>
                      <span className="font-mono text-white">
                        {inv.invoiceNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Montant HT : </span>
                      <span className="font-mono font-semibold text-rose-300">
                        {formatEur(inv.amountHt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Prestation : </span>
                      <span className="text-white">{inv.prestationLabel}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label
                        htmlFor={`inv-vendor-${inv.id}`}
                        className="mb-1 block text-xs text-slate-300"
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
                        className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`inv-num-${inv.id}`}
                        className="mb-1 block text-xs text-slate-300"
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
                        className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`inv-date-${inv.id}`}
                        className="mb-1 block text-xs text-slate-300"
                      >
                        Date
                      </label>
                      <input
                        id={`inv-date-${inv.id}`}
                        type="text"
                        value={edits.invoiceDate}
                        disabled={isBlocked}
                        onChange={(e) =>
                          updateEdit(inv, "invoiceDate", e.target.value)
                        }
                        className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`inv-ht-${inv.id}`}
                        className="mb-1 block text-xs text-slate-300"
                      >
                        Montant HT
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
                        className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`inv-label-${inv.id}`}
                        className="mb-1 block text-xs text-slate-300"
                      >
                        Résumé prestation
                      </label>
                      <input
                        id={`inv-label-${inv.id}`}
                        type="text"
                        value={edits.prestationLabel}
                        disabled={isBlocked}
                        onChange={(e) =>
                          updateEdit(inv, "prestationLabel", e.target.value)
                        }
                        className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`inv-line-${inv.id}`}
                        className="mb-1 block text-xs text-slate-300"
                      >
                        Ligne budgétaire
                      </label>
                      <select
                        id={`inv-line-${inv.id}`}
                        value={edits.budgetLineId}
                        disabled={isBlocked}
                        onChange={(e) =>
                          updateEdit(inv, "budgetLineId", e.target.value)
                        }
                        className="w-full rounded-md border border-[#232b3d] bg-[#090b10] px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                      >
                        <option value="">— Sélectionner un poste —</option>
                        {budgetLines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.category} — {line.objet} (Pré-op{" "}
                            {formatEur(line.preOpTotalHt)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {!isValidated && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      disabled={isBlocked || validatingId === inv.id}
                      onClick={() => void handleValidate(inv)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#e11d48] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#ff2e58] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {validatingId === inv.id ? "Validation..." : "Valider"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
