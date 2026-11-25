"use client";

import { Image as ImageIcon } from "lucide-react";

export interface WeeklyVisualView {
  id: string;
  code: string;
  name: string;
  driveFileId: string | null;
  mimeType: string | null;
}

export function VisualPicker({
  visuals,
  selectedIds,
  onToggle,
}: {
  visuals: WeeklyVisualView[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="flex items-center justify-between border-b border-[#232b3d] pb-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-amber-400" />
          <h2 className="text-base font-bold text-white">
            Visuels 004. Production (PNG / JPG)
          </h2>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          {selectedIds.length} sélectionné(s)
        </span>
      </div>

      {visuals.length === 0 ? (
        <p className="mt-4 text-xs text-slate-400">
          Aucune image PNG/JPG trouvée dans <code className="font-mono">004. Production</code>. Le deck sera généré sans visuel inséré.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {visuals.map((v) => {
            const checked = selectedIds.includes(v.id);
            return (
              <label
                key={v.id}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-xs hover:border-cyan-500/40"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(v.id)}
                  />
                  <span className="truncate font-medium text-white">{v.name}</span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">
                  {v.code}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
