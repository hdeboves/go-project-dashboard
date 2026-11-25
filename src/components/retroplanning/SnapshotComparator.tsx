"use client";

import { Camera, GitCompareArrows } from "lucide-react";
import { useState } from "react";

export interface RetroSnapshotView {
  id: string;
  snapshotDate: string;
  driveFileId: string | null;
  tasksJson: string;
  createdAt: string;
}

export interface SnapshotDiffItemView {
  taskId: string;
  phase: string;
  tache: string;
  fromEndDate: string | null;
  toEndDate: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  deltaDays: number;
  classification: string;
  label: string;
}

export interface SnapshotComparisonView {
  fromSnapshot: { id: string; snapshotDate: string };
  toSnapshot: { id: string; snapshotDate: string };
  summary: {
    total: number;
    delayedCount: number;
    aheadCount: number;
    onTimeCount: number;
    completedCount: number;
    addedCount: number;
    removedCount: number;
  };
  diffs: SnapshotDiffItemView[];
}

export function SnapshotComparator({
  snapshots,
  comparison,
  creatingSnapshot,
  comparing,
  onCreateSnapshot,
  onCompareSnapshots,
}: {
  snapshots: RetroSnapshotView[];
  comparison: SnapshotComparisonView | null;
  creatingSnapshot: boolean;
  comparing: boolean;
  onCreateSnapshot: () => Promise<void>;
  onCompareSnapshots: (fromId: string, toId: string) => Promise<void>;
}) {
  const [fromId, setFromId] = useState<string>(
    snapshots[1]?.id ?? snapshots[0]?.id ?? ""
  );
  const [toId, setToId] = useState<string>(snapshots[0]?.id ?? "");

  const effectiveFromId =
    fromId && snapshots.some((s) => s.id === fromId)
      ? fromId
      : (snapshots[1]?.id ?? snapshots[0]?.id ?? "");
  const effectiveToId =
    toId && snapshots.some((s) => s.id === toId)
      ? toId
      : (snapshots[0]?.id ?? "");

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800/80">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Historique & comparaison des dates
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Enregistrez des points d&apos;étape (tous les 14 jours) pour repérer
            les décalages au fil du projet.
          </p>
        </div>

        <button
          type="button"
          disabled={creatingSnapshot}
          onClick={() => void onCreateSnapshot()}
          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          <Camera className="h-3.5 w-3.5" />
          {creatingSnapshot ? "Enregistrement..." : "Archiver la version du jour"}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Aucune archive pour le moment. Cliquez sur « Archiver la version du
          jour » pour créer votre premier point de repère.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <div className="min-w-[180px] flex-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Version A (avant)
              </label>
              <select
                aria-label="Snapshot Date A"
                value={effectiveFromId}
                onChange={(e) => setFromId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    Version du {s.snapshotDate.slice(0, 10)}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[180px] flex-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Version B (après)
              </label>
              <select
                aria-label="Snapshot Date B"
                value={effectiveToId}
                onChange={(e) => setToId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    Version du {s.snapshotDate.slice(0, 10)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={!effectiveFromId || !effectiveToId || comparing}
              onClick={() =>
                void onCompareSnapshots(effectiveFromId, effectiveToId)
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500"
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              {comparing ? "Comparaison..." : "Comparer"}
            </button>
          </div>

          {comparison && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-rose-50 px-3 py-1 font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {comparison.summary.delayedCount} retard(s)
                </span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {comparison.summary.aheadCount} avance(s)
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {comparison.summary.onTimeCount} à l&apos;heure
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                      <th className="px-3.5 py-2.5 font-semibold">Tâche</th>
                      <th className="px-3 py-2.5 font-semibold">Avant</th>
                      <th className="px-3 py-2.5 font-semibold">Après</th>
                      <th className="px-3 py-2.5 font-semibold">Écart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800/80 dark:bg-[#111827]">
                    {comparison.diffs.map((d) => {
                      const pillClass =
                        d.deltaDays > 0
                          ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                          : d.deltaDays < 0
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : d.classification === "ADDED"
                              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";

                      return (
                        <tr key={`${d.taskId}-${d.tache}`}>
                          <td className="px-3.5 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                            {d.tache}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {d.fromEndDate ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                            {d.toEndDate ?? "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pillClass}`}
                            >
                              {d.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
