"use client";

import {
  AlertTriangle,
  FolderKanban,
  Plus,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ProjectItem {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
  isSandbox: boolean;
  driveInternalRootId: string | null;
  driveExternalRootId: string | null;
  budgetSheetId: string | null;
  retroplanningSheetId: string | null;
  talentsJson: string;
  driftCount: number;
  cpConflictCount: number;
  _count: {
    driveNodes: number;
    invoices: number;
  };
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [creating, setCreating] = useState(false);

  const [codeProjet, setCodeProjet] = useState("");
  const [client, setClient] = useState("");
  const [nomJeu, setNomJeu] = useState("");
  const [provisionDrive, setProvisionDrive] = useState(false);

  const [talentProjectId, setTalentProjectId] = useState("");
  const [talentName, setTalentName] = useState("");
  const [addingTalent, setAddingTalent] = useState(false);

  const [isoProjectId, setIsoProjectId] = useState("");
  const [isoInput, setIsoInput] = useState("Facture QF08_326018.pdf");
  const [isoResult, setIsoResult] = useState<{
    type: "ok" | "conflict";
    text: string;
  } | null>(null);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { projects: ProjectItem[] };
        setProjects(json.projects);
        if (json.projects.length > 0) {
          setTalentProjectId((prev) => prev || json.projects[0].id);
          setIsoProjectId((prev) => prev || json.projects[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (res.ok && active) {
          const json = (await res.json()) as { projects: ProjectItem[] };
          setProjects(json.projects);
          if (json.projects.length > 0) {
            setTalentProjectId((prev) => prev || json.projects[0].id);
            setIsoProjectId((prev) => prev || json.projects[0].id);
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  async function handleBootstrapSandbox() {
    setBootstrapping(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/projects/bootstrap-sandbox", {
        method: "POST",
      });
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        internalNodesCount?: number;
        externalNodesCount?: number;
      };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: `[HTTP ${res.status} · ${json.code ?? "ERREUR"}] ${json.error ?? "Échec du bootstrap."}`,
        });
      } else {
        setFeedback({
          type: "success",
          text: `Bac à sable [PILOTE - 326027] initialisé : ${json.internalNodesCount} dossiers internes + ${json.externalNodesCount} dossiers [EXT].`,
        });
        await loadProjects();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setBootstrapping(false);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codeProjet,
          client,
          nomJeu,
          isSandbox: true,
          provisionDrive,
        }),
      });
      const json = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: `[HTTP ${res.status} · ${json.code ?? "ERREUR"}] ${json.error ?? "Impossible de créer le projet."}`,
        });
      } else {
        setFeedback({
          type: "success",
          text: `Projet (${codeProjet} | ${client} | ${nomJeu}) créé en mode bac à sable.`,
        });
        setCodeProjet("");
        setClient("");
        setNomJeu("");
        await loadProjects();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleAddTalent(e: React.FormEvent) {
    e.preventDefault();
    if (!talentProjectId || !talentName.trim()) return;
    setAddingTalent(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/projects/${talentProjectId}/talents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ talentName }),
      });
      const json = (await res.json()) as {
        error?: string;
        code?: string;
        createdNodes?: unknown[];
      };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: `[HTTP ${res.status} · ${json.code ?? "ERREUR"}] ${json.error ?? "Erreur provisioning talent."}`,
        });
      } else {
        setFeedback({
          type: "success",
          text: `Talent "${talentName}" provisionné dans 004.3.2 (Script/Trame/Vidéo/Validations) et 006.1.2 (${json.createdNodes?.length ?? 10} nœuds).`,
        });
        setTalentName("");
        await loadProjects();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setAddingTalent(false);
    }
  }

  async function handleIsolationCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!isoProjectId) return;
    setIsoResult(null);
    const res = await fetch(`/api/projects/${isoProjectId}/isolation/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText: isoInput,
        sourceLabel: "ui-isolation-tester",
      }),
    });
    const json = (await res.json()) as {
      error?: string;
      result?: { reason?: string; detectedCps?: string[] };
    };
    if (res.status === 409) {
      setIsoResult({
        type: "conflict",
        text: json.error ?? "Conflit CP détecté.",
      });
      window.dispatchEvent(new CustomEvent("go:shell-refresh"));
    } else if (res.ok) {
      setIsoResult({
        type: "ok",
        text: `Aucun conflit CP détecté (CP détectés : ${(json.result?.detectedCps ?? []).join(", ") || "aucun"}).`,
      });
    } else {
      setIsoResult({
        type: "conflict",
        text: json.error ?? "Erreur lors de la vérification.",
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Projets Multi-Clients, Pilote 326027 & Isolation
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Unicité stricte <code className="font-mono">(codeProjet, client, nomJeu)</code>{" "}
            et provisionnement isolé en bac à sable.
          </p>
        </div>

        <button
          type="button"
          disabled={bootstrapping}
          onClick={() => void handleBootstrapSandbox()}
          data-testid="bootstrap-sandbox-btn"
          className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-rose-600/30 hover:bg-[#ff2e58] disabled:opacity-50"
        >
          <Rocket className="h-4 w-4" />
          {bootstrapping
            ? "Provisionnement en cours..."
            : "Initialiser [PILOTE - 326027] Caisse d'Épargne"}
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="projects-feedback"
          className={`rounded-xl border p-4 text-sm ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              : "border-red-500/40 bg-red-950/40 text-red-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Project List */}
      <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-cyan-400" />
          <h2 className="text-base font-bold text-white">
            Portefeuille Projets ({projects.length})
          </h2>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-400">Chargement...</p>
        ) : projects.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            Aucun projet enregistré. Utilisez le bouton d&apos;initialisation du
            pilote 326027 ou créez un projet ci-dessous.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {projects.map((p) => {
              let talents: string[] = [];
              try {
                const parsed = JSON.parse(p.talentsJson || "[]");
                if (Array.isArray(parsed)) talents = parsed;
              } catch {
                talents = [];
              }
              return (
                <div
                  key={p.id}
                  data-testid={`project-card-${p.codeProjet}`}
                  className="rounded-xl border border-[#232b3d] bg-[#171d2b]/70 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-xs font-bold text-cyan-300">
                        CP {p.codeProjet}
                      </span>
                      <h3 className="mt-0.5 text-base font-bold text-white">
                        {p.client} — {p.nomJeu}
                      </h3>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                      <ShieldAlert className="h-3 w-3" />
                      {p.isSandbox ? "BAC À SABLE" : "STANDARD"}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs text-slate-400">
                    <div>Nœuds Drive : {p._count.driveNodes}</div>
                    <div>Décalages [EXT] : {p.driftCount}</div>
                    <div>
                      Root Interne :{" "}
                      {p.driveInternalRootId
                        ? `${p.driveInternalRootId.slice(0, 10)}...`
                        : "Non provisionné"}
                    </div>
                    <div>
                      Root [EXT] :{" "}
                      {p.driveExternalRootId
                        ? `${p.driveExternalRootId.slice(0, 10)}...`
                        : "Non provisionné"}
                    </div>
                  </div>

                  {talents.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {talents.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-[#11151f] px-2 py-0.5 text-[11px] text-slate-300 ring-1 ring-[#232b3d]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Project + Dynamic Talent + Isolation Test */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* New Project */}
        <form
          onSubmit={handleCreateProject}
          className="space-y-4 rounded-xl border border-[#232b3d] bg-[#11151f] p-5"
        >
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#ff2e58]" />
            <h3 className="text-sm font-bold text-white">Nouveau Projet</h3>
          </div>
          <input
            type="text"
            required
            placeholder="Code Projet (ex: 326099)"
            value={codeProjet}
            onChange={(e) => setCodeProjet(e.target.value)}
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
          />
          <input
            type="text"
            required
            placeholder="Client (ex: Caisse d'Épargne)"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
          />
          <input
            type="text"
            required
            placeholder="Jeu / Opération (ex: Event Collaborateurs)"
            value={nomJeu}
            onChange={(e) => setNomJeu(e.target.value)}
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
          />
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={provisionDrive}
              onChange={(e) => setProvisionDrive(e.target.checked)}
              className="rounded border-[#232b3d] bg-[#171d2b]"
            />
            Provisionner Drive 001→006 & [EXT] (nécessite OAuth2)
          </label>
          <button
            type="submit"
            disabled={creating}
            data-testid="create-project-btn"
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#232b3d] disabled:opacity-50"
          >
            {creating ? "Création..." : "Créer le projet"}
          </button>
        </form>

        {/* Dynamic Talent Provisioning */}
        <form
          onSubmit={handleAddTalent}
          className="space-y-4 rounded-xl border border-[#232b3d] bg-[#11151f] p-5"
        >
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">
              Ajouter un Talent (004.3 & 006.1)
            </h3>
          </div>
          <select
            value={talentProjectId}
            onChange={(e) => setTalentProjectId(e.target.value)}
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codeProjet} | {p.client}
              </option>
            ))}
          </select>
          <input
            type="text"
            required
            placeholder="Nom du talent (ex: Kalut, Aksianka)"
            value={talentName}
            onChange={(e) => setTalentName(e.target.value)}
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
          />
          <p className="text-xs text-slate-400">
            Crée automatiquement Script / Trame / Vidéo / Validations dans{" "}
            <code className="font-mono">004.3.2</code> et TikTok / Shorts /
            Instagram / Snapchat dans <code className="font-mono">006.1.2</code>.
          </p>
          <button
            type="submit"
            disabled={addingTalent || !talentProjectId}
            data-testid="add-talent-btn"
            className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {addingTalent ? "Provisionnement..." : "Créer dossiers Talent"}
          </button>
        </form>

        {/* Zero-Mix CP Guardrail Tester */}
        <form
          onSubmit={handleIsolationCheck}
          className="space-y-4 rounded-xl border border-[#232b3d] bg-[#11151f] p-5"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              Testeur Garde-Fou Zéro Mélange
            </h3>
          </div>
          <select
            value={isoProjectId}
            onChange={(e) => setIsoProjectId(e.target.value)}
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                CP {p.codeProjet} | {p.client}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            value={isoInput}
            onChange={(e) => setIsoInput(e.target.value)}
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
          />
          {isoResult && (
            <div
              data-testid="isolation-check-result"
              className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${
                isoResult.type === "conflict"
                  ? "border-red-500/50 bg-red-950/50 text-red-200"
                  : "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              }`}
            >
              {isoResult.type === "conflict" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              ) : (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              )}
              <span>{isoResult.text}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={!isoProjectId}
            data-testid="check-isolation-btn"
            className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#232b3d] disabled:opacity-50"
          >
            Vérifier l&apos;isolation CP
          </button>
        </form>
      </div>
    </div>
  );
}
