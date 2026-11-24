"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface SettingsPayload {
  envStatus: {
    googleClientId: {
      configured: boolean;
      source: "db" | "env" | "none";
      masked: string | null;
    };
    googleClientSecret: {
      configured: boolean;
      source: "db" | "env" | "none";
      masked: string | null;
    };
    geminiApiKey: {
      configured: boolean;
      source: "db" | "env" | "none";
      masked: string | null;
    };
  };
  oauth: {
    connected: boolean;
    userEmail: string | null;
    expiresAt: string | null;
    scope: string;
    missingScopes: string[];
  };
  pennylane: {
    pennylaneEmail: string;
    defaultCcEmails: string;
  };
  sandbox: {
    sandboxMode: boolean;
    sharedDriveId: string;
    apresVenteFolderId: string;
    prodRootFolderId: string;
    prodImmutableIds: string[];
  };
}

const API_SCOPE_BADGES = [
  { label: "Drive", scope: "https://www.googleapis.com/auth/drive" },
  { label: "Sheets", scope: "https://www.googleapis.com/auth/spreadsheets" },
  { label: "Slides", scope: "https://www.googleapis.com/auth/presentations" },
  { label: "Gmail (Draft-First)", scope: "https://www.googleapis.com/auth/gmail.compose" },
  { label: "Calendar (Secondaire)", scope: "https://www.googleapis.com/auth/calendar" },
];

