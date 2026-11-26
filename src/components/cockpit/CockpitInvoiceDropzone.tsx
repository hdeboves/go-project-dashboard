"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  FileText,
  Mail,
  Plus,
  Receipt,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  evaluateInvoiceVerificationWarnings,
  normalizeProjectCodesList,
  requiresVigilanceAttestation,
  type AccountingCcEntry,
} from "@/lib/invoices/accounting-email";
import { buildValidatedInvoiceFilename } from "@/lib/shared/filenames";
import { formatEur, normalizeIsoDate } from "@/lib/shared/format";
import { showToast } from "@/lib/toast";

export interface CockpitInvoiceItem {
  id: string;
  originalFilename: string;
  renamedFilename?: string | null;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountHt: number;
  tvaAmount: number;
  amountTtc: number;
  prestationLabel: string | null;
  budgetLineId: string | null;
  quoteId: string | null;
  detectedCodeProjet: string | null;
  projectCodesJson?: string | null;
  vigilanceDriveFileId?: string | null;
  vigilanceFilename?: string | null;
  extractedJson?: string | null;
  cpConflict: boolean;
  status: string;
}

export interface CockpitBudgetLineOption {
  id: string;
  category: string;
  objet: string;
  preOpTotalHt: number;
  postOpTotalHt: number;
}

export interface CockpitQuoteOption {
  id: string;
  quoteNumber: string;
  vendorName: string;
  amountHt: number;
  budgetLineId: string | null;
}

export interface CockpitProjectRef {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
}

interface CockpitInvoiceDropzoneProps {
  project: CockpitProjectRef;
  allProjects: CockpitProjectRef[];
  budgetLines: CockpitBudgetLineOption[];
  quotes: CockpitQuoteOption[];
  initialPendingInvoices: CockpitInvoiceItem[];
}

interface EmailPreviewPayload {
  to: string;
  ccEntries: AccountingCcEntry[];
  cc: string[];
  subject: string;
  body: string;
  attachmentFilename: string;
  projectCodes: string[];
  hasVigilanceAttestation: boolean;
  vigilanceFilename: string | null;
}

function parseSupplierInvoiceRef(inv: CockpitInvoiceItem): string | null {
  if (!inv.extractedJson) return null;
  try {
    const parsed = JSON.parse(inv.extractedJson) as {
      supplierInvoiceNumber?: string | null;
    };
    return typeof parsed.supplierInvoiceNumber === "string" &&
      parsed.supplierInvoiceNumber.trim()
      ? parsed.supplierInvoiceNumber.trim()
      : null;
  } catch {
    return null;
  }
}

function parseInitialCodes(
  inv: CockpitInvoiceItem,
  activeCode: string
): string[] {
  const collected: string[] = [activeCode];
  if (inv.projectCodesJson) {
    try {
      const parsed = JSON.parse(inv.projectCodesJson);
      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          if (typeof c === "string") collected.push(c);
        }
      }
    } catch {
      // ignore
    }
  }
  if (inv.detectedCodeProjet) {
    collected.push(inv.detectedCodeProjet);
  }
  return normalizeProjectCodesList(collected, activeCode);
}

