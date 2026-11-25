"use client";

import {
  Check,
  Dices,
  FileSpreadsheet,
  GanttChartSquare,
  LogIn,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import {
  AVATAR_BG_OPTIONS,
  AVATAR_OPTIONS,
  DEFAULT_AVATAR_BG,
  DEFAULT_AVATAR_ID,
  getAvatarMeta,
  getRandomAvatar,
} from "@/lib/avatars";
import {
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_META,
  type BlankBudgetTemplateLine,
  type BlankRetroTemplateTask,
  type ProjectCategory,
} from "@/lib/templates/project-templates";
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

interface TemplateCategoryPayload {
  category: ProjectCategory;
  budgetLines: BlankBudgetTemplateLine[];
}

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<"profile" | "templates">("profile");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
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

  // Templates editor
  const [selectedTemplateTarget, setSelectedTemplateTarget] = useState<
    ProjectCategory | "RETRO_GLOBAL"
  >("JEU");
  const [budgetTemplates, setBudgetTemplates] = useState<
    Record<ProjectCategory, BlankBudgetTemplateLine[]>
  >({
    JEU: [],
    YOUTUBE: [],
    EVENEMENT: [],
    SPONSOR: [],
  });
  const [retroTasks, setRetroTasks] = useState<BlankRetroTemplateTask[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // New blank budget line inputs
  const [newLineCat, setNewLineCat] = useState("PRODUCTION");
  const [newLineObjet, setNewLineObjet] = useState("");
  const [newLineType, setNewLineType] = useState<
    "Externe" | "RH Internes" | "Amortissement"
  >("Externe");

  // New blank retro task inputs
  const [newRetroPhase, setNewRetroPhase] = useState("3. Production");
  const [newRetroEtape, setNewRetroEtape] = useState("Réalisation");
  const [newRetroTache, setNewRetroTache] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, tplRes] = await Promise.all([
        fetch("/api/auth/session", { cache: "no-store" }),
        fetch("/api/templates", { cache: "no-store" }),
      ]);
      if (sessionRes.ok) {
        const sJson = (await sessionRes.json()) as {
          user: UserProfile | null;
          users: UserProfile[];
        };
        setUser(sJson.user);
        setUsers(sJson.users ?? []);
        if (sJson.user) {
          setName(sJson.user.name);
          setJobTitle(sJson.user.jobTitle ?? "");
          setAvatarId(sJson.user.avatarId);
          setAvatarBg(sJson.user.avatarBg);
        }
      }
      if (tplRes.ok) {
        const tJson = (await tplRes.json()) as {
          categories: TemplateCategoryPayload[];
          retroTasks: BlankRetroTemplateTask[];
        };
        const map: Record<ProjectCategory, BlankBudgetTemplateLine[]> = {
          JEU: [],
          YOUTUBE: [],
          EVENEMENT: [],
          SPONSOR: [],
        };
        for (const item of tJson.categories ?? []) {
          map[item.category] = item.budgetLines;
        }
        setBudgetTemplates(map);
        setRetroTasks(tJson.retroTasks ?? []);
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

  async function handleSaveTemplate() {
    setSavingTemplate(true);
    try {
      const payload =
        selectedTemplateTarget === "RETRO_GLOBAL"
          ? { target: "RETRO_GLOBAL", retroTasks }
          : {
              target: selectedTemplateTarget,
              budgetLines: budgetTemplates[selectedTemplateTarget],
            };
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast("Modèle vierge enregistré !");
        await loadAll();
      } else {
        showToast("Impossible d'enregistrer le modèle.", "error");
      }
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleResetTemplate() {
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: selectedTemplateTarget, reset: true }),
      });
      if (res.ok) {
        showToast("Modèle par défaut restauré.", "info");
        await loadAll();
      }
    } finally {
      setSavingTemplate(false);
    }
  }

  const currentAvatarMeta = getAvatarMeta(avatarId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Mon profil, avatars & modèles vierges
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Personnalisez votre avatar, gérez votre session pour isoler vos
            projets et ajustez vos modèles types par catégorie.
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-[#111827]">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "profile"
                ? "bg-rose-600 text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-300"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Profil & Avatar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("templates")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === "templates"
                ? "bg-rose-600 text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-300"
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Modèles vierges
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827]">
          Chargement du profil...
        </div>
      ) : activeTab === "profile" ? (
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
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Se connecter avec Google
              </button>

              <div className="my-4 flex items-center gap-2 text-[11px] text-slate-400">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                ou profil par email
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
                  placeholder="prenom@gamersorigin.com"
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

            {/* Quick Switcher for existing profiles */}
            {users.length > 0 && (
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
          </aside>
        </div>
      ) : (
        /* TAB 2: Blank Templates Editor */
        <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {PROJECT_CATEGORIES.map((cat) => {
                const meta = PROJECT_CATEGORY_META[cat];
                const active = selectedTemplateTarget === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedTemplateTarget(cat)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? "bg-slate-900 text-white dark:bg-indigo-600"
                        : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                  >
                    Budget · {meta.label} ({budgetTemplates[cat].length})
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedTemplateTarget("RETRO_GLOBAL")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                  selectedTemplateTarget === "RETRO_GLOBAL"
                    ? "bg-slate-900 text-white dark:bg-indigo-600"
                    : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                <GanttChartSquare className="h-3.5 w-3.5" />
                Rétroplanning vierge ({retroTasks.length})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={savingTemplate}
                onClick={() => void handleResetTemplate()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Réinitialiser
              </button>
              <button
                type="button"
                disabled={savingTemplate}
                onClick={() => void handleSaveTemplate()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {savingTemplate ? "Enregistrement..." : "Sauvegarder le modèle"}
              </button>
            </div>
          </div>

          {selectedTemplateTarget === "RETRO_GLOBAL" ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ces tâches types sont pré-créées automatiquement (sans dates)
                sur chaque nouveau projet.
              </p>

              <div className="grid gap-2 sm:grid-cols-4">
                <input
                  type="text"
                  value={newRetroPhase}
                  onChange={(e) => setNewRetroPhase(e.target.value)}
                  placeholder="Phase (ex: 3. Production)"
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={newRetroEtape}
                  onChange={(e) => setNewRetroEtape(e.target.value)}
                  placeholder="Étape"
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={newRetroTache}
                  onChange={(e) => setNewRetroTache(e.target.value)}
                  placeholder="Nom de la tâche..."
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newRetroTache.trim()) return;
                    setRetroTasks((prev) => [
                      ...prev,
                      {
                        phase: newRetroPhase.trim() || "Production",
                        etape: newRetroEtape.trim() || "Général",
                        tache: newRetroTache.trim(),
                        isMilestone: false,
                        milestoneType: null,
                      },
                    ]);
                    setNewRetroTache("");
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter tâche
                </button>
              </div>

              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {retroTasks.map((t, idx) => (
                  <div
                    key={`${t.phase}-${t.tache}-${idx}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {t.tache}
                      </span>
                      <span className="ml-2 text-slate-400">
                        {t.phase} · {t.etape}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setRetroTasks((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lignes de dépenses habituelles pré-créées à{" "}
                <strong>0&nbsp;€</strong> pour chaque nouveau{" "}
                <strong>
                  {PROJECT_CATEGORY_META[selectedTemplateTarget].label}
                </strong>
                .
              </p>

              <div className="grid gap-2 sm:grid-cols-4">
                <input
                  type="text"
                  value={newLineCat}
                  onChange={(e) => setNewLineCat(e.target.value)}
                  placeholder="Section / Catégorie"
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <input
                  type="text"
                  value={newLineObjet}
                  onChange={(e) => setNewLineObjet(e.target.value)}
                  placeholder="Nom du poste de dépense..."
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <select
                  value={newLineType}
                  onChange={(e) =>
                    setNewLineType(
                      e.target.value as
                        | "Externe"
                        | "RH Internes"
                        | "Amortissement"
                    )
                  }
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="Externe">Externe</option>
                  <option value="RH Internes">RH Internes</option>
                  <option value="Amortissement">Amortissement</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!newLineObjet.trim()) return;
                    setBudgetTemplates((prev) => ({
                      ...prev,
                      [selectedTemplateTarget]: [
                        ...prev[selectedTemplateTarget],
                        {
                          category: newLineCat.trim() || "PRODUCTION",
                          objet: newLineObjet.trim(),
                          expenseType: newLineType,
                        },
                      ],
                    }));
                    setNewLineObjet("");
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter poste
                </button>
              </div>

              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {budgetTemplates[selectedTemplateTarget].map((line, idx) => (
                  <div
                    key={`${line.category}-${line.objet}-${idx}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {line.objet}
                      </span>
                      <span className="ml-2 text-slate-400">
                        {line.category} · {line.expenseType}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setBudgetTemplates((prev) => ({
                          ...prev,
                          [selectedTemplateTarget]: prev[
                            selectedTemplateTarget
                          ].filter((_, i) => i !== idx),
                        }))
                      }
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
