"use client";

import {
  AlertTriangle,
  Check,
  Eye,
  FileText,
  Link2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  type BudgetLineDto,
  type InvoiceDto,
  type QuoteDto,
  formatEur,
} from "@/components/budget/types";
import { Modal } from "@/components/ui/Modal";
import { PdfPreviewModal } from "@/components/ui/PdfPreviewModal";
import { showToast } from "@/lib/toast";

interface QuotesPanelProps {
  projectId: string;
  budgetLines: BudgetLineDto[];
  invoices: InvoiceDto[];
  quotes: QuoteDto[];
  onRefresh: () => Promise<void>;
  onError: (status: number, payload: { error?: string; code?: string }) => void;
}

const QUOTE_STATUS_META: Record<
  string,
  { label: string; badge: string }
> = {
  BROUILLON: {
    label: "Brouillon",
    badge:
      "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  EN_ATTENTE: {
    label: "En attente",
    badge:
      "bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  },
  ACCEPTE: {
    label: "Accepté",
    badge:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  },
  FACTURE: {
    label: "Facturé",
    badge:
      "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30",
  },
  REFUSE: {
    label: "Refusé",
    badge:
      "bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  },
};

export function QuotesPanel({
  projectId,
  budgetLines,
  invoices,
  quotes,
  onRefresh,
  onError,
}: QuotesPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [quoteNumber, setQuoteNumber] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [issueDate, setIssueDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [validUntil, setValidUntil] = useState("");
  const [amountHt, setAmountHt] = useState("");
  const [status, setStatus] = useState("EN_ATTENTE");
  const [budgetLineId, setBudgetLineId] = useState("");
  const [notes, setNotes] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [selectedNewInvoices, setSelectedNewInvoices] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Link invoices modal per quote
  const [linkingQuote, setLinkingQuote] = useState<QuoteDto | null>(null);
  const [linkingIds, setLinkingIds] = useState<string[]>([]);
  const [savingLinks, setSavingLinks] = useState(false);

  // Preview PDF modal (either quote PDF or linked invoice PDF)
  const [previewModal, setPreviewModal] = useState<{
    title: string;
    url: string;
    driveUrl?: string | null;
  } | null>(null);

  const filteredQuotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return quotes.filter((item) => {
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      if (!q) return true;
      return (
        item.quoteNumber.toLowerCase().includes(q) ||
        item.vendorName.toLowerCase().includes(q) ||
        (item.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [quotes, searchQuery, statusFilter]);

  async function handleQuotePdfPick(file: File | null) {
    setPdfFile(file);
    if (!file) return;
    setExtractingPdf(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/quotes/extract`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        extracted?: {
          quoteNumber?: string;
          vendorName?: string;
          issueDate?: string;
          amountHt?: number;
          description?: string;
          suggestedBudgetLineId?: string | null;
        };
      };
      const ex = json.extracted;
      if (!ex) return;
      if (ex.quoteNumber && !quoteNumber) setQuoteNumber(ex.quoteNumber);
      if (ex.vendorName && !vendorName) setVendorName(ex.vendorName);
      if (ex.issueDate) setIssueDate(ex.issueDate);
      if (ex.amountHt && ex.amountHt > 0 && !amountHt) {
        setAmountHt(String(ex.amountHt));
      }
      if (ex.description && !description) setDescription(ex.description);
      if (ex.suggestedBudgetLineId && !budgetLineId) {
        setBudgetLineId(ex.suggestedBudgetLineId);
      }
      showToast("Devis PDF analysé : champs pré-remplis automatiquement !");
    } finally {
      setExtractingPdf(false);
    }
  }

  const acceptedTotalHt = quotes
    .filter((q) => q.status === "ACCEPTE" || q.status === "FACTURE")
    .reduce((s, q) => s + q.amountHt, 0);
  const invoicedTotalHt = quotes.reduce((s, q) => s + q.invoicedTotalHt, 0);
  const remainingTotalHt = Math.max(0, acceptedTotalHt - invoicedTotalHt);

  async function handleCreateQuote(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("quoteNumber", quoteNumber.trim());
      formData.append("vendorName", vendorName.trim());
      formData.append("description", description.trim());
      formData.append("issueDate", issueDate);
      formData.append("validUntil", validUntil);
      formData.append("amountHt", String(Number(amountHt) || 0));
      formData.append("status", status);
      formData.append("budgetLineId", budgetLineId);
      formData.append("notes", notes.trim());
      if (selectedNewInvoices.length > 0) {
        formData.append(
          "linkedInvoiceIds",
          JSON.stringify(selectedNewInvoices)
        );
      }
      if (pdfFile) {
        formData.append("file", pdfFile);
      }

      const res = await fetch(`/api/projects/${projectId}/quotes`, {
        method: "POST",
        body: formData,
      });
      const json = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        onError(res.status, json);
        return;
      }
      setQuoteNumber("");
      setVendorName("");
      setDescription("");
      setValidUntil("");
      setAmountHt("");
      setBudgetLineId("");
      setNotes("");
      setPdfFile(null);
      setSelectedNewInvoices([]);
      setShowCreate(false);
      showToast("Devis ajouté !");
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(quote: QuoteDto, nextStatus: string) {
    const res = await fetch(`/api/projects/${projectId}/quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string; code?: string };
      onError(res.status, err);
      return;
    }
    showToast("Statut du devis mis à jour.");
    await onRefresh();
  }

  async function handleSaveLinks() {
    if (!linkingQuote) return;
    setSavingLinks(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/quotes/${linkingQuote.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linkedInvoiceIds: linkingIds }),
        }
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string; code?: string };
        onError(res.status, err);
        return;
      }
      setLinkingQuote(null);
      showToast(`${linkingIds.length} facture(s) reliée(s) au devis.`);
      await onRefresh();
    } finally {
      setSavingLinks(false);
    }
  }

  async function handleDeleteQuote(quote: QuoteDto) {
    const res = await fetch(`/api/projects/${projectId}/quotes/${quote.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string; code?: string };
      onError(res.status, err);
      return;
    }
    showToast("Devis supprimé.", "info");
    await onRefresh();
  }

  return (
    <section className="space-y-5">
      {/* Summary Strip */}
      <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:grid-cols-3 dark:border-slate-800 dark:bg-[#111827]">
        <div>
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Devis acceptés / facturés (HT)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-white">
            {formatEur(acceptedTotalHt)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Déjà facturé sur devis (HT)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-indigo-600 dark:text-indigo-400">
            {formatEur(invoicedTotalHt)}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Reste à facturer sur devis
            </p>
            <p className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {formatEur(remainingTotalHt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            data-testid="toggle-create-quote-btn"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            {showCreate ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showCreate ? "Fermer" : "Nouveau devis"}
          </button>
        </div>
      </div>

      {/* Create Quote Form */}
      {showCreate && (
        <form
          onSubmit={(e) => void handleCreateQuote(e)}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-[#111827]"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Enregistrer un devis prestataire
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                N° Devis *
              </label>
              <input
                type="text"
                required
                placeholder="ex : DEV-2026-014"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Prestataire *
              </label>
              <input
                type="text"
                required
                placeholder="ex : Vertigo Studio"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Montant HT (€) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="0.00"
                value={amountHt}
                onChange={(e) => setAmountHt(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Statut
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="BROUILLON">Brouillon</option>
                <option value="EN_ATTENTE">En attente</option>
                <option value="ACCEPTE">Accepté</option>
                <option value="FACTURE">Facturé</option>
                <option value="REFUSE">Refusé</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Objet / Prestation
              </label>
              <input
                type="text"
                placeholder="ex : Développement map + HUD"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Date d&apos;émission
              </label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Poste budgétaire
              </label>
              <select
                value={budgetLineId}
                onChange={(e) => setBudgetLineId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="">— Optionnel —</option>
                {budgetLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.category} — {l.objet}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:border-indigo-500 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300">
              {extractingPdf ? (
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              <span>
                {extractingPdf
                  ? "Analyse OCR du devis PDF…"
                  : pdfFile
                    ? `PDF joint : ${pdfFile.name}`
                    : "Déposer un devis PDF (OCR auto-remplissage)"}
              </span>
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                onChange={(e) =>
                  void handleQuotePdfPick(e.target.files?.[0] ?? null)
                }
              />
            </label>

            <button
              type="submit"
              disabled={saving || extractingPdf}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "Enregistrement..." : "Créer le devis"}
            </button>
          </div>
        </form>
      )}

      {/* Search & Status Filter Bar */}
      {quotes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un devis ou prestataire…"
              className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-[#111827] dark:text-white dark:placeholder:text-slate-400"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {[
              { id: "ALL", label: "Tous" },
              { id: "EN_ATTENTE", label: "En attente" },
              { id: "ACCEPTE", label: "Acceptés" },
              { id: "FACTURE", label: "Facturés" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  statusFilter === tab.id
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quotes List */}
      {filteredQuotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-[#111827]">
          <FileText className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-2.5 text-sm font-semibold text-slate-800 dark:text-white">
            {quotes.length === 0
              ? "Aucun devis pour ce projet"
              : "Aucun devis ne correspond à ce filtre"}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ajoutez vos devis prestataires (PDF OCR automatique) et reliez-les à
            une ou plusieurs factures (acompte, solde...) pour suivre le reste à
            facturer.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredQuotes.map((q) => {
            const meta = QUOTE_STATUS_META[q.status] ?? QUOTE_STATUS_META.EN_ATTENTE;
            return (
              <div
                key={q.id}
                data-testid={`quote-card-${q.id}`}
                className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                        {q.quoteNumber}
                      </span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {q.vendorName}
                      </span>
                      {q.overQuote && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                          <AlertTriangle className="h-3 w-3" />
                          Dépasse le devis
                        </span>
                      )}
                    </div>
                    {q.description && (
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {q.description}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {q.issueDate ? `Émis le ${q.issueDate}` : "Date non renseignée"}
                      {q.budgetLine
                        ? ` · Poste : ${q.budgetLine.category} — ${q.budgetLine.objet}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {q.hasPdf && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewModal({
                            title: `Devis ${q.quoteNumber} — ${q.vendorName}`,
                            url: `/api/projects/${projectId}/quotes/${q.id}/preview`,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <Eye className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        PDF Devis
                      </button>
                    )}

                    <select
                      aria-label={`Statut du devis ${q.quoteNumber}`}
                      value={q.status}
                      onChange={(e) => void handleStatusChange(q, e.target.value)}
                      className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none ${meta.badge}`}
                    >
                      <option value="BROUILLON">Brouillon</option>
                      <option value="EN_ATTENTE">En attente</option>
                      <option value="ACCEPTE">Accepté</option>
                      <option value="FACTURE">Facturé</option>
                      <option value="REFUSE">Refusé</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        setLinkingQuote(q);
                        setLinkingIds(q.invoices.map((i) => i.id));
                      }}
                      data-testid={`link-invoices-btn-${q.id}`}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Relier factures ({q.invoices.length})
                    </button>

                    {confirmDeleteId === q.id ? (
                      <div className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200">
                        <span>Supprimer ?</span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(null);
                            void handleDeleteQuote(q);
                          }}
                          className="rounded bg-rose-600 px-1.5 py-0.5 text-white hover:bg-rose-700"
                        >
                          Oui
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded border border-rose-300 bg-white px-1.5 py-0.5 text-rose-700 dark:bg-slate-900 dark:text-rose-200"
                        >
                          Non
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(q.id)}
                        title="Supprimer le devis"
                        aria-label={`Supprimer le devis ${q.quoteNumber}`}
                        className="rounded-xl p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Quote Amount & Progress */}
                <div className="mt-4 grid gap-3 rounded-xl bg-slate-50/80 p-3 text-xs sm:grid-cols-3 dark:bg-slate-800/40">
                  <div>
                    <span className="text-[11px] text-slate-400">Montant devis HT</span>
                    <p className="font-mono font-bold text-slate-900 dark:text-white">
                      {formatEur(q.amountHt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400">
                      Facturé relié ({q.invoicedPct}%)
                    </span>
                    <p
                      className={`font-mono font-bold ${
                        q.overQuote
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-indigo-600 dark:text-indigo-400"
                      }`}
                    >
                      {formatEur(q.invoicedTotalHt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400">Reste sur devis</span>
                    <p
                      className={`font-mono font-bold ${
                        q.remainingHt < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {formatEur(q.remainingHt)}
                    </p>
                  </div>
                </div>

                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    style={{ width: `${Math.min(100, q.invoicedPct)}%` }}
                    className={`h-full rounded-full ${
                      q.overQuote ? "bg-rose-500" : "bg-indigo-600"
                    }`}
                  />
                </div>

                {/* Linked Invoices list */}
                {q.invoices.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Factures reliées ({q.invoices.length}) ·{" "}
                      <span className="font-mono">
                        {q.invoices
                          .map((inv) => formatEur(inv.amountHt))
                          .join(" + ")}{" "}
                        = {formatEur(q.invoicedTotalHt)}
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {q.invoices.map((inv) => (
                        <div
                          key={inv.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800/70"
                        >
                          <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                            {inv.invoiceNumber || inv.originalFilename}
                          </span>
                          <span className="text-slate-500">
                            {formatEur(inv.amountHt)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewModal({
                                title: `Facture ${inv.invoiceNumber ?? inv.originalFilename}`,
                                url: `/api/projects/${projectId}/invoices/${inv.id}/preview`,
                                driveUrl: inv.driveFileId
                                  ? `https://drive.google.com/file/d/${inv.driveFileId}/view`
                                  : null,
                              })
                            }
                            className="inline-flex items-center gap-0.5 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            <Eye className="h-3 w-3" />
                            Voir
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Link Invoices Modal */}
      <Modal
        open={Boolean(linkingQuote)}
        onClose={() => setLinkingQuote(null)}
        ariaLabel="Relier des factures au devis"
        maxWidthClass="max-w-lg"
      >
        {linkingQuote && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Relier des factures au devis {linkingQuote.quoteNumber}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {linkingQuote.vendorName} · {formatEur(linkingQuote.amountHt)}{" "}
                  HT — cochez une ou plusieurs factures (acompte, solde…).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLinkingQuote(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
              {invoices.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  Aucune facture disponible sur ce projet.
                </p>
              ) : (
                invoices.map((inv) => {
                  const checked = linkingIds.includes(inv.id);
                  const otherQuote =
                    inv.quoteId && inv.quoteId !== linkingQuote.id
                      ? quotes.find((x) => x.id === inv.quoteId)
                      : null;
                  return (
                    <label
                      key={inv.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-xs transition-colors ${
                        checked
                          ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-500/50 dark:bg-indigo-500/10"
                          : "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setLinkingIds((prev) =>
                              prev.includes(inv.id)
                                ? prev.filter((x) => x !== inv.id)
                                : [...prev, inv.id]
                            )
                          }
                          className="h-4 w-4 accent-indigo-600"
                        />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {inv.invoiceNumber || inv.originalFilename}{" "}
                            <span className="font-normal text-slate-500">
                              · {inv.vendorName || "Prestataire"}
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {inv.invoiceDate || "—"} · {inv.status}
                            {otherQuote
                              ? ` · Actuellement liée au devis ${otherQuote.quoteNumber}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono font-bold text-slate-800 dark:text-slate-100">
                        {formatEur(inv.amountHt)}
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
              <span className="text-xs text-slate-500">
                Total sélectionné :{" "}
                <strong className="font-mono text-slate-900 dark:text-white">
                  {formatEur(
                    invoices
                      .filter((i) => linkingIds.includes(i.id))
                      .reduce((s, i) => s + i.amountHt, 0)
                  )}
                </strong>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLinkingQuote(null)}
                  className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={savingLinks}
                  onClick={() => void handleSaveLinks()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {savingLinks ? "Enregistrement..." : "Valider les liens"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Accessible PDF Preview Modal */}
      <PdfPreviewModal
        open={Boolean(previewModal)}
        title={previewModal?.title ?? "Aperçu PDF"}
        previewUrl={previewModal?.url ?? ""}
        driveUrl={previewModal?.driveUrl ?? null}
        onClose={() => setPreviewModal(null)}
      />
    </section>
  );
}
