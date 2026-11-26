"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileText,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CockpitBudgetLineOption,
  CockpitProjectRef,
} from "@/components/cockpit/CockpitInvoiceDropzone";
import {
  evaluateInvoiceVerificationWarnings,
  normalizeProjectCodesList,
  requiresVigilanceAttestation,
} from "@/lib/invoices/accounting-email";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";
import { formatEur, normalizeIsoDate } from "@/lib/shared/format";
import { showToast } from "@/lib/toast";

interface StagedQuoteItem {
  localId: string;
  file: File;
  blobUrl: string;
  originalFilename: string;
  quoteNumber: string;
  supplierQuoteRef: string | null;
  vendorName: string;
  issueDate: string;
  validUntil: string;
  amountHt: number;
  description: string;
  budgetLineId: string;
  status: "ACCEPTE" | "EN_ATTENTE" | "BROUILLON";
  projectCodes: string[];
  cpConflict: boolean;
  vigilanceAttached: boolean;
  vigilanceName: string | null;
  vigilanceFile: File | null;
  driveBaseSeq: number;
}

interface CockpitQuoteDropzoneProps {
  project: CockpitProjectRef;
  allProjects: CockpitProjectRef[];
  budgetLines: CockpitBudgetLineOption[];
}

export function CockpitQuoteDropzone({
  project,
  allProjects,
  budgetLines,
}: CockpitQuoteDropzoneProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const vigilanceInputRef = useRef<HTMLInputElement | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);

  // Batch queue of staged PDF quotes awaiting verification & Drive upload
  const [queue, setQueue] = useState<StagedQuoteItem[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const [mobilePane, setMobilePane] = useState<"pdf" | "form">("form");

  // Active verification form fields
  const [vendorName, setVendorName] = useState("");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [supplierQuoteRef, setSupplierQuoteRef] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [amountHt, setAmountHt] = useState("");
  const [description, setDescription] = useState("");
  const [quoteStatus, setQuoteStatus] = useState<
    "ACCEPTE" | "EN_ATTENTE" | "BROUILLON"
  >("EN_ATTENTE");
  const [budgetLineId, setBudgetLineId] = useState("");
  const [projectCodes, setProjectCodes] = useState<string[]>([
    project.codeProjet,
  ]);
  const [newCodeInput, setNewCodeInput] = useState("");
  const [multiProjectConfirmed, setMultiProjectConfirmed] = useState(true);
  const [vigilanceAttached, setVigilanceAttached] = useState(false);
  const [vigilanceName, setVigilanceName] = useState<string | null>(null);
  const [vigilanceFile, setVigilanceFile] = useState<File | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const blobUrlsRef = useRef<string[]>([]);
  const currentQuote = queue[queueIdx] ?? null;

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentQuote) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [currentQuote]);

  function hydrateQuoteForm(item: StagedQuoteItem) {
    setModalError(null);
    setAcknowledgeWarnings(false);
    setConfirmDelete(false);
    setVendorName(item.vendorName);
    setQuoteNumber(item.quoteNumber);
    setSupplierQuoteRef(item.supplierQuoteRef);
    setIssueDate(
      normalizeIsoDate(item.issueDate) ?? new Date().toISOString().slice(0, 10)
    );
    setValidUntil(normalizeIsoDate(item.validUntil) ?? "");
    setAmountHt(String(item.amountHt ?? 0));
    setDescription(item.description || "Prestation");
    setQuoteStatus(item.status);
    setBudgetLineId(
      item.budgetLineId || (budgetLines.length === 1 ? budgetLines[0].id : "")
    );
    setProjectCodes(
      normalizeProjectCodesList(item.projectCodes, project.codeProjet)
    );
    setMultiProjectConfirmed(item.projectCodes.length === 1 && !item.cpConflict);
    setVigilanceAttached(item.vigilanceAttached);
    setVigilanceName(item.vigilanceName);
    setVigilanceFile(item.vigilanceFile);
  }

  function snapshotCurrentIntoQueue(list: StagedQuoteItem[]): StagedQuoteItem[] {
    if (!currentQuote) return list;
    return list.map((item) =>
      item.localId === currentQuote.localId
        ? {
            ...item,
            vendorName,
            quoteNumber,
            issueDate,
            validUntil,
            amountHt: Number(amountHt) || 0,
            description,
            status: quoteStatus,
            budgetLineId,
            projectCodes,
            vigilanceAttached,
            vigilanceName,
            vigilanceFile,
          }
        : item
    );
  }

  function closeModal() {
    for (const item of queue) {
      URL.revokeObjectURL(item.blobUrl);
    }
    blobUrlsRef.current = [];
    setQueue([]);
    setQueueIdx(0);
    setConfirmDelete(false);
    setModalError(null);
  }

  async function handleFilesUpload(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (files.length === 0) {
      showToast("Veuillez déposer au moins un devis au format PDF.", "error");
      return;
    }

    setAnalyzing(true);
    setAnalyzeStatus(
      files.length > 1
        ? `Analyse IA de ${files.length} devis PDF...`
        : `Analyse IA de ${files[0].name}...`
    );

    const staged: StagedQuoteItem[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setAnalyzeStatus(`Analyse IA (${i + 1}/${files.length}) : ${file.name}...`);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("batchOffset", String(i));
        const res = await fetch(`/api/projects/${project.id}/quotes/extract`, {
          method: "POST",
          body: fd,
        });
        const json = (await res.json().catch(() => ({}))) as {
          extracted?: {
            quoteNumber: string;
            supplierQuoteRef: string | null;
            vendorName: string;
            issueDate: string;
            amountHt: number;
            description: string;
            suggestedBudgetLineId: string | null;
            detectedProjectCodes?: string[];
            cpConflict?: boolean;
            driveBaseSeq?: number;
            vigilanceVault?: {
              driveFileId: string;
              filename: string;
            } | null;
          };
          error?: string;
        };

        if (!res.ok || !json.extracted) {
          showToast(
            json.error ?? `Impossible d'analyser ${file.name}.`,
            "error"
          );
          continue;
        }

        const blobUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(blobUrl);
        const ex = json.extracted;
        staged.push({
          localId: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          blobUrl,
          originalFilename: file.name,
          quoteNumber: ex.quoteNumber || String((ex.driveBaseSeq ?? 0) + 1 + i),
          supplierQuoteRef: ex.supplierQuoteRef ?? null,
          vendorName: ex.vendorName || "",
          issueDate: ex.issueDate || new Date().toISOString().slice(0, 10),
          validUntil: "",
          amountHt: ex.amountHt ?? 0,
          description: ex.description || "Prestation",
          budgetLineId: ex.suggestedBudgetLineId ?? "",
          status: "EN_ATTENTE",
          projectCodes: normalizeProjectCodesList(
            ex.detectedProjectCodes ?? [project.codeProjet],
            project.codeProjet
          ),
          cpConflict: Boolean(ex.cpConflict),
          vigilanceAttached: Boolean(ex.vigilanceVault),
          vigilanceName: ex.vigilanceVault?.filename ?? null,
          vigilanceFile: null,
          driveBaseSeq: ex.driveBaseSeq ?? 0,
        });
      }

      if (staged.length > 0) {
        setQueue(staged);
        setQueueIdx(0);
        hydrateQuoteForm(staged[0]);
        showToast(
          staged.length > 1
            ? `${staged.length} devis analysés ! Vérification ouverte.`
            : "Devis analysé ! Vérification prête."
        );
      }
    } finally {
      setAnalyzing(false);
      setAnalyzeStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleRemoveCurrentFromQueue() {
    if (!currentQuote) return;
    URL.revokeObjectURL(currentQuote.blobUrl);
    const remaining = queue
      .filter((item) => item.localId !== currentQuote.localId)
      .map((item, idx) => ({
        ...item,
        quoteNumber: /^\d+$/.test(item.quoteNumber.trim())
          ? String(item.driveBaseSeq + 1 + idx)
          : item.quoteNumber,
      }));
    setConfirmDelete(false);
    showToast("Devis retiré de la vérification.");

    if (remaining.length === 0) {
      setQueue([]);
      setQueueIdx(0);
      setModalError(null);
    } else {
      const nextIdx = Math.min(queueIdx, remaining.length - 1);
      setQueue(remaining);
      setQueueIdx(nextIdx);
      hydrateQuoteForm(remaining[nextIdx]);
    }
  }

  const parsedHt = Number(amountHt) || 0;
  const needsVigilance = requiresVigilanceAttestation(parsedHt, parsedHt);

  const warnings = useMemo(
    () =>
      evaluateInvoiceVerificationWarnings({
        vendorName,
        invoiceNumber: quoteNumber,
        invoiceDate: issueDate,
        amountHt: parsedHt,
        amountTtc: parsedHt,
        budgetLineId,
        activeProjectCode: project.codeProjet,
        projectCodes,
        multiProjectConfirmed,
        hasVigilanceAttestation: vigilanceAttached,
      }),
    [
      vendorName,
      quoteNumber,
      issueDate,
      parsedHt,
      budgetLineId,
      project.codeProjet,
      projectCodes,
      multiProjectConfirmed,
      vigilanceAttached,
    ]
  );

  const blockingErrors = warnings.filter((w) => w.severity === "error");
  const alertWarnings = warnings.filter((w) => w.severity === "warning");

  const driveFilenamePreview = buildValidatedInvoiceFilename({
    invoiceNumber: quoteNumber,
    invoiceDate: issueDate,
    codeProjet: projectCodes.join("-"),
    vendorName,
    amountHt: parsedHt,
  });

  async function handleValidateAndUploadToDrive() {
    if (!currentQuote) return;
    setModalError(null);
    if (blockingErrors.length > 0) {
      setModalError(
        `Conditions obligatoires non remplies : ${blockingErrors.map((e) => e.message).join(" ")}`
      );
      return;
    }
    if (alertWarnings.length > 0 && !acknowledgeWarnings) {
      setModalError(
        "Certaines conditions d'alerte ne sont pas encore remplies (attestation de vigilance > 3 000 € ou multi-projets). Corrigez-les ou cochez la case de confirmation ci-dessous."
      );
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", currentQuote.file);
      fd.append("quoteNumber", quoteNumber.trim());
      fd.append("vendorName", vendorName.trim());
      fd.append("description", description.trim() || "Prestation");
      fd.append("issueDate", issueDate.trim());
      if (validUntil.trim()) fd.append("validUntil", validUntil.trim());
      fd.append("amountHt", String(parsedHt));
      fd.append("status", quoteStatus);
      if (budgetLineId) fd.append("budgetLineId", budgetLineId);
      fd.append("projectCodes", JSON.stringify(projectCodes));
      if (supplierQuoteRef && supplierQuoteRef !== quoteNumber.trim()) {
        fd.append("notes", `Réf. devis fournisseur : ${supplierQuoteRef}`);
      }
      if (vigilanceFile) {
        fd.append("vigilanceFile", vigilanceFile);
      }

      const res = await fetch(`/api/projects/${project.id}/quotes`, {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        uploadedToDrive?: boolean;
        driveFilename?: string;
        error?: string;
      };
      if (!res.ok) {
        setModalError(
          json.error ?? "Impossible d'enregistrer ce devis dans Google Drive."
        );
        return;
      }

      showToast(
        json.uploadedToDrive
          ? `Devis ${json.driveFilename ?? driveFilenamePreview} déposé dans Google Drive (001.2 Devis) !`
          : `Devis ${quoteNumber} enregistré (PDF conservé, Drive non connecté).`
      );
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      router.refresh();

      URL.revokeObjectURL(currentQuote.blobUrl);
      const remaining = queue.filter(
        (item) => item.localId !== currentQuote.localId
      );
      if (remaining.length === 0) {
        setQueue([]);
        setQueueIdx(0);
      } else {
        const nextIdx = Math.min(queueIdx, remaining.length - 1);
        setQueue(remaining);
        setQueueIdx(nextIdx);
        hydrateQuoteForm(remaining[nextIdx]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function addProjectCode(rawCode: string) {
    const clean = rawCode.trim().replace(/^CP\s*/i, "");
    if (!clean) return;
    setProjectCodes((prev) =>
      normalizeProjectCodesList([...prev, clean], project.codeProjet)
    );
    setNewCodeInput("");
    setMultiProjectConfirmed(false);
  }

  function removeProjectCode(code: string) {
    setProjectCodes((prev) => {
      const next = prev.filter((c) => c !== code);
      return next.length > 0 ? next : [project.codeProjet];
    });
  }

  return (
    <>
      {/* Quick-Action Drag & Drop Quote Tile right inside Cockpit "Accès rapides" */}
      <div
        data-testid="cockpit-quote-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          if (e.dataTransfer.files?.length) {
            void handleFilesUpload(e.dataTransfer.files);
          }
        }}
        className={`col-span-2 rounded-xl border-2 border-dashed p-3 transition-all ${
          dragOver
            ? "border-emerald-500 bg-emerald-50/80 dark:border-emerald-400 dark:bg-emerald-500/20"
            : "border-emerald-200/90 bg-emerald-50/25 hover:border-emerald-400 hover:bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/5 dark:hover:border-emerald-400/60 dark:hover:bg-emerald-500/10"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              void handleFilesUpload(e.target.files);
            }
          }}
        />

        <button
          type="button"
          disabled={analyzing}
          onClick={() => fileInputRef.current?.click()}
          data-testid="cockpit-upload-quote-btn"
          className="flex w-full items-center justify-between gap-2.5 text-left disabled:opacity-60"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-2xs">
              {analyzing ? (
                <Upload className="h-4 w-4 animate-bounce" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white">
                {analyzing ? "Analyse devis PDF..." : "Déposer un devis PDF"}
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {analyzeStatus ??
                  "Glisser-déposer ou cliquer · synchro auto Drive (001.2 Devis)"}
              </p>
            </div>
          </div>
          <Upload className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        </button>
      </div>

      {/* FULL-SCREEN SPLIT-VIEW QUOTE VERIFICATION & DRIVE SYNC MODAL */}
      {currentQuote && (
        <div
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (!submitting) void handleValidateAndUploadToDrive();
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeModal();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-2 backdrop-blur-xs sm:p-5"
        >
          <div className="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#111827]">
            {/* Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Vérification du devis &amp; dépôt Google Drive
                    </h3>
                    {queue.length > 1 && (
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                        <button
                          type="button"
                          disabled={queueIdx === 0}
                          onClick={() => {
                            const saved = snapshotCurrentIntoQueue(queue);
                            const prevIdx = Math.max(0, queueIdx - 1);
                            setQueue(saved);
                            setQueueIdx(prevIdx);
                            hydrateQuoteForm(saved[prevIdx]);
                          }}
                          aria-label="Devis précédent"
                          className="rounded px-1 hover:bg-emerald-100 disabled:opacity-30 dark:hover:bg-emerald-500/30"
                        >
                          ←
                        </button>
                        <span>
                          {queueIdx + 1}/{queue.length}
                        </span>
                        <button
                          type="button"
                          disabled={queueIdx >= queue.length - 1}
                          onClick={() => {
                            const saved = snapshotCurrentIntoQueue(queue);
                            const nextIdx = Math.min(
                              saved.length - 1,
                              queueIdx + 1
                            );
                            setQueue(saved);
                            setQueueIdx(nextIdx);
                            hydrateQuoteForm(saved[nextIdx]);
                          }}
                          aria-label="Devis suivant"
                          className="rounded px-1 hover:bg-emerald-100 disabled:opacity-30 dark:hover:bg-emerald-500/30"
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      <Sparkles className="h-2.5 w-2.5" />
                      {driveFilenamePreview}
                    </span>
                    {currentQuote.originalFilename !== driveFilenamePreview && (
                      <span className="truncate opacity-75">
                        (initial : {currentQuote.originalFilename})
                      </span>
                    )}
                    <span>
                      · CP {project.codeProjet} ({project.client})
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={currentQuote.blobUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ouvrir PDF
                </a>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Fermer"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Mobile Tabs Switcher (< 1024px) */}
            <div className="flex border-b border-slate-200 bg-slate-50 px-4 py-1.5 lg:hidden dark:border-slate-800 dark:bg-slate-900/60">
              <div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-0.5 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setMobilePane("form")}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                    mobilePane === "form"
                      ? "bg-white text-emerald-700 shadow-2xs dark:bg-slate-900 dark:text-emerald-300"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Vérification
                </button>
                <button
                  type="button"
                  onClick={() => setMobilePane("pdf")}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                    mobilePane === "pdf"
                      ? "bg-white text-emerald-700 shadow-2xs dark:bg-slate-900 dark:text-emerald-300"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Aperçu PDF
                </button>
              </div>
            </div>

            {/* Split-View Body */}
            <div className="grid min-h-0 flex-1 lg:grid-cols-12">
              {/* LEFT (7 cols): Full-Height Embedded PDF Viewer */}
              <div
                className={`${
                  mobilePane === "pdf" ? "flex" : "hidden lg:flex"
                } min-h-[300px] flex-col border-b border-slate-200 bg-slate-100 lg:col-span-7 lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-950`}
              >
                <iframe
                  key={currentQuote.localId}
                  src={`${currentQuote.blobUrl}#view=FitH`}
                  title={`Devis ${currentQuote.originalFilename}`}
                  className="h-full w-full flex-1 border-0"
                />
              </div>

              {/* RIGHT (5 cols): Quote Verification Form */}
              <div
                className={`${
                  mobilePane === "form" ? "flex" : "hidden lg:flex"
                } min-h-0 flex-col overflow-y-auto p-5 lg:col-span-5`}
              >
                {modalError && (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div className="space-y-4">
                  {/* Live Conditions Checklist */}
                  {warnings.length > 0 ? (
                    <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      <p className="flex items-center gap-1.5 font-bold">
                        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        Conditions à vérifier ({warnings.length})
                      </p>
                      <ul className="list-disc space-y-1 pl-4 text-[11px]">
                        {warnings.map((w) => (
                          <li
                            key={w.code}
                            className={
                              w.severity === "error"
                                ? "font-semibold text-rose-700 dark:text-rose-300"
                                : ""
                            }
                          >
                            {w.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      Toutes les conditions du devis sont remplies.
                    </div>
                  )}

                  {/* Core Fields */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Prestataire *
                      </label>
                      <input
                        type="text"
                        value={vendorName}
                        onChange={(e) => setVendorName(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        N° de devis (nomenclature 1, 2, 3...) *
                      </label>
                      <input
                        type="text"
                        value={quoteNumber}
                        onChange={(e) => setQuoteNumber(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      {supplierQuoteRef &&
                        supplierQuoteRef !== quoteNumber.trim() && (
                          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                            Réf. devis PDF : {supplierQuoteRef}
                          </p>
                        )}
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Date d&apos;émission *
                      </label>
                      <input
                        type="date"
                        value={issueDate}
                        onChange={(e) => setIssueDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Montant HT (€) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={amountHt}
                        onChange={(e) => setAmountHt(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs tabular-nums text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Statut du devis
                      </label>
                      <select
                        value={quoteStatus}
                        onChange={(e) =>
                          setQuoteStatus(
                            e.target.value as
                              | "ACCEPTE"
                              | "EN_ATTENTE"
                              | "BROUILLON"
                          )
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="ACCEPTE">Accepté (Engagé budget)</option>
                        <option value="EN_ATTENTE">En attente de validation</option>
                        <option value="BROUILLON">Brouillon</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Valide jusqu&apos;au (optionnel)
                      </label>
                      <input
                        type="date"
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Prestation
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  {/* Multi-Project Codes Section */}
                  <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-200">
                      Code(s) Projet concerné(s) (mono ou multi-CP)
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {projectCodes.map((code) => (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                        >
                          CP {code}
                          {projectCodes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeProjectCode(code)}
                              className="hover:text-rose-600"
                              aria-label={`Retirer CP ${code}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <select
                        aria-label="Ajouter un autre projet"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) addProjectCode(e.target.value);
                        }}
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <option value="">
                          + Ajouter un autre projet agence...
                        </option>
                        {allProjects
                          .filter((p) => !projectCodes.includes(p.codeProjet))
                          .map((p) => (
                            <option key={p.id} value={p.codeProjet}>
                              CP {p.codeProjet} — {p.client} ({p.nomJeu})
                            </option>
                          ))}
                      </select>
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={newCodeInput}
                          onChange={(e) => setNewCodeInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addProjectCode(newCodeInput);
                            }
                          }}
                          placeholder="Autre CP..."
                          className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => addProjectCode(newCodeInput)}
                          className="rounded-lg border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {(projectCodes.length > 1 ||
                      projectCodes.some((c) => c !== project.codeProjet)) && (
                      <label className="mt-1 flex cursor-pointer items-center gap-2 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                        <input
                          type="checkbox"
                          checked={multiProjectConfirmed}
                          onChange={(e) =>
                            setMultiProjectConfirmed(e.target.checked)
                          }
                          className="h-3.5 w-3.5 accent-indigo-600"
                        />
                        Je confirme les codes projet (devis multi-projets / CP
                        vérifié)
                      </label>
                    )}
                  </div>

                  {/* Budget Line */}
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Poste budgétaire *
                    </label>
                    <select
                      value={budgetLineId}
                      onChange={(e) => setBudgetLineId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">— Choisir un poste —</option>
                      {budgetLines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.category} — {line.objet} (Reste :{" "}
                          {formatEur(line.preOpTotalHt - line.postOpTotalHt)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* > 3 000 € HT Attestation de Vigilance Reminder & Drive Upload */}
                  {needsVigilance && (
                    <div
                      className={`space-y-2.5 rounded-xl border p-3.5 text-xs ${
                        vigilanceAttached
                          ? "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                          : "border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {vigilanceAttached ? (
                          <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                        )}
                        <div>
                          <p className="font-bold">
                            Devis &gt; 3 000 € HT · Attestation de vigilance
                            (URSSAF)
                          </p>
                          <p className="mt-0.5 text-[11px] opacity-90">
                            {vigilanceAttached
                              ? `Attestation prête pour Drive : ${vigilanceName ?? "OK"}`
                              : "Rappel obligatoire : joignez l'attestation de vigilance URSSAF du prestataire (déposée dans 001.2 Devis + Coffre URSSAF)."}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={vigilanceInputRef}
                          type="file"
                          accept="application/pdf,image/*,.pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              setVigilanceFile(f);
                              setVigilanceAttached(true);
                              setVigilanceName(f.name);
                              e.target.value = "";
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => vigilanceInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {vigilanceAttached
                            ? "Remplacer l'attestation"
                            : "Joindre l'attestation (Drive)"}
                        </button>
                        {!vigilanceAttached && (
                          <button
                            type="button"
                            onClick={() => {
                              setVigilanceAttached(true);
                              setVigilanceName(
                                "Attestation déjà présente dans Drive"
                              );
                            }}
                            className="rounded-lg border border-current/25 px-2.5 py-1.5 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            Déjà dans Drive
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Drive Nomenclature Preview */}
                  <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 px-3 py-2 text-[11px] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <span className="font-semibold">
                      Fichier déposé Drive (001.2 Devis) :{" "}
                    </span>
                    <code className="break-all font-mono">
                      {driveFilenamePreview}
                    </code>
                  </div>

                  {alertWarnings.length > 0 && blockingErrors.length === 0 && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      <input
                        type="checkbox"
                        checked={acknowledgeWarnings}
                        onChange={(e) =>
                          setAcknowledgeWarnings(e.target.checked)
                        }
                        className="mt-0.5 h-3.5 w-3.5 accent-indigo-600"
                      />
                      <span>
                        J&apos;ai bien pris connaissance des alertes ci-dessus et
                        je souhaite quand même déposer ce devis dans Drive.
                      </span>
                    </label>
                  )}

                  {/* Bottom Action Bar (single Delete button + inline confirm next to it) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setConfirmDelete((prev) => !prev)}
                        className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-500/30 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-500/15"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </button>
                      {confirmDelete && (
                        <div className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200">
                          <span>Confirmer ?</span>
                          <button
                            type="button"
                            onClick={handleRemoveCurrentFromQueue}
                            className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-700"
                          >
                            Oui
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-slate-900 dark:text-rose-200"
                          >
                            Non
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Fermer
                      </button>
                      <button
                        type="button"
                        disabled={submitting || blockingErrors.length > 0}
                        onClick={() => void handleValidateAndUploadToDrive()}
                        data-testid="quote-confirm-drive-btn"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" />
                        {submitting
                          ? "Dépôt Drive..."
                          : "Valider & déposer dans Drive"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
