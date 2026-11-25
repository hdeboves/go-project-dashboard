"use client";

import { Check, FolderOpen, Mail, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";

export interface RetroProposalView {
  id: string;
  retroTaskId: string | null;
  sourceType: "GMAIL" | "DRIVE" | string;
  sourceRef: string | null;
  summary: string;
  evidenceQuote: string | null;
  proposedStatus: string | null;
  proposedStartDate: string | null;
  proposedEndDate: string | null;
  deltaDays: number;
  confidence: number;
  status: "PENDING" | "APPLIED" | "DISMISSED" | string;
  createdAt: string;
}

export interface ProposalTargetTask {
  id: string;
  phase: string;
  tache: string;
  status: string;
  endDate: string | null;
}

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  A_FAIRE: "À faire",
  EN_COURS: "En cours",
  EN_ATTENTE_CLIENT: "Attente client",
  TERMINE: "Terminé",
};

export function VeilleProposalPanel({
  proposals,
  tasks = [],
  runningVeille,
  onRunVeille,
  onApplyProposal,
  onDismissProposal,
}: {
  proposals: RetroProposalView[];
  tasks?: ProposalTargetTask[];
  runningVeille: boolean;
  onRunVeille: () => Promise<void>;
  onApplyProposal: (
    proposalId: string,
    overrides: { proposedStatus?: string; proposedEndDate?: string }
  ) => Promise<void>;
  onDismissProposal: (proposalId: string) => Promise<void>;
}) {
  const [edits, setEdits] = useState<
    Record<string, { status?: string; endDate?: string }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingProposals = proposals.filter((p) => p.status === "PENDING");
  const processedProposals = proposals.filter((p) => p.status !== "PENDING");

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800/80">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Suggestions de mise à jour (Veille IA)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            L&apos;assistant lit vos derniers emails et livrables Drive pour
            proposer des ajustements au planning.
          </p>
        </div>

        <button
          type="button"
          disabled={runningVeille}
          onClick={() => void onRunVeille()}
          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-rose-700 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {runningVeille ? "Analyse en cours..." : "Analyser emails & Drive"}
        </button>
      </div>

      {pendingProposals.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Aucune suggestion en attente. Cliquez sur « Analyser mes emails » pour
          vérifier les dernières nouveautés.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {pendingProposals.map((prop) => {
            const targetTask = prop.retroTaskId
              ? tasks.find((t) => t.id === prop.retroTaskId) ?? null
              : null;
            const currentStatus =
              edits[prop.id]?.status ?? prop.proposedStatus ?? "EN_COURS";
            const currentEnd =
              edits[prop.id]?.endDate ??
              (prop.proposedEndDate ? prop.proposedEndDate.slice(0, 10) : "");

            return (
              <div
                key={prop.id}
                data-testid={`proposal-card-${prop.id}`}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                      {prop.sourceType === "GMAIL" ? (
                        <Mail className="h-3 w-3" />
                      ) : (
                        <FolderOpen className="h-3 w-3" />
                      )}
                      {prop.sourceType === "GMAIL" ? "Email" : "Drive"}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Fiabilité {Math.round(prop.confidence * 100)}%
                    </span>
                    {prop.deltaDays !== 0 && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          prop.deltaDays > 0
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                            : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        }`}
                      >
                        {prop.deltaDays > 0
                          ? `+${prop.deltaDays}j retard`
                          : `${prop.deltaDays}j avance`}
                      </span>
                    )}
                  </div>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                    À valider
                  </span>
                </div>

                {targetTask && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-white px-3 py-1.5 text-[11px] dark:border-slate-700 dark:bg-[#111827]">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      Tâche : {targetTask.phase} · {targetTask.tache}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      Actuel :{" "}
                      <strong>
                        {PROPOSAL_STATUS_LABEL[targetTask.status] ??
                          targetTask.status}
                      </strong>
                      {targetTask.endDate
                        ? ` · ${targetTask.endDate.slice(0, 10)}`
                        : ""}
                    </span>
                  </div>
                )}

                <p className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-white">
                  {prop.summary}
                </p>
                {prop.evidenceQuote && (
                  <p className="mt-1.5 rounded-lg border-l-2 border-indigo-400 bg-white px-3 py-2 text-xs text-slate-600 italic dark:bg-[#111827] dark:text-slate-300">
                    « {prop.evidenceQuote} »
                  </p>
                )}

                <div className="mt-3.5 flex flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Statut proposé
                      </label>
                      <select
                        value={currentStatus}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [prop.id]: {
                              ...prev[prop.id],
                              status: e.target.value,
                            },
                          }))
                        }
                        className="mt-0.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
                      >
                        <option value="A_FAIRE">À faire</option>
                        <option value="EN_COURS">En cours</option>
                        <option value="EN_ATTENTE_CLIENT">Attente client</option>
                        <option value="TERMINE">Terminé</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Nouvelle date
                      </label>
                      <input
                        type="date"
                        value={currentEnd}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [prop.id]: {
                              ...prev[prop.id],
                              endDate: e.target.value,
                            },
                          }))
                        }
                        className="mt-0.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyId === prop.id}
                      onClick={async () => {
                        setBusyId(prop.id);
                        try {
                          await onDismissProposal(prop.id);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-300 dark:hover:bg-slate-800/70"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Ignorer
                    </button>
                    <button
                      type="button"
                      disabled={busyId === prop.id}
                      onClick={async () => {
                        setBusyId(prop.id);
                        try {
                          await onApplyProposal(prop.id, {
                            proposedStatus: currentStatus,
                            ...(currentEnd ? { proposedEndDate: currentEnd } : {}),
                          });
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {busyId === prop.id ? "..." : "Appliquer"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {processedProposals.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800/80">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Traitées récemment ({processedProposals.length})
          </p>
          <div className="mt-2 space-y-1.5">
            {processedProposals.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"
              >
                <span className="truncate text-slate-700 dark:text-slate-200">{p.summary}</span>
                <span className="text-[11px] font-medium text-slate-400">
                  {p.status === "APPLIED" ? "Appliquée" : "Ignorée"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