export function CockpitInvoiceDropzone({
  project,
  allProjects,
  budgetLines,
  quotes,
  initialPendingInvoices,
}: CockpitInvoiceDropzoneProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const vigilanceInputRef = useRef<HTMLInputElement | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [pendingList, setPendingList] = useState<CockpitInvoiceItem[]>(
    initialPendingInvoices
  );
  const [localBlobUrls, setLocalBlobUrls] = useState<Record<string, string>>(
    {}
  );

  // Verification modal state (Queue of 1 or multiple invoices; 1 Gmail draft per invoice!)
  const [queue, setQueue] = useState<CockpitInvoiceItem[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 editable verification fields
  const [vendorName, setVendorName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [amountHt, setAmountHt] = useState("");
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState<string | null>(
    null
  );
  const [prestationLabel, setPrestationLabel] = useState("");
  const [budgetLineId, setBudgetLineId] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [projectCodes, setProjectCodes] = useState<string[]>([
    project.codeProjet,
  ]);
  const [newCodeInput, setNewCodeInput] = useState("");
  const [multiProjectConfirmed, setMultiProjectConfirmed] = useState(false);
  const [vigilanceAttached, setVigilanceAttached] = useState(false);
  const [vigilanceName, setVigilanceName] = useState<string | null>(null);
  const [uploadingVigilance, setUploadingVigilance] = useState(false);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);

  // Step 2 Gmail draft confirmation state
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [emailPreview, setEmailPreview] = useState<EmailPreviewPayload | null>(
    null
  );
  const [ccEntries, setCcEntries] = useState<AccountingCcEntry[]>([]);
  const [newCcEmail, setNewCcEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [submittingDraft, setSubmittingDraft] = useState(false);
  const [deletingInvoice, setDeletingInvoice] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const currentInvoice = queue[queueIdx] ?? null;

  function hydrateStep1(inv: CockpitInvoiceItem) {
    setStep(1);
    setModalError(null);
    setEmailPreview(null);
    setAcknowledgeWarnings(false);
    setConfirmDelete(false);
    setVendorName(
      inv.vendorName && inv.vendorName !== "Prestataire à vérifier"
        ? inv.vendorName
        : ""
    );
    setInvoiceNumber(inv.invoiceNumber ?? "");
    setInvoiceDate(
      normalizeIsoDate(inv.invoiceDate) ?? new Date().toISOString().slice(0, 10)
    );
    setAmountHt(String(inv.amountHt ?? 0));
    setSupplierInvoiceRef(parseSupplierInvoiceRef(inv));
    setPrestationLabel(inv.prestationLabel ?? "Prestation");
    setBudgetLineId(
      inv.budgetLineId ?? (budgetLines.length === 1 ? budgetLines[0].id : "")
    );
    setQuoteId(inv.quoteId ?? "");
    const codes = parseInitialCodes(inv, project.codeProjet);
    setProjectCodes(codes);
    setMultiProjectConfirmed(codes.length === 1 && !inv.cpConflict);
    setVigilanceAttached(Boolean(inv.vigilanceDriveFileId));
    setVigilanceName(inv.vigilanceFilename ?? null);
  }

  function openVerifierFor(items: CockpitInvoiceItem[], startIndex = 0) {
    if (items.length === 0) return;
    setQueue(items);
    setQueueIdx(startIndex);
    hydrateStep1(items[startIndex]);
  }

  function closeModal(persistCurrentDraft = false) {
    if (persistCurrentDraft && currentInvoice) {
      const nextRenamed = buildValidatedInvoiceFilename({
        invoiceNumber,
        invoiceDate,
        codeProjet: projectCodes.join("-"),
        vendorName: vendorName || currentInvoice.vendorName || "Prestataire",
        amountHt: Number(amountHt) || 0,
      });
      const updatedItem: CockpitInvoiceItem = {
        ...currentInvoice,
        vendorName: vendorName.trim() || currentInvoice.vendorName,
        invoiceNumber: invoiceNumber.trim() || currentInvoice.invoiceNumber,
        invoiceDate: invoiceDate.trim() || currentInvoice.invoiceDate,
        amountHt: Number(amountHt) || 0,
        tvaAmount: 0,
        amountTtc: Number(amountHt) || 0,
        prestationLabel: prestationLabel.trim() || currentInvoice.prestationLabel,
        budgetLineId: budgetLineId || null,
        quoteId: quoteId || null,
        projectCodesJson: JSON.stringify(projectCodes),
        renamedFilename: nextRenamed,
      };
      setPendingList((prev) =>
        prev.map((item) => (item.id === currentInvoice.id ? updatedItem : item))
      );
      void fetch(`/api/projects/${project.id}/invoices/${currentInvoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: vendorName.trim(),
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate: invoiceDate.trim(),
          amountHt: Number(amountHt) || 0,
          amountTtc: Number(amountHt) || 0,
          prestationLabel: prestationLabel.trim(),
          budgetLineId: budgetLineId || null,
          quoteId: quoteId || null,
          projectCodes,
        }),
      }).catch(() => undefined);
    }
    setQueue([]);
    setQueueIdx(0);
    setStep(1);
    setConfirmDelete(false);
    setModalError(null);
    setEmailPreview(null);
  }

  async function handleDeleteCurrentInvoice() {
    if (!currentInvoice) return;
    setDeletingInvoice(true);
    setModalError(null);
    try {
      const targetId = currentInvoice.id;
      const res = await fetch(
        `/api/projects/${project.id}/invoices/${targetId}`,
        { method: "DELETE" }
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setModalError(
          json.error ?? "Impossible de supprimer cette facture."
        );
        return;
      }

      // Clean up local blob URL if created in this session
      const blobToRevoke = localBlobUrls[targetId];
      if (blobToRevoke) {
        URL.revokeObjectURL(blobToRevoke);
        setLocalBlobUrls((prev) => {
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
      }

      const remainingPending = pendingList.filter((p) => p.id !== targetId);
      setPendingList(remainingPending);

      const remainingQueue = queue.filter((q) => q.id !== targetId);
      setConfirmDelete(false);
      showToast("Facture supprimée.");
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      router.refresh();

      if (remainingQueue.length === 0) {
        closeModal(false);
      } else {
        const nextIdx = Math.min(queueIdx, remainingQueue.length - 1);
        setQueue(remainingQueue);
        setQueueIdx(nextIdx);
        hydrateStep1(remainingQueue[nextIdx]);
      }
    } finally {
      setDeletingInvoice(false);
    }
  }

  async function handleFilesUpload(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (files.length === 0) {
      showToast("Veuillez déposer au moins une facture au format PDF.", "error");
      return;
    }

    setUploading(true);
    setUploadStatus(
      files.length > 1
        ? `Analyse IA de ${files.length} factures PDF...`
        : `Analyse IA de ${files[0].name}...`
    );

    const ingested: CockpitInvoiceItem[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadStatus(
          `Analyse IA (${i + 1}/${files.length}) : ${file.name}...`
        );
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/projects/${project.id}/invoices`, {
          method: "POST",
          body: fd,
        });
        const json = (await res.json().catch(() => ({}))) as {
          invoice?: CockpitInvoiceItem;
          detectedCps?: string[];
          error?: string;
        };

        if ((res.ok || res.status === 409) && json.invoice) {
          const blobUrl = URL.createObjectURL(file);
          setLocalBlobUrls((prev) => ({ ...prev, [json.invoice!.id]: blobUrl }));
          const item: CockpitInvoiceItem = {
            ...json.invoice,
            projectCodesJson:
              json.detectedCps && json.detectedCps.length > 0
                ? JSON.stringify(
                    normalizeProjectCodesList(
                      [project.codeProjet, ...json.detectedCps],
                      project.codeProjet
                    )
                  )
                : json.invoice.projectCodesJson,
          };
          ingested.push(item);
        } else {
          showToast(
            json.error ?? `Erreur lors du dépôt de ${file.name}.`,
            "error"
          );
        }
      }

      if (ingested.length > 0) {
        setPendingList((prev) => {
          const ids = new Set(ingested.map((i) => i.id));
          return [...ingested, ...prev.filter((p) => !ids.has(p.id))];
        });
        showToast(
          ingested.length > 1
            ? `${ingested.length} factures analysées ! Vérification prête (1 mail par facture).`
            : "Facture analysée ! Vérification ouverte."
        );
        openVerifierFor(ingested, 0);
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setUploading(false);
      setUploadStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleVigilanceFileUpload(file: File) {
    if (!currentInvoice) return;
    setUploadingVigilance(true);
    setModalError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/projects/${project.id}/invoices/${currentInvoice.id}/vigilance`,
        { method: "POST", body: fd }
      );
      const json = (await res.json()) as {
        ok?: boolean;
        uploadedToDrive?: boolean;
        filename?: string;
        error?: string;
      };
      if (!res.ok) {
        setModalError(
          json.error ?? "Impossible de joindre l'attestation de vigilance."
        );
        return;
      }
      setVigilanceAttached(true);
      setVigilanceName(json.filename ?? file.name);
      showToast(
        json.uploadedToDrive
          ? "Attestation de vigilance déposée dans Google Drive !"
          : "Attestation jointe (sera déposée sur Drive à la validation)."
      );
    } finally {
      setUploadingVigilance(false);
      if (vigilanceInputRef.current) vigilanceInputRef.current.value = "";
    }
  }

  async function handleMarkVigilanceAlreadyInDrive() {
    if (!currentInvoice) return;
    setUploadingVigilance(true);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/invoices/${currentInvoice.id}/vigilance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alreadyInDrive: true,
            filename: "Attestation déjà présente dans Drive",
          }),
        }
      );
      if (res.ok) {
        setVigilanceAttached(true);
        setVigilanceName("Attestation déjà présente dans Drive");
        showToast("Attestation de vigilance confirmée dans Drive.");
      }
    } finally {
      setUploadingVigilance(false);
    }
  }

  const parsedHt = Number(amountHt) || 0;
  const needsVigilance = requiresVigilanceAttestation(parsedHt, parsedHt);

  const warnings = useMemo(
    () =>
      evaluateInvoiceVerificationWarnings({
        vendorName,
        invoiceNumber,
        invoiceDate,
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
      invoiceNumber,
      invoiceDate,
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
    invoiceNumber,
    invoiceDate,
    codeProjet: projectCodes.join("-"),
    vendorName,
    amountHt: parsedHt,
  });

  async function handleProceedToStep2() {
    if (!currentInvoice) return;
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

    setLoadingPreview(true);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/invoices/${currentInvoice.id}/email-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendorName: vendorName.trim(),
            invoiceNumber: invoiceNumber.trim(),
            invoiceDate: invoiceDate.trim(),
            amountHt: parsedHt,
            tvaAmount: 0,
            amountTtc: parsedHt,
            budgetLineId,
            projectCodes,
            multiProjectConfirmed: true,
          }),
        }
      );
      const json = (await res.json()) as EmailPreviewPayload & {
        error?: string;
      };
      if (!res.ok) {
        setModalError(
          json.error ?? "Impossible de préparer le brouillon d'email compta."
        );
        return;
      }
      setEmailPreview(json);
      setCcEntries(json.ccEntries ?? []);
      setEmailSubject(json.subject);
      setEmailBody(json.body);

      // Sync auto-updated nomenclature filename & verified fields locally
      const syncedItem: CockpitInvoiceItem = {
        ...currentInvoice,
        vendorName: vendorName.trim(),
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate: invoiceDate.trim(),
        amountHt: parsedHt,
        tvaAmount: 0,
        amountTtc: parsedHt,
        prestationLabel: prestationLabel.trim() || "Prestation",
        budgetLineId,
        quoteId: quoteId || null,
        projectCodesJson: JSON.stringify(projectCodes),
        renamedFilename: json.attachmentFilename || driveFilenamePreview,
      };
      setQueue((prev) =>
        prev.map((q) => (q.id === currentInvoice.id ? syncedItem : q))
      );
      setPendingList((prev) =>
        prev.map((p) => (p.id === currentInvoice.id ? syncedItem : p))
      );

      setStep(2);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirmAndCreateGmailDraft() {
    if (!currentInvoice) return;
    setSubmittingDraft(true);
    setModalError(null);
    try {
      const res = await fetch(
        `/api/projects/${project.id}/invoices/${currentInvoice.id}/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendorName: vendorName.trim(),
            invoiceNumber: invoiceNumber.trim(),
            invoiceDate: invoiceDate.trim(),
            amountHt: parsedHt,
            tvaAmount: 0,
            amountTtc: parsedHt,
            prestationLabel: prestationLabel.trim() || "Prestation",
            budgetLineId,
            quoteId: quoteId || null,
            projectCodes,
            multiProjectConfirmed: true,
            overrideCpConflict: true,
            ccEmails: ccEntries.map((c) => c.email),
            emailSubject: emailSubject.trim(),
            emailBody: emailBody.trim(),
          }),
        }
      );
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setModalError(
          json.error ?? "Erreur lors de la création du brouillon Gmail."
        );
        return;
      }

      showToast(
        `Facture ${invoiceNumber || currentInvoice.originalFilename} validée · 1 brouillon Gmail compta créé !`
      );
      setPendingList((prev) => prev.filter((p) => p.id !== currentInvoice.id));
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      router.refresh();

      // Advance to next invoice in batch (strictly 1 email per invoice)
      const nextIdx = queueIdx + 1;
      if (nextIdx < queue.length) {
        setQueueIdx(nextIdx);
        hydrateStep1(queue[nextIdx]);
      } else {
        closeModal();
      }
    } finally {
      setSubmittingDraft(false);
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

  function addCustomCc() {
    const clean = newCcEmail.trim().toLowerCase();
    if (!clean || !clean.includes("@")) return;
    if (ccEntries.some((c) => c.email === clean)) {
      setNewCcEmail("");
      return;
    }
    setCcEntries((prev) => [
      ...prev,
      {
        email: clean,
        label: "Ajouté manuellement",
        source: "CUSTOM",
        mandatory: false,
      },
    ]);
    setNewCcEmail("");
  }

  const currentPdfUrl = currentInvoice
    ? localBlobUrls[currentInvoice.id] ||
      `/api/projects/${project.id}/invoices/${currentInvoice.id}/preview`
    : "";

  return (
    <>
      {/* Quick-Action Drag & Drop Tile directly inside Cockpit "Accès rapides" */}
      <div
        data-testid="cockpit-invoice-dropzone"
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
            ? "border-rose-500 bg-rose-50/80 dark:border-rose-400 dark:bg-rose-500/20"
            : "border-rose-200/90 bg-rose-50/30 hover:border-rose-400 hover:bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/5 dark:hover:border-rose-400/60 dark:hover:bg-rose-500/10"
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
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          data-testid="cockpit-upload-invoice-btn"
          className="flex w-full items-center justify-between gap-2.5 text-left disabled:opacity-60"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white shadow-2xs">
              {uploading ? (
                <Upload className="h-4 w-4 animate-bounce" />
              ) : (
                <Receipt className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white">
                {uploading ? "Analyse PDF en cours..." : "Déposer facture PDF"}
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {uploadStatus ??
                  "Glisser-déposer ou cliquer · vérif ici sans changer d'écran"}
              </p>
            </div>
          </div>
          <Upload className="h-4 w-4 shrink-0 text-rose-500" />
        </button>

        {pendingList.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-rose-200/60 pt-2 dark:border-rose-500/20">
            <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
              {pendingList.length} facture{pendingList.length > 1 ? "s" : ""} à
              vérifier
            </span>
            <button
              type="button"
              onClick={() => openVerifierFor(pendingList, 0)}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
            >
              Ouvrir visionneuse
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* FULL-SCREEN PENNYLANE 2-STEP VERIFICATION MODAL */}
      {currentInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-xs sm:p-5"
        >
          <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#111827]">
            {/* Top Bar with Step Indicator & Batch Progress */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {step === 1
                        ? "Étape 1/2 · Vérification de la facture"
                        : "Étape 2/2 · Confirmation du brouillon Gmail compta"}
                    </h3>
                    {queue.length > 1 && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                        Facture {queueIdx + 1} / {queue.length} · 1 mail par
                        facture
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                      <Sparkles className="h-2.5 w-2.5" />
                      {driveFilenamePreview}
                    </span>
                    {currentInvoice.originalFilename !== driveFilenamePreview && (
                      <span className="truncate opacity-75">
                        (initial : {currentInvoice.originalFilename})
                      </span>
                    )}
                    <span>
                      · CP {project.codeProjet} ({project.client})
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {confirmDelete ? (
                  <div
                    data-testid="confirm-delete-invoice-bar"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200"
                  >
                    <span>Supprimer cette facture ?</span>
                    <button
                      type="button"
                      disabled={deletingInvoice}
                      onClick={() => void handleDeleteCurrentInvoice()}
                      data-testid="confirm-delete-invoice-yes"
                      className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {deletingInvoice ? "..." : "Oui"}
                    </button>
                    <button
                      type="button"
                      disabled={deletingInvoice}
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-slate-900 dark:text-rose-200"
                    >
                      Non
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={deletingInvoice || submittingDraft}
                    onClick={() => setConfirmDelete(true)}
                    data-testid="delete-invoice-in-modal-btn"
                    title="Supprimer cette facture si vous ne souhaitez plus la vérifier"
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </button>
                )}
                <a
                  href={currentPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Ouvrir PDF
                </a>
                <button
                  type="button"
                  onClick={() => closeModal(true)}
                  aria-label="Fermer"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Split-View Pennylane Body */}
            <div className="grid min-h-0 flex-1 lg:grid-cols-12">
              {/* LEFT (7 cols): Full-Height Embedded PDF Viewer */}
              <div className="flex min-h-[300px] flex-col border-b border-slate-200 bg-slate-100 lg:col-span-7 lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-950">
                <iframe
                  key={currentInvoice.id}
                  src={`${currentPdfUrl}#view=FitH`}
                  title={`Facture ${currentInvoice.originalFilename}`}
                  className="h-full w-full flex-1 border-0"
                />
              </div>

              {/* RIGHT (5 cols): Step 1 Form OR Step 2 Email Confirmation */}
              <div className="flex min-h-0 flex-col overflow-y-auto p-5 lg:col-span-5">
                {modalError && (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>{modalError}</span>
                  </div>
                )}

                {step === 1 ? (
                  <div className="space-y-4">
                    {/* Live Conditions Warning Checklist */}
                    {warnings.length > 0 ? (
                      <div
                        data-testid="invoice-verification-warnings"
                        className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                      >
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
                        Toutes les conditions de vérification sont remplies.
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
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          N° de facture (nomenclature 1, 2, 3...) *
                        </label>
                        <input
                          type="text"
                          value={invoiceNumber}
                          onChange={(e) => setInvoiceNumber(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        {supplierInvoiceRef &&
                          supplierInvoiceRef !== invoiceNumber.trim() && (
                            <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                              Réf. fournisseur PDF : {supplierInvoiceRef}
                            </p>
                          )}
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          Date d&apos;émission *
                        </label>
                        <input
                          type="date"
                          value={invoiceDate}
                          onChange={(e) => setInvoiceDate(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs tabular-nums text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          Prestation
                        </label>
                        <input
                          type="text"
                          value={prestationLabel}
                          onChange={(e) => setPrestationLabel(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
                            className="h-3.5 w-3.5 accent-rose-600"
                          />
                          Je confirme les codes projet (facture multi-projets /
                          CP vérifié)
                        </label>
                      )}
                    </div>

                    {/* Budget Line + Quote */}
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          Poste budgétaire *
                        </label>
                        <select
                          value={budgetLineId}
                          onChange={(e) => setBudgetLineId(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">— Choisir un poste —</option>
                          {budgetLines.map((line) => (
                            <option key={line.id} value={line.id}>
                              {line.category} — {line.objet} (Reste :{" "}
                              {formatEur(
                                line.preOpTotalHt - line.postOpTotalHt
                              )}
                              )
                            </option>
                          ))}
                        </select>
                      </div>

                      {quotes.length > 0 && (
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Devis associé (optionnel)
                          </label>
                          <select
                            value={quoteId}
                            onChange={(e) => {
                              const qId = e.target.value;
                              setQuoteId(qId);
                              const q = quotes.find((item) => item.id === qId);
                              if (q?.budgetLineId && !budgetLineId) {
                                setBudgetLineId(q.budgetLineId);
                              }
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
                      )}
                    </div>

                    {/* > 3 000 € Attestation de Vigilance Reminder & Drive Upload */}
                    {needsVigilance && (
                      <div
                        data-testid="vigilance-attestation-box"
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
                              Facture &gt; 3 000 € · Attestation de vigilance
                              (URSSAF)
                            </p>
                            <p className="mt-0.5 text-[11px] opacity-90">
                              {vigilanceAttached
                                ? `Attestation jointe dans Drive : ${vigilanceName ?? "OK"}`
                                : "Rappel obligatoire : joignez l'attestation de vigilance du prestataire dans les fichiers Google Drive (001.3 Factures)."}
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
                              if (f) void handleVigilanceFileUpload(f);
                            }}
                          />
                          <button
                            type="button"
                            disabled={uploadingVigilance}
                            onClick={() => vigilanceInputRef.current?.click()}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            {uploadingVigilance
                              ? "Envoi Drive..."
                              : vigilanceAttached
                                ? "Remplacer l'attestation"
                                : "Joindre l'attestation dans Drive"}
                          </button>
                          {!vigilanceAttached && (
                            <button
                              type="button"
                              disabled={uploadingVigilance}
                              onClick={() =>
                                void handleMarkVigilanceAlreadyInDrive()
                              }
                              className="rounded-lg border border-current/25 px-2.5 py-1.5 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10"
                            >
                              Déjà dans Drive
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Drive Nomenclature Preview */}
                    <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                      <span className="font-semibold">
                        Fichier déposé Drive :{" "}
                      </span>
                      <code className="break-all font-mono">
                        {driveFilenamePreview}
                      </code>
                    </div>

                    {/* Explicit Warning Override Checkbox if non-blocking warnings remain */}
                    {alertWarnings.length > 0 && blockingErrors.length === 0 && (
                      <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        <input
                          type="checkbox"
                          checked={acknowledgeWarnings}
                          onChange={(e) =>
                            setAcknowledgeWarnings(e.target.checked)
                          }
                          className="mt-0.5 h-3.5 w-3.5 accent-rose-600"
                        />
                        <span>
                          J&apos;ai bien pris connaissance des alertes ci-dessus
                          et je souhaite quand même préparer le brouillon compta.
                        </span>
                      </label>
                    )}

                    {/* Step 1 -> Step 2 CTA */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      <button
                        type="button"
                        disabled={deletingInvoice}
                        onClick={() => setConfirmDelete(true)}
                        className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-500/30 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-500/15"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => closeModal(true)}
                          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          Fermer
                        </button>
                        <button
                          type="button"
                          disabled={loadingPreview || blockingErrors.length > 0}
                          onClick={() => void handleProceedToStep2()}
                          data-testid="step1-confirm-verify-btn"
                          className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
                        >
                          {loadingPreview
                            ? "Préparation du mail..."
                            : "Valider vérification & prévisualiser le mail"}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* STEP 2: SECOND CONFIRMATION — GMAIL DRAFT TO ACCOUNTING */
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                      <p className="flex items-center gap-1.5 font-bold">
                        <Mail className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Confirmation d&apos;envoi en brouillon Gmail (1 facture
                        = 1 mail)
                      </p>
                      <p className="mt-1 text-[11px]">
                        Vérifiez le destinataire, les CC (compta + chefs de
                        projet), l&apos;objet et le message avant de créer le
                        brouillon dans Gmail.
                      </p>
                    </div>

                    {/* Destinataire (To) */}
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Destinataire (Compta Pennylane)
                      </label>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100">
                        {emailPreview?.to ??
                          "gamersorigin-8j117x7x@suppliers.pennylane.com"}
                      </div>
                    </div>

                    {/* CC List (Mandatory Compta + Project PMs + COMPTA role) */}
                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        En copie (CC) — Compta &amp; Chefs de projet (
                        {ccEntries.length})
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {ccEntries.map((entry) => (
                          <span
                            key={entry.email}
                            title={entry.label}
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                              entry.mandatory
                                ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            }`}
                          >
                            <span className="font-mono">{entry.email}</span>
                            <span className="text-[10px] opacity-75">
                              ({entry.source === "MANDATORY_COMPTA" ? "Compta" : entry.source === "PROJECT_PM" ? "CP" : entry.source === "ROLE_COMPTA" ? "Compta" : "CC"})
                            </span>
                            {!entry.mandatory && (
                              <button
                                type="button"
                                onClick={() =>
                                  setCcEntries((prev) =>
                                    prev.filter((c) => c.email !== entry.email)
                                  )
                                }
                                className="hover:text-rose-600"
                                aria-label={`Retirer ${entry.email}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="email"
                          value={newCcEmail}
                          onChange={(e) => setNewCcEmail(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomCc();
                            }
                          }}
                          placeholder="Ajouter une adresse en CC..."
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={addCustomCc}
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Subject */}
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Objet du mail
                      </label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    {/* Body */}
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Contenu du mail
                      </label>
                      <textarea
                        rows={6}
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 focus:border-rose-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </div>

                    {/* Single Attachment Pill */}
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/50">
                      <FileText className="h-4 w-4 shrink-0 text-rose-500" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase dark:text-slate-400">
                          Pièce jointe unique (1 facture par mail)
                        </p>
                        <p className="truncate font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                          {emailPreview?.attachmentFilename ??
                            driveFilenamePreview}
                        </p>
                      </div>
                    </div>

                    {/* Step 2 Buttons */}
                    <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      <button
                        type="button"
                        disabled={submittingDraft}
                        onClick={() => setStep(1)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Retour
                      </button>

                      <button
                        type="button"
                        disabled={submittingDraft}
                        onClick={() => void handleConfirmAndCreateGmailDraft()}
                        data-testid="step2-create-gmail-draft-btn"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        <Mail className="h-4 w-4" />
                        {submittingDraft
                          ? "Création du brouillon..."
                          : "Confirmer et créer le brouillon Gmail"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
