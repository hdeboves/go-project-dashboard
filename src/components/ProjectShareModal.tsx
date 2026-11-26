"use client";

import {
  Crown,
  Eye,
  Pencil,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { showToast } from "@/lib/toast";

interface MemberUser {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  role: string;
  avatarId: string;
  avatarBg: string;
}

interface ProjectMemberRow {
  id: string;
  userId: string;
  role: "VIEWER" | "EDITOR" | string;
  createdAt: string;
  user: MemberUser;
}

interface ProjectShareModalProps {
  projectId: string;
  projectLabel: string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export function ProjectShareModal({
  projectId,
  projectLabel,
  open,
  onClose,
  onChanged,
}: ProjectShareModalProps) {
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState<MemberUser | null>(null);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [teamUsers, setTeamUsers] = useState<MemberUser[]>([]);
  const [canManage, setCanManage] = useState(true);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"VIEWER" | "EDITOR">("EDITOR");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        owner?: MemberUser | null;
        members?: ProjectMemberRow[];
        teamUsers?: MemberUser[];
        access?: { canManageMembers?: boolean };
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Impossible de charger les accès du projet.");
        return;
      }
      setOwner(json.owner ?? null);
      setMembers(json.members ?? []);
      setTeamUsers(json.teamUsers ?? []);
      setCanManage(json.access?.canManageMembers ?? true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await loadMembers();
    };
    void init();
    return () => {
      active = false;
    };
  }, [open, projectId, loadMembers]);

  if (!open) return null;

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          role,
        }),
      });
      const json = (await res.json()) as {
        owner?: MemberUser | null;
        members?: ProjectMemberRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Impossible de partager le projet.");
        return;
      }
      setOwner(json.owner ?? null);
      setMembers(json.members ?? []);
      setEmail("");
      setName("");
      showToast(
        role === "EDITOR"
          ? "Accès Vue & Gestion partagé !"
          : "Accès Vue uniquement partagé !"
      );
      onChanged?.();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, nextRole: "VIEWER" | "EDITOR") {
    const res = await fetch(`/api/projects/${projectId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role: nextRole }),
    });
    const json = (await res.json()) as {
      members?: ProjectMemberRow[];
      error?: string;
    };
    if (!res.ok) {
      setError(json.error ?? "Impossible de modifier ce rôle.");
      return;
    }
    setMembers(json.members ?? []);
    showToast("Permissions mises à jour.");
    onChanged?.();
  }

  async function handleRemove(userId: string) {
    const res = await fetch(
      `/api/projects/${projectId}/members?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    );
    const json = (await res.json()) as {
      members?: ProjectMemberRow[];
      error?: string;
    };
    if (!res.ok) {
      setError(json.error ?? "Impossible de retirer cet accès.");
      return;
    }
    setMembers(json.members ?? []);
    showToast("Accès retiré.", "info");
    onChanged?.();
  }

  const existingIds = new Set<string>([
    ...(owner ? [owner.id] : []),
    ...members.map((m) => m.userId),
  ]);
  const quickSuggestions = teamUsers.filter((u) => !existingIds.has(u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-[#111827]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Partager le projet
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {projectLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200">
            {error}
          </div>
        )}

        {canManage && (
          <form onSubmit={(e) => void handleShare(e)} className="mt-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom@gamersorigin.com ou @lintrus.fr"
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Prénom / Nom (optionnel)"
                className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setRole("VIEWER")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    role === "VIEWER"
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Vue seule
                </button>
                <button
                  type="button"
                  onClick={() => setRole("EDITOR")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    role === "EDITOR"
                      ? "bg-white text-indigo-700 shadow-2xs dark:bg-slate-800 dark:text-indigo-300"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  }`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Vue & Gestion
                </button>
              </div>

              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {submitting ? "Partage..." : "Partager"}
              </button>
            </div>

            {quickSuggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-slate-400">Équipe :</span>
                {quickSuggestions.slice(0, 5).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setEmail(u.email);
                      setName(u.name);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pr-2.5 pl-1 text-[11px] font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <AvatarDisplay
                      avatarId={u.avatarId}
                      avatarBg={u.avatarBg}
                      size="xs"
                    />
                    {u.name}
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        {/* Current access list */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            Personnes ayant accès ({(owner ? 1 : 0) + members.length})
          </h3>

          {loading ? (
            <p className="py-4 text-center text-xs text-slate-400">
              Chargement des membres...
            </p>
          ) : (
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {owner && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <AvatarDisplay
                      avatarId={owner.avatarId}
                      avatarBg={owner.avatarBg}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                        {owner.name}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {owner.email}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    <Crown className="h-3 w-3" />
                    Propriétaire
                  </span>
                </div>
              )}

              {members.length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-400">
                  Ce projet n&apos;est encore partagé avec personne.
                </p>
              ) : (
                members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 dark:border-slate-800"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <AvatarDisplay
                        avatarId={m.user.avatarId}
                        avatarBg={m.user.avatarBg}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                          {m.user.name}
                        </p>
                        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {m.user.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {canManage ? (
                        <>
                          <select
                            aria-label={`Rôle de ${m.user.name}`}
                            value={m.role}
                            onChange={(e) =>
                              void handleRoleChange(
                                m.userId,
                                e.target.value as "VIEWER" | "EDITOR"
                              )
                            }
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="VIEWER">Vue seule</option>
                            <option value="EDITOR">Vue & Gestion</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleRemove(m.userId)}
                            title="Retirer l'accès"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/15"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {m.role === "EDITOR" ? "Vue & Gestion" : "Vue seule"}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
