"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ShellProject } from "@/components/ShellContext";

interface ProjectSwitcherComboboxProps {
  projects: ShellProject[];
  activeProjectId: string | null;
  disabled?: boolean;
  onSelect: (projectId: string) => Promise<void>;
}

export function ProjectSwitcherCombobox({
  projects,
  activeProjectId,
  disabled = false,
  onSelect,
}: ProjectSwitcherComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.client.toLowerCase().includes(q) ||
        p.nomJeu.toLowerCase().includes(q) ||
        p.codeProjet.toLowerCase().includes(q)
    );
  }, [projects, query]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);

    const onOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (projects.length <= 6) {
    return (
      <div className="relative">
        <select
          id="active-project-select"
          aria-label="Projet actif"
          data-testid="active-project-switcher"
          title={
            activeProject
              ? `${activeProject.client} — ${activeProject.nomJeu} (Code projet ${activeProject.codeProjet})`
              : "Sélectionner un projet"
          }
          value={activeProjectId ?? ""}
          disabled={disabled || projects.length === 0}
          onChange={(e) => void onSelect(e.target.value)}
          className="w-full appearance-none truncate rounded-lg bg-white py-1.5 pr-7 pl-2.5 text-xs font-semibold text-slate-900 shadow-2xs ring-1 ring-slate-200/80 transition-colors focus:ring-indigo-500 focus:outline-none disabled:opacity-60 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
        >
          {projects.length === 0 ? (
            <option value="">Aucun projet</option>
          ) : (
            projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.client} — {p.nomJeu} ({p.codeProjet})
              </option>
            ))
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="active-project-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((v) => !v);
        }}
        title={
          activeProject
            ? `${activeProject.client} — ${activeProject.nomJeu} (${activeProject.codeProjet})`
            : "Sélectionner un projet"
        }
        className="flex w-full items-center justify-between gap-2 rounded-lg bg-white py-1.5 pr-2 pl-2.5 text-left text-xs font-semibold text-slate-900 shadow-2xs ring-1 ring-slate-200/80 transition-colors hover:ring-indigo-300 focus:ring-indigo-500 focus:outline-none disabled:opacity-60 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
      >
        <span className="truncate">
          {activeProject
            ? `${activeProject.client} — ${activeProject.nomJeu}`
            : "Aucun projet"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Choisir un projet actif"
          className="absolute right-0 left-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#111827]"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2 dark:border-slate-800">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Client, nom ou code…"
              className="w-full bg-transparent text-xs text-slate-900 placeholder:text-slate-500 focus:outline-none dark:text-white dark:placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2.5 py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                Aucun projet trouvé
              </p>
            ) : (
              filtered.map((p) => {
                const isSelected = p.id === activeProjectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setOpen(false);
                      void onSelect(p.id);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      <span className="block truncate font-medium">
                        {p.client} — {p.nomJeu}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {p.codeProjet}
                      </span>
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
