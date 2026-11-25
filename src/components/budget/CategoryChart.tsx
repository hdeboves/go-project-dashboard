"use client";

import { BarChart3, PieChart as PieChartIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type BudgetSummaryDto,
  type CategoryBreakdownDto,
  formatEur,
} from "@/components/budget/types";

interface CategoryChartProps {
  categories: CategoryBreakdownDto[];
  summary?: BudgetSummaryDto;
  selectedCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
}

type PieMetric = "postOp" | "preOp" | "sold";

// Sober monochromatic Indigo + Slate + Rose + Emerald harmonious ramp
const CATEGORY_COLORS = [
  "#4f46e5", // indigo-600
  "#e11d48", // rose-600
  "#059669", // emerald-600
  "#6366f1", // indigo-500
  "#475569", // slate-600
  "#818cf8", // indigo-400
  "#fb7185", // rose-400
  "#10b981", // emerald-500
  "#94a3b8", // slate-400
  "#3730a3", // indigo-800
];

function getMetricValue(cat: CategoryBreakdownDto, metric: PieMetric): number {
  if (metric === "postOp") return Math.max(0, cat.postOpTotalHt);
  if (metric === "sold") return Math.max(0, cat.soldTotalHt);
  return Math.max(0, cat.preOpTotalHt);
}

function describeArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + outerR * Math.cos(rad(startAngle));
  const y1 = cy + outerR * Math.sin(rad(startAngle));
  const x2 = cx + outerR * Math.cos(rad(endAngle));
  const y2 = cy + outerR * Math.sin(rad(endAngle));
  const x3 = cx + innerR * Math.cos(rad(endAngle));
  const y3 = cy + innerR * Math.sin(rad(endAngle));
  const x4 = cx + innerR * Math.cos(rad(startAngle));
  const y4 = cy + innerR * Math.sin(rad(startAngle));
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

function shortCategoryLabel(name: string): string {
  const clean = name.trim();
  if (clean.length <= 28) return clean;
  return `${clean.slice(0, 26)}…`;
}

