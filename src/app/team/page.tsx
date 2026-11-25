"use client";

import Link from "next/link";
import {
  Clock,
  Crown,
  DatabaseBackup,
  Download,
  FolderKanban,
  History,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { showToast } from "@/lib/toast";

interface DirectoryUser {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  role: "ADMIN" | "MEMBER" | string;
  avatarId: string;
  avatarBg: string;
  createdAt: string;
  ownedProjectsCount: number;
  sharedProjectsCount: number;
}

interface BackupRecord {
  id: string;
  trigger: string;
  executionId: string | null;
  status: string;
  projectsCount: number;
  usersCount: number;
  invoicesCount: number;
  quotesCount: number;
  sizeBytes: number;
  createdBy: string | null;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detailsJson: string;
  project: {
    codeProjet: string;
    client: string;
    nomJeu: string;
  } | null;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

function formatDateTimeFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function TeamAndAdminPage() {
  const [activeTab, setActiveTab] = useState<"team" | "backups" | "audit">(
    "team"
  );
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<DirectoryUser | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [scheduleLabel, setScheduleLabel] = useState(
    "Chaque lundi à 04h00 (heure de Paris)"
  );
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);

  const [searchTeam, setSearchTeam] = useState("");
  const [searchAudit, setSearchAudit] = useState("");
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [runningBackup, setRunningBackup] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isAdmin = !currentUser || currentUser.role === "ADMIN";
  const canEditRoles = currentUser?.role === "ADMIN";

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const usersRes = await fetch("/api/users", { cache: "no-store" });
      if (usersRes.ok) {
        const json = (await usersRes.json()) as {
          currentUser: DirectoryUser | null;
          users: DirectoryUser[];
        };
        setCurrentUser(json.currentUser);
        setUsers(json.users ?? []);

        const allowAdmin =
          !json.currentUser || json.currentUser.role === "ADMIN";
        if (allowAdmin) {
          const [bRes, aRes] = await Promise.all([
            fetch("/api/admin/backups", { cache: "no-store" }),
            fetch("/api/admin/audit", { cache: "no-store" }),
          ]);
          if (bRes.ok) {
            const bJson = (await bRes.json()) as {
              schedule?: { humanLabel?: string };
              backups?: BackupRecord[];
            };
            setBackups(bJson.backups ?? []);
            if (bJson.schedule?.humanLabel) {
              setScheduleLabel(bJson.schedule.humanLabel);
            }
          }
          if (aRes.ok) {
            const aJson = (await aRes.json()) as { logs?: AuditEntry[] };
            setAuditLogs(aJson.logs ?? []);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await loadAll();
    };
    void init();
    return () => {
      active = false;
    };
  }, [loadAll]);

  async function handleToggleRole(u: DirectoryUser) {
    const nextRole = u.role === "ADMIN" ? "MEMBER" : "ADMIN";
    setUpdatingRoleId(u.id);
    setFeedback(null);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id, role: nextRole }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de modifier le rôle.",
        });
      } else {
        const msg = `${u.name} est désormais ${nextRole === "ADMIN" ? "Administrateur" : "Membre"}.`;
        setFeedback({ type: "success", text: msg });
        showToast(msg);
        await loadAll();
      }
    } finally {
      setUpdatingRoleId(null);
    }
  }

  async function handleRunManualBackup() {
    setRunningBackup(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/backups", { method: "POST" });
      const json = (await res.json()) as {
        error?: string;
        projectsCount?: number;
        invoicesCount?: number;
        quotesCount?: number;
      };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible de lancer le backup.",
        });
      } else {
        const msg = `Backup créé (${json.projectsCount ?? 0} projets, ${json.quotesCount ?? 0} devis, ${json.invoicesCount ?? 0} factures).`;
        setFeedback({ type: "success", text: msg });
        showToast(msg);
        await loadAll();
      }
    } finally {
      setRunningBackup(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = searchTeam.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.jobTitle ?? "").toLowerCase().includes(q)
    );
  }, [users, searchTeam]);

  const filteredLogs = useMemo(() => {
    const q = searchAudit.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actor.toLowerCase().includes(q) ||
        (l.project?.codeProjet ?? "").toLowerCase().includes(q) ||
        (l.project?.client ?? "").toLowerCase().includes(q) ||
        l.detailsJson.toLowerCase().includes(q)
    );
  }, [auditLogs, searchAudit]);

  const adminCount = users.filter((u) => u.role === "ADMIN").length;
  const latestBackup = backups[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Équipe &amp; Administration
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Consultez l&apos;annuaire des membres du hub, gérez les rôles
            administrateurs, les backups hebdomadaires et le journal d&apos;audit.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <FolderKanban className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            Portefeuille projets
          </Link>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <Sparkles className="h-3.5 w-3.5 text-rose-500" />
            Modèles vierges &amp; Profil
          </Link>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <section className="grid divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827]">
        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Utilisateurs inscrits
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white">
            {users.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">
              {adminCount} admin{adminCount > 1 ? "s" : ""}
            </span>{" "}
            · {users.length - adminCount} membre
            {users.length - adminCount > 1 ? "s" : ""}
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Backup hebdomadaire auto
          </p>
          <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
            {latestBackup
              ? formatDateTimeFr(latestBackup.createdAt)
              : "Aucun backup encore"}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {scheduleLabel}
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Votre rôle actuel
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            {currentUser?.role === "ADMIN" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                <Crown className="h-3.5 w-3.5" />
                Administrateur
              </span>
            ) : currentUser ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <UserCheck className="h-3.5 w-3.5" />
                Membre
              </span>
            ) : (
              <Link
                href="/profile"
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300"
              >
                Se connecter sur Profil
              </Link>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {isAdmin
              ? "Accès complet : rôles, backups, audit et vue globale."
              : "Vous voyez l'annuaire équipe et vos projets partagés."}
          </p>
        </div>
      </section>

      {feedback && (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-xs ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-1 dark:border-slate-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("team")}
            className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold transition-colors ${
              activeTab === "team"
                ? "text-rose-600 dark:text-rose-400"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Annuaire Équipe ({users.length})
            {activeTab === "team" && (
              <span className="absolute right-2 -bottom-1 left-2 h-0.5 rounded-full bg-rose-600 dark:bg-rose-400" />
            )}
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab("backups")}
                className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold transition-colors ${
                  activeTab === "backups"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <DatabaseBackup className="h-3.5 w-3.5" />
                Backups ({backups.length})
                {activeTab === "backups" && (
                  <span className="absolute right-2 -bottom-1 left-2 h-0.5 rounded-full bg-rose-600 dark:bg-rose-400" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold transition-colors ${
                  activeTab === "audit"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <History className="h-3.5 w-3.5" />
                Journal d&apos;audit ({auditLogs.length})
                {activeTab === "audit" && (
                  <span className="absolute right-2 -bottom-1 left-2 h-0.5 rounded-full bg-rose-600 dark:bg-rose-400" />
                )}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>

      {/* TAB 1: TEAM DIRECTORY */}
      {activeTab === "team" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTeam}
                onChange={(e) => setSearchTeam(e.target.value)}
                placeholder="Rechercher un membre (nom, email, poste)..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
              />
            </div>

            {!canEditRoles && currentUser && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seuls les administrateurs peuvent promouvoir ou rétrograder un
                membre.
              </p>
            )}
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-200/80 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827]">
              Chargement de l&apos;équipe...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-2xl border border-slate-200/80 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827]">
              Aucun utilisateur trouvé. Créez un premier profil depuis la page{" "}
              <Link href="/profile" className="font-semibold text-indigo-600 underline">
                Mon profil
              </Link>
              .
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredUsers.map((u) => {
                const isSelf = currentUser?.id === u.id;
                const userIsAdmin = u.role === "ADMIN";
                return (
                  <div
                    key={u.id}
                    data-testid={`team-member-${u.email}`}
                    className={`flex flex-col justify-between rounded-2xl border p-4 transition-all ${
                      isSelf
                        ? "border-rose-200 bg-rose-50/20 dark:border-rose-500/30 dark:bg-rose-500/5"
                        : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#111827]"
                    }`}
                  >
                    <div>
                      <div className="flex items-start gap-3">
                        <AvatarDisplay
                          avatarId={u.avatarId}
                          avatarBg={u.avatarBg}
                          size="lg"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                              {u.name}
                            </h3>
                            {isSelf && (
                              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                                Vous
                              </span>
                            )}
                          </div>
                          {u.jobTitle && (
                            <p className="truncate text-xs font-medium text-indigo-600 dark:text-indigo-400">
                              {u.jobTitle}
                            </p>
                          )}
                          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {u.email}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {userIsAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                            <Crown className="h-3 w-3" />
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            Membre
                          </span>
                        )}
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {u.ownedProjectsCount} créé
                          {u.ownedProjectsCount > 1 ? "s" : ""}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {u.sharedProjectsCount} partagé
                          {u.sharedProjectsCount > 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-400 dark:border-slate-800">
                      <span>Inscrit le {formatDateFr(u.createdAt)}</span>
                      {canEditRoles && (
                        <button
                          type="button"
                          disabled={updatingRoleId === u.id}
                          onClick={() => void handleToggleRole(u)}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                            userIsAdmin
                              ? "border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              : "bg-indigo-600 text-white hover:bg-indigo-700"
                          }`}
                        >
                          <Shield className="h-3 w-3" />
                          {updatingRoleId === u.id
                            ? "..."
                            : userIsAdmin
                              ? "Passer Membre"
                              : "Passer Admin"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Admin Role Powers Info Card */}
          <div className="rounded-2xl border border-indigo-200/70 bg-indigo-50/40 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <div className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Pouvoirs du rôle Administrateur
                </p>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>
                    <strong>Portefeuille agence global</strong> : activer le
                    filtre « Vue agence » dans{" "}
                    <Link href="/projects" className="underline">
                      Tous les projets
                    </Link>{" "}
                    pour superviser tous les projets actifs et archivés de
                    l&apos;équipe.
                  </li>
                  <li>
                    <strong>Gestion des rôles</strong> : promouvoir ou
                    rétrograder un membre (protection automatique du dernier
                    administrateur).
                  </li>
                  <li>
                    <strong>Centre de backups hebdomadaires</strong> : consulter
                    les sauvegardes automatiques du lundi 04h00, déclencher un
                    snapshot à tout moment et télécharger l&apos;export JSON
                    complet.
                  </li>
                  <li>
                    <strong>Journal d&apos;audit global</strong> : suivre les
                    validations de factures, partages, archivages et changements
                    de rôles sur toute l&apos;agence.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: WEEKLY BACKUPS (ADMIN) */}
      {activeTab === "backups" && isAdmin && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Sauvegarde hebdomadaire automatique active
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Planification Vercel Schedule :{" "}
                  <strong>{scheduleLabel}</strong> · Conserve automatiquement
                  les 26 derniers snapshots (6 mois d&apos;historique) sans
                  aucun secret ni token.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={runningBackup}
              onClick={() => void handleRunManualBackup()}
              data-testid="run-manual-backup-btn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <DatabaseBackup className="h-4 w-4" />
              {runningBackup
                ? "Sauvegarde en cours..."
                : "Lancer un backup maintenant"}
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#111827]">
            {backups.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucun snapshot enregistré pour l&apos;instant. Cliquez sur «
                Lancer un backup maintenant » pour créer votre premier backup
                JSON.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-3 py-3">Origine</th>
                      <th className="px-3 py-3">Contenu sauvegardé</th>
                      <th className="px-3 py-3">Taille</th>
                      <th className="px-4 py-3 text-right">Export</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {backups.map((b) => (
                      <tr
                        key={b.id}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {formatDateTimeFr(b.createdAt)}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              b.trigger === "SCHEDULED_WEEKLY"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                            }`}
                          >
                            {b.trigger === "SCHEDULED_WEEKLY"
                              ? "Auto hebdo"
                              : `Manuel (${b.createdBy ?? "admin"})`}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                          {b.projectsCount} projet(s) · {b.usersCount}{" "}
                          membre(s) · {b.quotesCount} devis · {b.invoicesCount}{" "}
                          facture(s)
                        </td>
                        <td className="px-3 py-3 font-mono text-slate-500 dark:text-slate-400">
                          {formatBytes(b.sizeBytes)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a
                            href={`/api/admin/backups/${b.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Download className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                            Télécharger JSON
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 3: AUDIT LOG (ADMIN) */}
      {activeTab === "audit" && isAdmin && (
        <section className="space-y-4">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchAudit}
              onChange={(e) => setSearchAudit(e.target.value)}
              placeholder="Filtrer par action, acteur ou CP..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-white"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[#111827]">
            {filteredLogs.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucune entrée dans le journal d&apos;audit.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-3 py-3">Action</th>
                      <th className="px-3 py-3">Acteur</th>
                      <th className="px-3 py-3">Projet</th>
                      <th className="px-4 py-3">Détails</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 dark:text-slate-400">
                          {formatDateTimeFr(log.createdAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                          {log.actor}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                          {log.project
                            ? `CP ${log.project.codeProjet} · ${log.project.client}`
                            : "Global"}
                        </td>
                        <td className="max-w-xs truncate px-4 py-2.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {log.detailsJson}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
