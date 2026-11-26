"use client";

import {
  Check,
  Dices,
  LogIn,
  LogOut,
  Save,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { TemplatesQuickLinksCard } from "@/components/templates/TemplatesQuickLinksCard";
import {
  AVATAR_BG_OPTIONS,
  AVATAR_OPTIONS,
  DEFAULT_AVATAR_BG,
  DEFAULT_AVATAR_ID,
  getAvatarMeta,
  getRandomAvatar,
} from "@/lib/avatars";
import { showToast } from "@/lib/toast";

interface UserProfile {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  role: string;
  avatarId: string;
  avatarBg: string;
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [oauthOnly, setOauthOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sign-in form
  const [loginEmail, setLoginEmail] = useState("");
  const [loginName, setLoginName] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  // Profile editor
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [avatarId, setAvatarId] = useState(DEFAULT_AVATAR_ID);
  const [avatarBg, setAvatarBg] = useState(DEFAULT_AVATAR_BG);
  const [savingProfile, setSavingProfile] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const sessionRes = await fetch("/api/auth/session", { cache: "no-store" });
      if (sessionRes.ok) {
        const sJson = (await sessionRes.json()) as {
          user: UserProfile | null;
          users: UserProfile[];
          oauthConfigured?: boolean;
          authRequired?: boolean;
        };
        setUser(sJson.user);
        setUsers(sJson.users ?? []);
        setOauthOnly(Boolean(sJson.authRequired && sJson.oauthConfigured));
        if (sJson.user) {
          setName(sJson.user.name);
          setJobTitle(sJson.user.jobTitle ?? "");
          setAvatarId(sJson.user.avatarId);
          setAvatarBg(sJson.user.avatarBg);
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

  async function handleSignIn(emailValue: string, nameValue?: string) {
    if (!emailValue.trim()) return;
    setSigningIn(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailValue.trim(),
          name: nameValue?.trim() || undefined,
        }),
      });
      if (res.ok) {
        setLoginEmail("");
        setLoginName("");
        showToast("Session utilisateur activée !");
        await loadAll();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      } else {
        const err = (await res.json()) as { error?: string };
        showToast(err.error ?? "Connexion impossible.", "error");
      }
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    showToast("Déconnecté.", "info");
    await loadAll();
    window.dispatchEvent(new CustomEvent("go:shell-refresh"));
  }

  async function handleGoogleLogin() {
    const res = await fetch("/api/auth/google/start?mode=json");
    const json = (await res.json()) as { authUrl?: string; error?: string };
    if (res.ok && json.authUrl) {
      window.location.href = json.authUrl;
    } else {
      showToast(
        json.error ??
          "Configurez Google OAuth dans Paramètres ou utilisez la connexion par email ci-dessous.",
        "error"
      );
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          jobTitle: jobTitle.trim() || null,
          avatarId,
          avatarBg,
        }),
      });
      if (res.ok) {
        showToast("Profil & avatar enregistrés !");
        await loadAll();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      } else {
        const err = (await res.json()) as { error?: string };
        showToast(err.error ?? "Erreur lors de l'enregistrement.", "error");
      }
    } finally {
      setSavingProfile(false);
    }
  }

  const currentAvatarMeta = getAvatarMeta(avatarId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Mon profil &amp; Avatar
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Personnalisez votre avatar mignon et gérez votre session pour isoler
            vos projets.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="h-96 animate-pulse rounded-2xl border border-slate-200/80 bg-white lg:col-span-8 dark:border-slate-800 dark:bg-[#111827]" />
          <div className="h-96 animate-pulse rounded-2xl border border-slate-200/80 bg-white lg:col-span-4 dark:border-slate-800 dark:bg-[#111827]" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* LEFT: Avatar Customizer & Info */}
          <div className="space-y-6 lg:col-span-8">
            {user ? (
              <form
                onSubmit={(e) => void handleSaveProfile(e)}
                className="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
              >
                {/* Live Avatar Preview Banner */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="flex items-center gap-4">
                    <AvatarDisplay
                      avatarId={avatarId}
                      avatarBg={avatarBg}
                      size="xl"
                    />
                    <div>
                      <p className="text-base font-bold text-slate-900 dark:text-white">
                        {name || user.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {user.email}
                      </p>
                      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                        <span className="font-semibold">
                          {currentAvatarMeta.label}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {currentAvatarMeta.vibe}
                        </span>
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const pick = getRandomAvatar();
                      setAvatarId(pick.avatarId);
                      setAvatarBg(pick.avatarBg);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <Dices className="h-4 w-4 text-rose-500" />
                    Aléatoire
                  </button>
                </div>

                {/* Name & Job Title */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                      Nom d&apos;affichage
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                      Poste / Rôle équipe
                    </label>
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="ex : Chef de projet, Producteur..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                {/* Cute & Funny Icon Picker */}
                <div>
                  <label className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Choisissez votre compagnon d&apos;avatar
                  </label>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {AVATAR_OPTIONS.map((opt) => {
                      const selected = avatarId === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setAvatarId(opt.id)}
                          data-testid={`avatar-opt-${opt.id}`}
                          className={`group relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-all ${
                            selected
                              ? "border-rose-500 bg-rose-50/60 ring-2 ring-rose-500/20 dark:border-rose-400 dark:bg-rose-500/15"
                              : "border-slate-200/80 bg-white hover:border-indigo-300 hover:bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-indigo-500/40"
                          }`}
                        >
                          {selected && (
                            <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-white">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                          <AvatarDisplay
                            avatarId={opt.id}
                            avatarBg={avatarBg}
                            size="lg"
                          />
                          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Background Color Picker */}
                <div>
                  <label className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Couleur de fond
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {AVATAR_BG_OPTIONS.map((bg) => {
                      const active =
                        avatarBg.toLowerCase() === bg.hex.toLowerCase();
                      return (
                        <button
                          key={bg.id}
                          type="button"
                          onClick={() => setAvatarBg(bg.hex)}
                          title={bg.label}
                          style={{ backgroundColor: bg.hex }}
                          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-110 ${
                            active
                              ? "scale-110 border-slate-900 dark:border-white"
                              : "border-white shadow-xs dark:border-slate-700"
                          }`}
                        >
                          {active && <Check className="h-4 w-4 text-slate-900" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    data-testid="save-profile-btn"
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {savingProfile ? "Enregistrement..." : "Enregistrer mon profil"}
                  </button>
                </div>
              </form>
            ) : (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-[#111827]">
                <div className="mx-auto flex justify-center gap-2">
                  <AvatarDisplay avatarId="gamer-cat" avatarBg="#FDE68A" size="lg" />
                  <AvatarDisplay avatarId="happy-axolotl" avatarBg="#FBCFE8" size="lg" />
                  <AvatarDisplay avatarId="cozy-capybara" avatarBg="#A7F3D0" size="lg" />
                </div>
                <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                  Connectez-vous pour créer vos projets privés et personnaliser
                  votre avatar
                </h2>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                  Chaque utilisateur voit uniquement les projets qu&apos;il crée
                  et ceux qui lui sont partagés (en Vue seule ou Vue & Gestion).
                </p>
              </section>
            )}
          </div>

          {/* RIGHT: Session & Quick Switcher */}
          <aside className="space-y-5 lg:col-span-4">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Connexion & Session
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Connectez-vous avec Google ou via votre email professionnel.
              </p>

              <button
                type="button"
                onClick={() => void handleGoogleLogin()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <ShieldCheck className="h-4 w-4" />
                Se connecter avec Google Workspace
              </button>

              {!oauthOnly && (
                <>
                  <div className="my-4 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                    ou profil local (dev)
                    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSignIn(loginEmail, loginName);
                    }}
                    className="space-y-2.5"
                  >
                    <input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="prenom@gamersorigin.com ou @lintrus.fr"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <input
                      type="text"
                      value={loginName}
                      onChange={(e) => setLoginName(e.target.value)}
                      placeholder="Votre nom (optionnel)"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 focus:border-indigo-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                      type="submit"
                      disabled={signingIn}
                      data-testid="email-signin-btn"
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      {signingIn ? "Connexion..." : "Se connecter / Créer profil"}
                    </button>
                  </form>
                </>
              )}

              {user && (
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100/70 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Se déconnecter
                </button>
              )}
            </section>

            {/* Quick Switcher for existing profiles (dev / non-OAuth only) */}
            {!oauthOnly && users.length > 0 && (
              <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
                <h3 className="text-xs font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                  Profils de l&apos;équipe ({users.length})
                </h3>
                <div className="mt-3 space-y-2">
                  {users.map((u) => {
                    const isMe = user?.id === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        disabled={isMe || signingIn}
                        onClick={() => void handleSignIn(u.email, u.name)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                          isMe
                            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                            : "border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <AvatarDisplay
                            avatarId={u.avatarId}
                            avatarBg={u.avatarBg}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                              {u.name}
                            </p>
                            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {u.email}
                            </p>
                          </div>
                        </div>
                        {isMe ? (
                          <UserCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <span className="shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                            Basculer
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <TemplatesQuickLinksCard />
          </aside>
        </div>
      )}
    </div>
  );
}
