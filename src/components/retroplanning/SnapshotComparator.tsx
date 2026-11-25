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
  const [fromId, setFromId] = useState<string>(snapshots[1]?.id ?? snapshots[0]?.id ?? "");
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
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232b3d] pb-3">
        <div>
          <h2 className="text-base font-bold text-white">
            Snapshots 14 jours (002.2) & Comparateur de Dérives
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Archivage strictement interne dans <span className="font-mono">002.2 Historique Rétroplanning</span> et comparaison visuelle entre deux dates
          </p>
        </div>

        <button
          type="button"
          disabled={creatingSnapshot}
          onClick={() => void onCreateSnapshot()}
          className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-[#232b3d] disabled:opacity-50"
        >
          <Camera className="h-3.5 w-3.5 text-cyan-400" />
          {creatingSnapshot ? "Archivage..." : "Créer Snapshot 14j"}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <p className="mt-4 text-xs text-slate-400">
          Aucun snapshot archivé pour le moment (0 snapshot). Créez un premier cliché ci-dessus.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#232b3d] bg-[#171d2b] p-3">
            <div className="min-w-[190px] flex-1">
              <label className="block text-[10px] font-semibold text-slate-400">
                Date A (référence)
              </label>
              <select
                aria-label="Snapshot Date A"
                value={effectiveFromId}
                onChange={(e) => setFromId(e.target.value)}
                className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 font-mono text-xs text-white"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.snapshotDate.slice(0, 10)} ({s.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[190px] flex-1">
              <label className="block text-[10px] font-semibold text-slate-400">
                Date B (comparaison)
              </label>
              <select
                aria-label="Snapshot Date B"
                value={effectiveToId}
                onChange={(e) => setToId(e.target.value)}
                className="mt-1 w-full rounded border border-[#232b3d] bg-[#0d111a] px-2.5 py-1.5 font-mono text-xs text-white"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.snapshotDate.slice(0, 10)} ({s.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={!effectiveFromId || !effectiveToId || comparing}
              onClick={() => void onCompareSnapshots(effectiveFromId, effectiveToId)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              {comparing ? "Comparaison..." : "Comparer"}
            </button>
          </div>

          {snapshots.length === 1 && !comparison && (
            <p className="text-xs text-slate-400">
              1 snapshot archivé ({snapshots[0].snapshotDate.slice(0, 10)}). Créez un second snapshot ultérieur pour mesurer les dérives.
            </p>
          )}

          {comparison && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 font-mono text-red-300">
                  {comparison.summary.delayedCount} retard(s)
                </span>
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-emerald-300">
                  {comparison.summary.aheadCount} avance(s)
                </span>
                <span className="rounded-full border border-slate-600 bg-slate-800/70 px-2.5 py-0.5 font-mono text-slate-300">
                  {comparison.summary.onTimeCount} à l&apos;heure
                </span>
                <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-cyan-300">
                  +{comparison.summary.addedCount} / -{comparison.summary.removedCount}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#232b3d] text-[11px] text-slate-400">
                      <th className="py-2 pr-3">Tâche</th>
                      <th className="py-2 pr-3">Fin Date A</th>
                      <th className="py-2 pr-3">Fin Date B</th>
                      <th className="py-2 pr-3">Dérive</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232b3d]/60">
                    {comparison.diffs.map((d) => {
                      const pillClass =
                        d.deltaDays > 0
                          ? "border-red-500/40 bg-red-500/15 text-red-300"
                          : d.deltaDays < 0
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : d.classification === "ADDED"
                              ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                              : d.classification === "REMOVED"
                                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                                : "border-slate-600 bg-slate-800/70 text-slate-300";

                      return (
                        <tr key={`${d.taskId}-${d.tache}`}>
                          <td className="py-2 pr-3 font-medium text-white">{d.tache}</td>
                          <td className="py-2 pr-3 font-mono text-[11px] text-slate-400">
                            {d.fromEndDate ?? "—"}
                          </td>
                          <td className="py-2 pr-3 font-mono text-[11px] text-slate-300">
                            {d.toEndDate ?? "—"}
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${pillClass}`}
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
