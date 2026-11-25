"use client";

import { ExternalLink, FileText, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface PdfPreviewModalProps {
  open: boolean;
  title: string;
  subtitle?: string | null;
  previewUrl: string;
  driveUrl?: string | null;
  onClose: () => void;
}

export function PdfPreviewModal({
  open,
  title,
  subtitle,
  previewUrl,
  driveUrl,
  onClose,
}: PdfPreviewModalProps) {
  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="flex h-[84vh] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                {title}
              </h3>
              {subtitle && (
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {driveUrl && (
              <a
                href={driveUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Drive
              </a>
            )}
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ouvrir
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer l'aperçu PDF"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-100 dark:bg-slate-950">
          <iframe
            src={previewUrl}
            title={title}
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </Modal>
  );
}
