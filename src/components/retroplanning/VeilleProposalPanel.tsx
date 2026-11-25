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

export function VeilleProposalPanel({
  proposals,
  runningVeille,
  onRunVeille,
  onApplyProposal,
  onDismissProposal,
}: {
  proposals: RetroProposalView[];
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

  const pendingProposals = proposals.filter((p) => p.status === "PENDING");
  const processedProposals = proposals.filter((p) => p.status !== "PENDING");

  return (
    <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232b3d] pb-3">
        <div>
          <h2 className="text-base font-bold text-white">
            Veille IA Gemini (Gmail & 004. Production)
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Propositions de mise à jour 1-clic avec garde-fou Code Projet (&quot;Zéro Mélange&quot;)
          </p>
        </div>

        <button
          type="button"
          disabled={runningVeille}
          onClick={() => void onRunVeille()}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {runningVeille ? "Analyse Veille..." : "Lancer Veille IA"}
        </button>
      </div>

      {pendingProposals.length === 0 ? (
        <p className="mt-4 text-xs text-slate-400">
          Aucune proposition en attente. Lancez une veille IA pour analyser les derniers e-mails et livrables Drive.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {pendingProposals.map((prop) => {
            const currentStatus =
              edits[prop.id]?.status ?? prop.proposedStatus ?? "EN_COURS";
            const currentEnd =
              edits[prop.id]?.endDate ??
              (prop.proposedEndDate ? prop.proposedEndDate.slice(0, 10) : "");

            return (
              <div
                key={prop.id}
                data-testid={`proposal-card-${prop.id}`}
                className="rounded-lg border border-[#232b3d] bg-[#171d2b] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                      {prop.sourceType === "GMAIL" ? (
                        <Mail className="h-3 w-3" />
                      ) : (
                        <FolderOpen className="h-3 w-3" />
                      )}
                      {prop.sourceType}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      Confiance {Math.round(prop.confidence * 100)}%
                    </span>
                    {prop.deltaDays !== 0 && (
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                        {prop.deltaDays > 0 ? `+${prop.deltaDays}j` : `${prop.deltaDays}j`}
                      </span>
                    )}
                  </div>
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200">
                    PENDING
                  </span>
                </div>

                <p className="mt-2 text-xs font-semibold text-white">{prop.summary}</p>
                {prop.evidenceQuote && (
                  <p className="mt-1 rounded border-l-2 border-cyan-500/40 bg-[#0d111a] px-2.5 py-1.5 text-[11px] text-slate-300">
                    &quot;{prop.evidenceQuote}&quot;
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400">
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
                        className="mt-0.5 rounded border border-[#232b3d] bg-[#0d111a] px-2 py-1 text-[11px] text-white"
                      >
                        <option value="A_FAIRE">À faire</option>
                        <option value="EN_COURS">En cours</option>
                        <option value="EN_ATTENTE_CLIENT">En attente client</option>
                        <option value="TERMINE">Terminé</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">
                        Échéance proposée
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
                        className="mt-0.5 rounded border border-[#232b3d] bg-[#0d111a] px-2 py-1 text-[11px] text-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onDismissProposal(prop.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#232b3d] bg-[#0d111a] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#232b3d]"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Ignorer
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void onApplyProposal(prop.id, {
                          proposedStatus: currentStatus,
                          ...(currentEnd ? { proposedEndDate: currentEnd } : {}),
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Appliquer
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {processedProposals.length > 0 && (
        <div className="mt-4 border-t border-[#232b3d] pt-3">
          <p className="text-[11px] font-semibold text-slate-400">
            Historique propositions ({processedProposals.length})
          </p>
          <div className="mt-2 space-y-1.5">
            {processedProposals.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded border border-[#232b3d]/60 bg-[#0d111a]/60 px-3 py-1.5 text-[11px]"
              >
                <span className="truncate text-slate-300">{p.summary}</span>
                <span className="font-mono text-[10px] text-slate-400">{p.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
