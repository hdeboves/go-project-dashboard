"use client";

import Link from "next/link";
import {
  ArrowRight,
  FileSpreadsheet,
  GanttChartSquare,
  Presentation,
  Sparkles,
} from "lucide-react";

const LINKS = [
  {
    href: "/budget?tab=template",
    title: "Modèles Budget (0 €)",
    desc: "Éditer les postes vierges par catégorie (Jeu, YouTube, Événement, Sponsor).",
    icon: FileSpreadsheet,
  },
  {
    href: "/retroplanning?tab=template",
    title: "Modèle Rétroplanning",
    desc: "Configurer les tâches et jalons récurrents sans dates.",
    icon: GanttChartSquare,
  },
  {
    href: "/weeklys?tab=template",
    title: "Modèle Weekly Client",
    desc: "Personnaliser les prochaines étapes types Client / Agence.",
    icon: Presentation,
  },
] as const;

export function TemplatesQuickLinksCard() {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-rose-600 dark:text-rose-400" />
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
          Modèles vierges par onglet
        </h2>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Chaque modèle vierge s&apos;édite et s&apos;applique désormais
        directement depuis son espace dédié :
      </p>

      <div className="mt-3 space-y-2">
        {LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/50 px-3.5 py-2.5 transition-colors hover:border-rose-300 hover:bg-rose-50/40 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/10"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Icon className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-rose-600 dark:text-slate-400 dark:group-hover:text-rose-400" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    {item.title}
                  </p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {item.desc}
                  </p>
                </div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-rose-600 dark:group-hover:text-rose-400" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
