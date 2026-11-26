"use client";

import { ExternalLink, Image as ImageIcon } from "lucide-react";

export interface WeeklyVisualView {
  id: string;
  code: string;
  name: string;
  driveFileId: string | null;
  mimeType: string | null;
}

const MAX_WEEKLY_VISUALS = 3;

export function VisualPicker({
  visuals,
  selectedIds,
  onToggle,
}: {
  visuals: WeeklyVisualView[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const limitReached = selectedIds.length >= MAX_WEEKLY_VISUALS;

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 dark:border-slate-800/80">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Visuels à intégrer
          </h2>
        </div>
        <span
          className={`text-xs font-medium ${
            selectedIds.length >= MAX_WEEKLY_VISUALS
              ? "text-indigo-600 dark:text-indigo-400"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {selectedIds.length} / {MAX_WEEKLY_VISUALS} max sur Slides
        </span>
      </div>

      {visuals.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
          Aucune image trouvée dans le dossier Production. Le Weekly sera créé
          sans visuel.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {visuals.map((v) => {
            const checked = selectedIds.includes(v.id);
            const disabled = !checked && limitReached;
            return (
              <label
                key={v.id}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs transition-colors ${
                  checked
                    ? "cursor-pointer border-indigo-200 bg-indigo-50/50 dark:border-indigo-500/30 dark:bg-indigo-500/15"
                    : disabled
                      ? "cursor-not-allowed border-slate-100 bg-slate-50/40 opacity-50 dark:border-slate-800/60 dark:bg-slate-900/40"
                      : "cursor-pointer border-slate-100 bg-slate-50/60 hover:bg-slate-50 dark:border-slate-800/80 dark:bg-slate-800/60 dark:hover:bg-slate-800/70"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      if (!disabled) onToggle(v.id);
                    }}
                    className="h-4 w-4 shrink-0 accent-indigo-600"
                  />
                  <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                    {v.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {v.code}
                  </span>
                  {v.driveFileId && (
                    <a
                      href={`https://drive.google.com/file/d/${v.driveFileId}/view`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Prévisualiser dans Google Drive"
                      className="rounded p-1 text-slate-500 hover:bg-white hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-indigo-400"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
