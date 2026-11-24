import Link from "next/link";
import { ArrowRight, Layers, ShieldCheck } from "lucide-react";

interface ModulePlaceholderProps {
  title: string;
  milestoneBadge: string;
  description: string;
  features: string[];
}

export function ModulePlaceholder({
  title,
  milestoneBadge,
  description,
  features,
}: ModulePlaceholderProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#171d2b] text-cyan-400 ring-1 ring-[#232b3d]">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{title}</h1>
              <p className="text-sm text-slate-400">{description}</p>
            </div>
          </div>
          <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 font-mono text-xs font-semibold text-cyan-300">
            {milestoneBadge}
          </span>
        </div>

        <div className="mt-6 rounded-lg border border-[#232b3d] bg-[#171d2b]/70 p-4">
          <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Capacités prévues sur ce module
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            {features.map((feat) => (
              <li key={feat} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{feat}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff2e58]"
          >
            Gérer le projet pilote
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/drive"
            className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-[#232b3d]"
          >
            Ouvrir Drive 001→006
          </Link>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-[#232b3d]"
          >
            Paramètres OAuth2 & Gemini
          </Link>
        </div>
      </div>
    </div>
  );
}