export default function SettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [pennylaneEmail, setPennylaneEmail] = useState("");
  const [defaultCcEmails, setDefaultCcEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [oauthStarting, setOauthStarting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [geminiResult, setGeminiResult] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (res.ok) {
      const payload = (await res.json()) as SettingsPayload;
      setData(payload);
      setPennylaneEmail(payload.pennylane.pennylaneEmail);
      setDefaultCcEmails(payload.pennylane.defaultCcEmails);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.ok && active) {
        const payload = (await res.json()) as SettingsPayload;
        setData(payload);
        setPennylaneEmail(payload.pennylane.pennylaneEmail);
        setDefaultCcEmails(payload.pennylane.defaultCcEmails);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(googleClientId.trim() ? { googleClientId } : {}),
          ...(googleClientSecret.trim() ? { googleClientSecret } : {}),
          ...(geminiApiKey.trim() ? { geminiApiKey } : {}),
          pennylaneEmail,
          defaultCcEmails,
        }),
      });
      const json = (await res.json()) as { error?: string; updatedKeys?: string[] };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Erreur lors de l'enregistrement.",
        });
      } else {
        setFeedback({
          type: "success",
          text: `Configuration chiffrée (AES-256-GCM) enregistrée : ${(json.updatedKeys ?? []).join(", ") || "aucune modification"}.`,
        });
        setGoogleClientId("");
        setGoogleClientSecret("");
        setGeminiApiKey("");
        await loadSettings();
        window.dispatchEvent(new CustomEvent("go:shell-refresh"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleTestGemini() {
    setTestingGemini(true);
    setGeminiResult(null);
    try {
      const res = await fetch("/api/settings/test-gemini", { method: "POST" });
      const json = (await res.json()) as {
        ok?: boolean;
        model?: string;
        latencyMs?: number;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setGeminiResult({
          type: "error",
          text: `[HTTP ${res.status} · ${json.code ?? "ERREUR"}] ${json.error ?? "Échec du test Gemini."}`,
        });
      } else {
        setGeminiResult({
          type: "success",
          text: `Gemini opérationnel (${json.model}, latence ${json.latencyMs} ms).`,
        });
      }
    } finally {
      setTestingGemini(false);
    }
  }

  async function handleGoogleConnect() {
    setOauthStarting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auth/google/start?mode=json");
      const json = (await res.json()) as { authUrl?: string; error?: string; code?: string };
      if (!res.ok || !json.authUrl) {
        setFeedback({
          type: "error",
          text: `[HTTP ${res.status} · ${json.code ?? "OAUTH"}] ${json.error ?? "Impossible de démarrer OAuth2."}`,
        });
        return;
      }
      window.location.href = json.authUrl;
    } finally {
      setOauthStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Paramètres, OAuth2 Google Workspace & Clé Gemini
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Configuration guidée et stockage local chiffré AES-256-GCM (aucun
            simulateur ni donnée factice).
          </p>
        </div>
      </div>

      {/* Permanent PROD Lock Card */}
      <div
        data-testid="prod-lock-banner"
        className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-5"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="space-y-1 text-sm">
            <p className="font-bold text-amber-200">
              Protection PROD Active — Lecture / Copie de templates uniquement
            </p>
            <p className="text-slate-300">
              Le dossier PROD{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-amber-300">
                16Vi3KE-5GzGTGsBtgSBnfhHu2cm20nxD
              </code>{" "}
              et ses 6 fichiers de référence sont strictement verrouillés en
              écriture par <code className="font-mono text-xs">SandboxGuard</code>.
              Toutes les écritures s&apos;exécutent dans{" "}
              <code className="font-mono text-xs text-cyan-300">
                [PILOTE - 326027] Caisse d&apos;Épargne - Fortnite
              </code>{" "}
              sous <code className="font-mono text-xs">3 - Après-vente</code>.
            </p>
          </div>
        </div>
      </div>

      {/* 4-Step French Setup Accordion */}
      <div className="rounded-xl border border-[#232b3d] bg-[#11151f]">
        <button
          type="button"
          onClick={() => setGuideOpen((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-cyan-400" />
            <span className="font-bold text-white">
              Guide rapide : obtenir et brancher vos clés Google Cloud & Gemini
            </span>
          </div>
          {guideOpen ? (
            <ChevronUp className="h-5 w-5 text-slate-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-400" />
          )}
        </button>

        {guideOpen && (
          <div className="grid gap-4 border-t border-[#232b3d] p-6 md:grid-cols-2">
            <div className="rounded-lg border border-[#232b3d] bg-[#171d2b]/70 p-4 text-xs text-slate-300">
              <p className="font-mono font-bold text-cyan-300">
                Étape 1 — Activer les 5 APIs Google Cloud
              </p>
              <p className="mt-1.5 leading-relaxed">
                Dans Google Cloud Console, activez : Google Drive API, Google
                Sheets API, Google Slides API, Gmail API et Google Calendar API.
              </p>
            </div>
            <div className="rounded-lg border border-[#232b3d] bg-[#171d2b]/70 p-4 text-xs text-slate-300">
              <p className="font-mono font-bold text-cyan-300">
                Étape 2 — Identifiants OAuth2 & URI de redirection
              </p>
              <p className="mt-1.5 leading-relaxed">
                Créez un ID client OAuth (Application Web) avec l&apos;URI
                autorisée :{" "}
                <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-white">
                  http://localhost:3000/api/auth/google/callback
                </code>
              </p>
            </div>
            <div className="rounded-lg border border-[#232b3d] bg-[#171d2b]/70 p-4 text-xs text-slate-300">
              <p className="font-mono font-bold text-cyan-300">
                Étape 3 — Clé API Gemini (Google AI Studio)
              </p>
              <p className="mt-1.5 leading-relaxed">
                Générez une clé sur aistudio.google.com pour le modèle{" "}
                <code className="font-mono text-white">gemini-2.5-flash</code>{" "}
                et collez-la ci-dessous ou dans <code className="font-mono">.env.local</code>.
              </p>
            </div>
            <div className="rounded-lg border border-[#232b3d] bg-[#171d2b]/70 p-4 text-xs text-slate-300">
              <p className="font-mono font-bold text-cyan-300">
                Étape 4 — Connexion & Test Bac à Sable
              </p>
              <p className="mt-1.5 leading-relaxed">
                Enregistrez les clés, cliquez sur &quot;Se connecter avec
                Google&quot;, testez Gemini puis créez le projet pilote depuis{" "}
                <code className="font-mono text-white">/projects</code>.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Credentials & Pennylane Form */}
      <form
        onSubmit={handleSave}
        className="space-y-5 rounded-xl border border-[#232b3d] bg-[#11151f] p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            Identifiants OAuth2, Gemini & Pennylane
          </h2>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-emerald-300">
            <Lock className="h-3.5 w-3.5" />
            Chiffrement AES-256-GCM
          </span>
        </div>

        {feedback && (
          <div
            role="status"
            className={`rounded-lg border p-3 text-sm ${
              feedback.type === "success"
                ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
                : "border-red-500/40 bg-red-950/40 text-red-200"
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label htmlFor="googleClientId" className="font-semibold text-slate-300">
                GOOGLE_CLIENT_ID
              </label>
              <span className="font-mono text-slate-400">
                {data?.envStatus.googleClientId.configured
                  ? `${data.envStatus.googleClientId.source.toUpperCase()} · ${data.envStatus.googleClientId.masked}`
                  : "Non configuré"}
              </span>
            </div>
            <input
              id="googleClientId"
              type="text"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
              placeholder={
                data?.envStatus.googleClientId.masked ??
                "xxxx.apps.googleusercontent.com"
              }
              className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label
                htmlFor="googleClientSecret"
                className="font-semibold text-slate-300"
              >
                GOOGLE_CLIENT_SECRET
              </label>
              <span className="font-mono text-slate-400">
                {data?.envStatus.googleClientSecret.configured
                  ? `${data.envStatus.googleClientSecret.source.toUpperCase()} · ${data.envStatus.googleClientSecret.masked}`
                  : "Non configuré"}
              </span>
            </div>
            <input
              id="googleClientSecret"
              type="password"
              value={googleClientSecret}
              onChange={(e) => setGoogleClientSecret(e.target.value)}
              placeholder={
                data?.envStatus.googleClientSecret.masked ?? "GOCSPX-..."
              }
              className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label htmlFor="geminiApiKey" className="font-semibold text-slate-300">
                GEMINI_API_KEY
              </label>
              <span className="font-mono text-slate-400">
                {data?.envStatus.geminiApiKey.configured
                  ? `${data.envStatus.geminiApiKey.source.toUpperCase()} · ${data.envStatus.geminiApiKey.masked}`
                  : "Non configuré"}
              </span>
            </div>
            <input
              id="geminiApiKey"
              type="password"
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder={data?.envStatus.geminiApiKey.masked ?? "AIzaSy..."}
              className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="pennylaneEmail"
              className="mb-1.5 block text-xs font-semibold text-slate-300"
            >
              Email Fournisseurs Pennylane
            </label>
            <input
              id="pennylaneEmail"
              type="email"
              value={pennylaneEmail}
              onChange={(e) => setPennylaneEmail(e.target.value)}
              className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 font-mono text-sm text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="defaultCcEmails"
              className="mb-1.5 block text-xs font-semibold text-slate-300"
            >
              Destinataires CC par défaut (Brouillons Factures)
            </label>
            <input
              id="defaultCcEmails"
              type="text"
              value={defaultCcEmails}
              onChange={(e) => setDefaultCcEmails(e.target.value)}
              className="w-full rounded-lg border border-[#232b3d] bg-[#171d2b] px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            data-testid="save-settings-btn"
            className="rounded-lg bg-[#e11d48] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#ff2e58] disabled:opacity-50"
          >
            {saving ? "Chiffrement en cours..." : "Enregistrer la configuration"}
          </button>
        </div>
      </form>

      {/* OAuth2 & Gemini Connection Tests */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">
              Connexion OAuth2 Google Workspace
            </h3>
            {data?.oauth.connected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {data?.oauth.connected
              ? `Connecté en tant que ${data.oauth.userEmail}`
              : "Aucune session OAuth2 active. Gmail fonctionne exclusivement en mode brouillon (sans gmail.send)."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {API_SCOPE_BADGES.map((item) => {
              const granted = data?.oauth.scope.includes(item.scope) ?? false;
              return (
                <span
                  key={item.label}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    granted
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-[#232b3d] bg-[#171d2b] text-slate-400"
                  }`}
                >
                  {item.label}
                </span>
              );
            })}
          </div>

          <button
            type="button"
            disabled={oauthStarting}
            onClick={() => void handleGoogleConnect()}
            data-testid="connect-google-btn"
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {oauthStarting
              ? "Initialisation OAuth2..."
              : data?.oauth.connected
                ? "Reconnecter Google Workspace"
                : "Se connecter avec Google"}
          </button>
        </div>

        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">
              Test de connectivité Gemini API
            </h3>
            <Sparkles className="h-5 w-5 text-cyan-400" />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Exécute un ping réel sur{" "}
            <code className="font-mono text-slate-200">gemini-2.5-flash</code>.
            Retourne HTTP 412 si la clé API est absente.
          </p>

          {geminiResult && (
            <div
              data-testid="gemini-test-result"
              className={`mt-4 rounded-lg border p-3 text-xs ${
                geminiResult.type === "success"
                  ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
                  : "border-red-500/40 bg-red-950/40 text-red-200"
              }`}
            >
              {geminiResult.text}
            </div>
          )}

          <button
            type="button"
            disabled={testingGemini}
            onClick={() => void handleTestGemini()}
            data-testid="test-gemini-btn"
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#232b3d] disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4 text-cyan-400" />
            {testingGemini ? "Test en cours..." : "Tester Gemini"}
          </button>
        </div>
      </div>
    </div>
  );
}
