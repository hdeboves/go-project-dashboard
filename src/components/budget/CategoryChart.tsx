"use client";

import { BarChart3 } from "lucide-react";
import {
  type CategoryBreakdownDto,
  formatEur,
} from "@/components/budget/types";

interface CategoryChartProps {
  categories: CategoryBreakdownDto[];
}

export function CategoryChart({ categories }: CategoryChartProps) {
  const maxVal = Math.max(
    1,
    ...categories.flatMap((c) => [
      c.soldTotalHt,
      c.preOpTotalHt,
      c.postOpTotalHt,
    ])
  );

  return (
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-base font-semibold text-white">
            Répartition par catégorie
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-cyan-500" />
            Vendu HT
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
            Pré-op prévu
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#e11d48]" />
            Post-op réel
          </span>
        </div>
      </div>

      {categories.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">
          Aucune catégorie budgétaire à afficher. Importez un budget ou ajoutez
          une ligne.
        </p>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => {
            const soldW = Math.min(100, (cat.soldTotalHt / maxVal) * 100);
            const preW = Math.min(100, (cat.preOpTotalHt / maxVal) * 100);
            const postW = Math.min(100, (cat.postOpTotalHt / maxVal) * 100);
            const isCrit =
              (cat.preOpTotalHt > 0 && cat.postOpTotalHt >= cat.preOpTotalHt) ||
              (cat.preOpTotalHt === 0 && cat.postOpTotalHt > 0);
            const isWarn = !isCrit && cat.consumptionPct >= 85;

            return (
              <div
                key={cat.category}
                className="rounded-lg border border-[#232b3d]/80 bg-[#171d2b]/60 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {cat.category}
                    </span>
                    <span className="rounded bg-[#090b10] px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
                      {cat.lineCount} poste(s)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs">
                    <span className="text-cyan-300">
                      Vendu : {formatEur(cat.soldTotalHt)}
                    </span>
                    <span className="text-amber-300">
                      Pré-op : {formatEur(cat.preOpTotalHt)}
                    </span>
                    <span className="text-rose-300">
                      Post-op : {formatEur(cat.postOpTotalHt)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        isCrit
                          ? "bg-red-500/20 text-red-300"
                          : isWarn
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {cat.consumptionPct.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <svg
                  viewBox="0 0 1000 32"
                  className="h-7 w-full overflow-visible"
                  role="img"
                  aria-label={`Répartition ${cat.category}`}
                >
                  <rect
                    x="0"
                    y="2"
                    width="1000"
                    height="6"
                    rx="3"
                    fill="#090b10"
                  />
                  <rect
                    x="0"
                    y="2"
                    width={Math.max(4, soldW * 10)}
                    height="6"
                    rx="3"
                    fill="#06b6d4"
                  />
                  <rect
                    x="0"
                    y="12"
                    width="1000"
                    height="6"
                    rx="3"
                    fill="#090b10"
                  />
                  <rect
                    x="0"
                    y="12"
                    width={Math.max(4, preW * 10)}
                    height="6"
                    rx="3"
                    fill="#f59e0b"
                  />
                  <rect
                    x="0"
                    y="22"
                    width="1000"
                    height="6"
                    rx="3"
                    fill="#090b10"
                  />
                  <rect
                    x="0"
                    y="22"
                    width={cat.postOpTotalHt > 0 ? Math.max(4, postW * 10) : 0}
                    height="6"
                    rx="3"
                    fill="#e11d48"
                  />
                </svg>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
