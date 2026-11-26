"use client";

import {
  BarChart3,
  Calendar,
  CheckSquare,
  FileSpreadsheet,
  FolderGit2,
  GanttChartSquare,
  Home,
  LayoutGrid,
  Mic,
  Moon,
  Plus,
  Presentation,
  Receipt,
  Search,
  Settings,
  Sparkles,
  Sun,
  UploadCloud,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

interface PaletteProject {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  projects: PaletteProject[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => Promise<void>;
  theme: "light" | "dark";
  onToggleTheme: (next: "light" | "dark") => void;
}

const QUICK_ACTIONS = [
  {
    href: "/my-tasks",
    label: "Voir mes tâches du jour",
    hint: "Priorités multi-projets",
    icon: CheckSquare,
    tone: "text-indigo-600 dark:text-indigo-400",
  },
  {
    href: "/retroplanning",
    label: "Ajouter une tâche",
    hint: "Planning & tâches",
    icon: Plus,
    tone: "text-sky-600 dark:text-sky-400",
  },
  {
    href: "/budget?tab=quotes",
    label: "Créer / Gérer les devis",
    hint: "Devis PDF & liaison factures",
    icon: FileSpreadsheet,
    tone: "text-indigo-600 dark:text-indigo-400",
  },
  {
    href: "/budget?tab=invoices",
    label: "Déposer une facture PDF",
    hint: "Budget & Pennylane",
    icon: Receipt,
    tone: "text-indigo-600 dark:text-indigo-400",
  },
  {
    href: "/retroplanning?tab=template",
    label: "Modèle vierge Rétroplanning",
    hint: "Personnaliser les tâches sans dates",
    icon: Sparkles,
    tone: "text-indigo-600 dark:text-indigo-400",
  },
  {
    href: "/meetings",
    label: "Consulter / Importer un CR Krisp",
    hint: "Drive Comptes rendus",
    icon: Mic,
    tone: "text-violet-600 dark:text-violet-400",
  },
  {
    href: "/weeklys",
    label: "Préparer un Weekly Client",
    hint: "Slides & brouillon Gmail",
    icon: Presentation,
    tone: "text-amber-600 dark:text-amber-400",
  },
  {
    href: "/drive",
    label: "Publier des livrables au client",
    hint: "Espace client Drive",
    icon: UploadCloud,
    tone: "text-emerald-600 dark:text-emerald-400",
  },
];

const NAV_COMMANDS = [
  {
    href: "/my-tasks",
    label: "Mes Tâches (Multi-projets)",
    hint: "Toutes mes priorités, retards & échéances",
    icon: CheckSquare,
  },
  {
    href: "/projects",
    label: "Vue d'ensemble (Tous les projets)",
    hint: "Portefeuille multi-projets, santé & marges",
    icon: LayoutGrid,
  },
  {
    href: "/",
    label: "Cockpit Projet",
    hint: "Vue synthétique & priorités du projet actif",
    icon: Home,
  },
  {
    href: "/retroplanning",
    label: "Tâches & Planning",
    hint: "Vue Liste, Kanban & Gantt",
    icon: GanttChartSquare,
  },
  {
    href: "/budget",
    label: "Budget & Factures",
    hint: "Graphiques, postes, devis & Pennylane",
    icon: FileSpreadsheet,
  },
  {
    href: "/drive",
    label: "Fichiers Drive",
    hint: "Dossiers internes & espace client",
    icon: FolderGit2,
  },
  {
    href: "/meetings",
    label: "Comptes rendus Krisp",
    hint: "Dossier Drive « Comptes rendus » & actions",
    icon: Mic,
  },
  {
    href: "/calendar",
    label: "Agenda & Rappels",
    hint: "Jalons multi-projets & échéances",
    icon: Calendar,
  },
  {
    href: "/weeklys",
    label: "Weeklys Clients",
    hint: "Slides & brouillon Gmail",
    icon: Presentation,
  },
  {
    href: "/reporting",
    label: "Reporting Bilan",
    hint: "Fortnite, Influence, Excel & Slides",
    icon: BarChart3,
  },
  {
    href: "/team",
    label: "Équipe & Administration",
    hint: "Annuaire, charge équipe, URSSAF, backups & audit",
    icon: Users,
  },
  {
    href: "/profile",
    label: "Mon profil & Avatar",
    hint: "Personnaliser avatar & session utilisateur",
    icon: UserCircle2,
  },
  {
    href: "/settings",
    label: "Paramètres",
    hint: "Google Workspace, IA, Krisp & Pennylane",
    icon: Settings,
  },
];

export function CommandPalette({
  open,
  onClose,
  projects,
  activeProjectId,
  onSelectProject,
  theme,
  onToggleTheme,
}: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const q = query.trim().toLowerCase();

  const matchedActions = useMemo(
    () =>
      QUICK_ACTIONS.filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          item.hint.toLowerCase().includes(q)
      ),
    [q]
  );

  const matchedNav = useMemo(
    () =>
      NAV_COMMANDS.filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          item.hint.toLowerCase().includes(q)
      ),
    [q]
  );

  const matchedProjects = useMemo(() => {
    const res = projects.filter(
      (p) =>
        !q ||
        p.client.toLowerCase().includes(q) ||
        p.nomJeu.toLowerCase().includes(q) ||
        p.codeProjet.toLowerCase().includes(q)
    );
    return q ? res : res.slice(0, 5);
  }, [projects, q]);

  const showThemeCommand =
    !q ||
    "theme".includes(q) ||
    "thème".includes(q) ||
    "sombre".includes(q) ||
    "clair".includes(q) ||
    "dark".includes(q) ||
    "mode".includes(q);

  const flatItems = useMemo(() => {
    const list: Array<
      | { kind: "action"; href: string }
      | { kind: "project"; id: string }
      | { kind: "nav"; href: string }
      | { kind: "theme" }
    > = [];
    for (const a of matchedActions) {
      list.push({ kind: "action", href: a.href });
    }
    for (const p of matchedProjects) {
      list.push({ kind: "project", id: p.id });
    }
    for (const item of matchedNav) {
      list.push({ kind: "nav", href: item.href });
    }
    if (showThemeCommand) {
      list.push({ kind: "theme" });
    }
    return list;
  }, [matchedActions, matchedProjects, matchedNav, showThemeCommand]);

  const safeIndex =
    flatItems.length === 0 ? 0 : Math.min(selectedIndex, flatItems.length - 1);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setQuery("");
      setSelectedIndex(0);
      inputRef.current?.focus();
    }, 10);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[safeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, safeIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) =>
          flatItems.length === 0 ? 0 : (i + 1) % flatItems.length
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) =>
          flatItems.length === 0
            ? 0
            : (i - 1 + flatItems.length) % flatItems.length
        );
      } else if (e.key === "Enter" && flatItems.length > 0) {
        e.preventDefault();
        const chosen = flatItems[Math.min(selectedIndex, flatItems.length - 1)];
        if (!chosen) return;
        if (chosen.kind === "project") {
          void onSelectProject(chosen.id);
          onClose();
        } else if (chosen.kind === "theme") {
          onToggleTheme(theme === "dark" ? "light" : "dark");
          onClose();
        } else {
          router.push(chosen.href);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    open,
    onClose,
    flatItems,
    selectedIndex,
    onSelectProject,
    onToggleTheme,
    theme,
    router,
  ]);

  if (!open) return null;

  const themeFlatIdx =
    matchedActions.length + matchedProjects.length + matchedNav.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/45 px-4 pt-16 backdrop-blur-xs sm:pt-20"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche rapide"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#111827]"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <Search className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Aller à une page, changer de projet…"
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none dark:text-white dark:placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la recherche"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-96 space-y-4 overflow-y-auto p-3">
          {flatItems.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Aucun résultat pour « {query} »
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Essayez un nom de client, un code projet ou une page (budget,
                tâches, devis…).
              </p>
            </div>
          )}

          {matchedActions.length > 0 && (
            <div>
              <p className="mb-1.5 px-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Actions rapides
              </p>
              <div className="space-y-0.5">
                {matchedActions.map((act, idx) => {
                  const Icon = act.icon;
                  const isSelected = safeIndex === idx;
                  return (
                    <button
                      key={act.label}
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      type="button"
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => {
                        router.push(act.href);
                        onClose();
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? "bg-indigo-50 dark:bg-indigo-500/20"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className={`h-4 w-4 ${act.tone}`} />
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {act.label}
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {act.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {matchedProjects.length > 0 && (
            <div>
              <p className="mb-1.5 px-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Projets
              </p>
              <div className="space-y-0.5">
                {matchedProjects.map((p, idx) => {
                  const isCurrent = p.id === activeProjectId;
                  const flatIdx = matchedActions.length + idx;
                  const isSelected = safeIndex === flatIdx;
                  return (
                    <button
                      key={p.id}
                      ref={(el) => {
                        itemRefs.current[flatIdx] = el;
                      }}
                      type="button"
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      onClick={() => {
                        void onSelectProject(p.id);
                        onClose();
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? "bg-indigo-50 dark:bg-indigo-500/20"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                        <span className="truncate font-semibold text-slate-900 dark:text-white">
                          {p.client} — {p.nomJeu}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {p.codeProjet}
                        </span>
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          Actif
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {matchedNav.length > 0 && (
            <div>
              <p className="mb-1.5 px-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Pages
              </p>
              <div className="space-y-0.5">
                {matchedNav.map((item, idx) => {
                  const Icon = item.icon;
                  const flatIdx =
                    matchedActions.length + matchedProjects.length + idx;
                  const isSelected = safeIndex === flatIdx;
                  return (
                    <button
                      key={item.href}
                      ref={(el) => {
                        itemRefs.current[flatIdx] = el;
                      }}
                      type="button"
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      onClick={() => {
                        router.push(item.href);
                        onClose();
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? "bg-indigo-50 dark:bg-indigo-500/20"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {item.label}
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showThemeCommand && (
            <div>
              <p className="mb-1.5 px-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Préférence
              </p>
              <button
                ref={(el) => {
                  itemRefs.current[themeFlatIdx] = el;
                }}
                type="button"
                onMouseEnter={() => setSelectedIndex(themeFlatIdx)}
                onClick={() => {
                  onToggleTheme(theme === "dark" ? "light" : "dark");
                  onClose();
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                  safeIndex === themeFlatIdx
                    ? "bg-indigo-50 dark:bg-indigo-500/20"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4 text-indigo-400" />
                  ) : (
                    <Moon className="h-4 w-4 text-indigo-600" />
                  )}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    Passer en mode {theme === "dark" ? "clair" : "sombre"}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