export function CategoryChart({
  categories,
  summary,
  selectedCategory,
  onSelectCategory,
}: CategoryChartProps) {
  const hasPostOp = categories.some((c) => c.postOpTotalHt > 0);
  const [pieMetric, setPieMetric] = useState<PieMetric>(
    hasPostOp ? "postOp" : "preOp"
  );
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);

  const effectiveMetric: PieMetric =
    pieMetric === "postOp" && !hasPostOp ? "preOp" : pieMetric;

  const colorByCategory = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((cat, idx) => {
      map.set(cat.category, CATEGORY_COLORS[idx % CATEGORY_COLORS.length]);
    });
    return map;
  }, [categories]);

  const pieSlices = useMemo(() => {
    const items = categories
      .map((cat) => ({
        category: cat.category,
        value: getMetricValue(cat, effectiveMetric),
        color: colorByCategory.get(cat.category) ?? CATEGORY_COLORS[0],
        lineCount: cat.lineCount,
      }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = items.reduce((s, item) => s + item.value, 0);
    if (total <= 0) return { total: 0, slices: [] };

    let currentAngle = 0;
    const slices = items.map((item) => {
      const pct = (item.value / total) * 100;
      const sweep = (item.value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sweep;
      currentAngle = endAngle;
      return { ...item, pct, startAngle, endAngle };
    });

    return { total, slices };
  }, [categories, effectiveMetric, colorByCategory]);

  const sortedForBars = useMemo(() => {
    return [...categories].sort(
      (a, b) =>
        Math.max(b.preOpTotalHt, b.postOpTotalHt) -
        Math.max(a.preOpTotalHt, a.postOpTotalHt)
    );
  }, [categories]);

  const maxBarVal = useMemo(() => {
    return Math.max(
      1,
      ...sortedForBars.flatMap((c) => [c.preOpTotalHt, c.postOpTotalHt])
    );
  }, [sortedForBars]);

  const activeSlice = useMemo(() => {
    const target = hoveredCat ?? selectedCategory ?? null;
    if (!target) return null;
    return pieSlices.slices.find((s) => s.category === target) ?? null;
  }, [hoveredCat, selectedCategory, pieSlices.slices]);

  if (categories.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#111827]">
        <PieChartIcon className="mx-auto mb-2.5 h-8 w-8 text-slate-300 dark:text-slate-600" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Aucun budget importé pour le moment
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Cliquez sur « Importer / Sync » en haut à droite pour charger votre
          budget.
        </p>
      </section>
    );
  }

  const metricLabel =
    effectiveMetric === "postOp"
      ? "Facturé"
      : effectiveMetric === "sold"
        ? "Vendu"
        : "Prévu";

  const soldBase = summary && summary.soldTotalHt > 0 ? summary.soldTotalHt : 0;
  const postPctOfSold =
    soldBase > 0 && summary
      ? Math.min(100, (summary.postOpTotalHt / soldBase) * 100)
      : 0;
  const remainPctOfSold =
    soldBase > 0 && summary
      ? Math.min(
          Math.max(0, 100 - postPctOfSold),
          (summary.remainingToCommitHt / soldBase) * 100
        )
      : 0;
  const marginPctOfSold = Math.max(0, 100 - postPctOfSold - remainPctOfSold);

  return (
    <section className="grid gap-5 lg:grid-cols-12">
      {/* LEFT CARD: Interactive Donut (stacked layout = zero clipping on mobile, tablet & desktop!) */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827] lg:col-span-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <PieChartIcon className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
            <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              Répartition par catégorie
            </h2>
          </div>
          <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-0.5 text-[11px] dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setPieMetric("preOp")}
              className={`rounded-lg px-2 py-1 font-medium transition-colors ${
                effectiveMetric === "preOp"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
              }`}
            >
              Prévu
            </button>
            <button
              type="button"
              disabled={!hasPostOp}
              onClick={() => setPieMetric("postOp")}
              className={`rounded-lg px-2 py-1 font-medium transition-colors disabled:opacity-40 ${
                effectiveMetric === "postOp"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
              }`}
            >
              Facturé
            </button>
            <button
              type="button"
              onClick={() => setPieMetric("sold")}
              className={`rounded-lg px-2 py-1 font-medium transition-colors ${
                effectiveMetric === "sold"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
              }`}
            >
              Vendu
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center gap-4">
          <div className="relative h-44 w-44 shrink-0">
            <svg
              viewBox="0 0 220 220"
              className="h-full w-full"
              role="img"
              aria-label={`Répartition budget (${metricLabel})`}
            >
              {pieSlices.slices.length === 1 ? (
                <circle
                  cx="110"
                  cy="110"
                  r="80"
                  fill="none"
                  stroke={pieSlices.slices[0].color}
                  strokeWidth="28"
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={() => setHoveredCat(pieSlices.slices[0].category)}
                  onMouseLeave={() => setHoveredCat(null)}
                  onClick={() =>
                    onSelectCategory?.(
                      selectedCategory === pieSlices.slices[0].category
                        ? null
                        : pieSlices.slices[0].category
                    )
                  }
                />
              ) : (
                pieSlices.slices.map((slice) => {
                  const isActive =
                    hoveredCat === slice.category ||
                    selectedCategory === slice.category;
                  const dimmed =
                    (hoveredCat !== null || selectedCategory != null) &&
                    !isActive;
                  const gap = pieSlices.slices.length > 1 ? 1.2 : 0;
                  const start = slice.startAngle + gap / 2;
                  const end = Math.max(start + 0.5, slice.endAngle - gap / 2);

                  return (
                    <path
                      key={slice.category}
                      d={describeArc(
                        110,
                        110,
                        isActive ? 98 : 93,
                        63,
                        start,
                        end
                      )}
                      fill={slice.color}
                      opacity={dimmed ? 0.25 : 1}
                      className="cursor-pointer transition-all duration-150"
                      onMouseEnter={() => setHoveredCat(slice.category)}
                      onMouseLeave={() => setHoveredCat(null)}
                      onClick={() =>
                        onSelectCategory?.(
                          selectedCategory === slice.category
                            ? null
                            : slice.category
                        )
                      }
                    >
                      <title>
                        {slice.category} : {formatEur(slice.value)} (
                        {slice.pct.toFixed(1)}%)
                      </title>
                    </path>
                  );
                })
              )}
            </svg>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
              {activeSlice ? (
                <>
                  <span className="line-clamp-2 text-[10px] font-medium leading-tight text-slate-500 dark:text-slate-400">
                    {shortCategoryLabel(activeSlice.category)}
                  </span>
                  <span className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {formatEur(activeSlice.value)}
                  </span>
                  <span
                    className="mt-0.5 text-xs font-semibold"
                    style={{ color: activeSlice.color }}
                  >
                    {activeSlice.pct.toFixed(0)}%
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                    {metricLabel}
                  </span>
                  <span className="mt-0.5 font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {formatEur(pieSlices.total)}
                  </span>
                  <span className="mt-0.5 text-[10px] text-slate-400">
                    Cliquez pour filtrer
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="max-h-52 w-full min-w-0 space-y-1 overflow-y-auto pr-0.5">
            {pieSlices.slices.map((slice) => {
              const isSelected = selectedCategory === slice.category;
              const isHovered = hoveredCat === slice.category;
              return (
                <button
                  key={slice.category}
                  type="button"
                  onMouseEnter={() => setHoveredCat(slice.category)}
                  onMouseLeave={() => setHoveredCat(null)}
                  onClick={() =>
                    onSelectCategory?.(isSelected ? null : slice.category)
                  }
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-500/20 dark:ring-indigo-500/40"
                      : isHovered
                        ? "bg-slate-50 dark:bg-slate-800/70"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {slice.category}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] whitespace-nowrap">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      {formatEur(slice.value)}
                    </span>
                    <span className="w-9 text-right text-slate-500 dark:text-slate-400">
                      {slice.pct.toFixed(0)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT CARD: Prévu vs Facturé Bars */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827] lg:col-span-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Prévu vs Facturé par catégorie
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
              Prévu
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
              Facturé
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-600" />
              Dépassement
            </span>
          </div>
        </div>

        {/* Global Structure Bar (3 colors: Indigo, Neutral Slate, Emerald) */}
        {summary && soldBase > 0 && (
          <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Structure du budget vendu ({formatEur(summary.soldTotalHt)})
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Facturé {postPctOfSold.toFixed(0)}% · Reste{" "}
                {remainPctOfSold.toFixed(0)}% · Marge atterrissage{" "}
                {(summary.forecastMarginPct ?? summary.plannedMarginPct).toFixed(0)}%
              </span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                style={{ width: `${postPctOfSold}%` }}
                className="bg-indigo-600 dark:bg-indigo-500"
              />
              <div
                style={{ width: `${remainPctOfSold}%` }}
                className="bg-slate-400 dark:bg-slate-500"
              />
              <div
                style={{ width: `${marginPctOfSold}%` }}
                className="bg-emerald-600 dark:bg-emerald-500"
              />
            </div>
          </div>
        )}

        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {sortedForBars.map((cat) => {
            const preW = Math.min(100, (cat.preOpTotalHt / maxBarVal) * 100);
            const postW = Math.min(100, (cat.postOpTotalHt / maxBarVal) * 100);
            const diff =
              Math.round((cat.postOpTotalHt - cat.preOpTotalHt) * 100) / 100;
            const isOverrun = diff > 0;

            return (
              <button
                key={cat.category}
                type="button"
                onClick={() => onSelectCategory?.(cat.category)}
                className={`block w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                  isOverrun
                    ? "border-rose-200 bg-rose-50/40 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-rose-950/20 dark:hover:bg-rose-950/30"
                    : "border-slate-100 bg-slate-50/60 hover:bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800/70"
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          colorByCategory.get(cat.category) ?? "#4f46e5",
                      }}
                    />
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                      {cat.category}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400">
                      {formatEur(cat.postOpTotalHt)} /{" "}
                      {formatEur(cat.preOpTotalHt)}
                    </span>
                    {isOverrun ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                        +{formatEur(diff)}
                      </span>
                    ) : cat.consumptionPct >= 90 && cat.postOpTotalHt < cat.preOpTotalHt ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        {cat.consumptionPct.toFixed(0)}% · Vigilance
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        {cat.consumptionPct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/70">
                    <div
                      style={{ width: `${preW}%` }}
                      className="h-full rounded-full bg-slate-400 dark:bg-slate-500"
                    />
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/70">
                    <div
                      style={{ width: `${postW}%` }}
                      className={`h-full rounded-full ${
                        isOverrun
                          ? "bg-rose-600"
                          : "bg-indigo-600 dark:bg-indigo-400"
                      }`}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
