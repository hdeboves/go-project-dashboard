"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  HelpCircle,
  Lock,
  Mail,
  Mic,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/lib/toast";

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
}

const GOOGLE_SERVICES = [
  { label: "Drive", scope: "https://www.googleapis.com/auth/drive" },
  { label: "Sheets", scope: "https://www.googleapis.com/auth/spreadsheets" },
  { label: "Slides", scope: "https://www.googleapis.com/auth/presentations" },
  { label: "Gmail (brouillons)", scope: "https://www.googleapis.com/auth/gmail.compose" },
  { label: "Agenda", scope: "https://www.googleapis.com/auth/calendar" },
];

export default function SettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [techKeysOpen, setTechKeysOpen] = useState(false);
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
  const [krispConfig, setKrispConfig] = useState<{
    webhookUrlWithSecret: string;
    stats: { totalMeetings: number; savedToDriveCount: number };
  } | null>(null);
  const [rotatingKrisp, setRotatingKrisp] = useState(false);
  const [confirmRotateKrisp, setConfirmRotateKrisp] = useState(false);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (res.ok) {
      const payload = (await res.json()) as SettingsPayload;
      setData(payload);
      setPennylaneEmail(payload.pennylane.pennylaneEmail);
      setDefaultCcEmails(payload.pennylane.defaultCcEmails);
      if (
        !(payload.oauth.connected && payload.envStatus.geminiApiKey.configured)
      ) {
        setGuideOpen(true);
        setTechKeysOpen(true);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const [res, krispRes] = await Promise.all([
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/integrations/krisp/config", { cache: "no-store" }),
      ]);
      if (krispRes.ok && active) {
        setKrispConfig(
          (await krispRes.json()) as {
            webhookUrlWithSecret: string;
            stats: { totalMeetings: number; savedToDriveCount: number };
          }
        );
      }
      if (res.ok && active) {
        const payload = (await res.json()) as SettingsPayload;
        setData(payload);
        setPennylaneEmail(payload.pennylane.pennylaneEmail);
        setDefaultCcEmails(payload.pennylane.defaultCcEmails);
        if (
          !(payload.oauth.connected && payload.envStatus.geminiApiKey.configured)
        ) {
          setGuideOpen(true);
          setTechKeysOpen(true);
        }
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
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: json.error ?? "Impossible d'enregistrer les paramètres.",
        });
      } else {
        setFeedback({
          type: "success",
          text: "Vos paramètres ont été enregistrés.",
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
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok) {
        setGeminiResult({
          type: "error",
          text: json.error ?? "L'assistant IA n'a pas pu répondre.",
        });
      } else {
        setGeminiResult({
          type: "success",
          text: `Assistant IA connecté et opérationnel (${json.latencyMs ?? 0} ms).`,
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
      const json = (await res.json()) as { authUrl?: string; error?: string };
      if (!res.ok || !json.authUrl) {
        setFeedback({
          type: "error",
          text:
            json.error ??
            "Renseignez d'abord les clés Google ci-dessous.",
        });
        setTechKeysOpen(true);
        return;
      }
      window.location.href = json.authUrl;
    } finally {
      setOauthStarting(false);
    }
  }

  const allReady = Boolean(
    data?.oauth.connected && data?.envStatus.geminiApiKey.configured
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Clean Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Paramètres
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Connexions Google Workspace, assistant IA et adresses de
            facturation.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setGuideOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-300 dark:hover:bg-slate-800/70"
        >
          <HelpCircle className="h-4 w-4 text-slate-400" />
          {guideOpen ? "Masquer l'aide" : "Guide d'installation"}
        </button>
      </div>

      {/* Collapsible Setup Guide */}
      {guideOpen && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5 dark:border-indigo-500/30 dark:bg-indigo-500/15">
          <h2 className="mb-3 text-sm font-semibold text-indigo-950 dark:text-indigo-100">
            Guide de mise en route rapide
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-white p-3.5 text-xs text-slate-600 shadow-2xs dark:bg-[#111827] dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-white">
                1. Activer les APIs Google
              </p>
              <p className="mt-1">
                Activez Drive, Sheets, Slides, Gmail et Agenda dans Google Cloud
                Console.
              </p>
            </div>
            <div className="rounded-xl bg-white p-3.5 text-xs text-slate-600 shadow-2xs dark:bg-[#111827] dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-white">
                2. Adresse de retour OAuth
              </p>
              <p className="mt-1">
                Ajoutez{" "}
                <code className="break-all rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  https://go-project-dashboard.vercel.app/api/auth/google/callback
                </code>{" "}
                (et{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  http://localhost:3000/api/auth/google/callback
                </code>{" "}
                en local)
              </p>
            </div>
            <div className="rounded-xl bg-white p-3.5 text-xs text-slate-600 shadow-2xs dark:bg-[#111827] dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-white">
                3. Ajouter la clé Gemini
              </p>
              <p className="mt-1">
                Créez une clé sur Google AI Studio puis collez-la dans la
                section Clés d&apos;accès ci-dessous.
              </p>
            </div>
            <div className="rounded-xl bg-white p-3.5 text-xs text-slate-600 shadow-2xs dark:bg-[#111827] dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-white">
                4. Se connecter et démarrer
              </p>
              <p className="mt-1">
                Cliquez sur « Se connecter avec Google » puis ouvrez votre
                projet.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Connections Status Cards */}
      <div className="grid gap-5 md:grid-cols-3">
        <section className="flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    data?.oauth.connected
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                      : "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400"
                  }`}
                >
                  {data?.oauth.connected ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <AlertTriangle className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    Google Workspace
                  </h2>
                  <p
                    title={data?.oauth.userEmail ?? undefined}
                    className="truncate text-xs text-slate-500 dark:text-slate-400"
                  >
                    {data?.oauth.connected
                      ? data.oauth.userEmail
                      : "Non connecté"}
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  data?.oauth.connected
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                }`}
              >
                {data?.oauth.connected ? "Connecté" : "À connecter"}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {GOOGLE_SERVICES.map((item) => {
                const granted = data?.oauth.scope.includes(item.scope) ?? false;
                return (
                  <span
                    key={item.label}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      granted
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                    }`}
                  >
                    {granted ? "✓ " : ""}
                    {item.label}
                  </span>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            disabled={oauthStarting}
            onClick={() => void handleGoogleConnect()}
            data-testid="connect-google-btn"
            className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
              data?.oauth.connected
                ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
                : "bg-rose-600 text-white hover:bg-rose-700"
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            {oauthStarting
              ? "Ouverture de Google..."
              : data?.oauth.connected
                ? "Changer / reconnecter le compte"
                : "Se connecter avec Google"}
          </button>
        </section>

        <section className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    data?.envStatus.geminiApiKey.configured
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                      : "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400"
                  }`}
                >
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Assistant IA (Gemini)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Factures PDF, veille mails & captures
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  data?.envStatus.geminiApiKey.configured
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                }`}
              >
                {data?.envStatus.geminiApiKey.configured ? "Prêt" : "À activer"}
              </span>
            </div>

            {geminiResult && (
              <div
                data-testid="gemini-test-result"
                className={`mt-4 rounded-xl border px-3.5 py-2.5 text-xs ${
                  geminiResult.type === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200"
                }`}
              >
                {geminiResult.text}
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={testingGemini}
            onClick={() => void handleTestGemini()}
            data-testid="test-gemini-btn"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            {testingGemini ? "Test en cours..." : "Tester la connexion IA"}
          </button>
        </section>

        {/* Krisp CR Webhook Card */}
        <section
          data-testid="settings-krisp-card"
          className="flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]"
        >
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                  <Mic className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    Krisp (CR Auto)
                  </h2>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    Dossier Drive « Comptes rendus »
                  </p>
                </div>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                Prêt
              </span>
            </div>

            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              {krispConfig
                ? `${krispConfig.stats.totalMeetings} CR reçu(s) · ${krispConfig.stats.savedToDriveCount} enregistré(s) sur Drive`
                : "Chargement du lien webhook..."}
            </p>
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!krispConfig}
                onClick={async () => {
                  if (!krispConfig) return;
                  await navigator.clipboard.writeText(
                    krispConfig.webhookUrlWithSecret
                  );
                  showToast("Lien Webhook Krisp copié !");
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200 dark:hover:bg-slate-800/70"
              >
                <Copy className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                Copier Webhook
              </button>
              <button
                type="button"
                disabled={rotatingKrisp}
                title="Réinitialiser la clé secrète du webhook Krisp"
                onClick={() => setConfirmRotateKrisp((v) => !v)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${rotatingKrisp ? "animate-spin" : ""}`}
                />
              </button>
            </div>
            {confirmRotateKrisp && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-2.5 text-[11px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200">
                <p>
                  Régénérer cette clé désactivera l&apos;ancien lien dans Krisp.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={rotatingKrisp}
                    onClick={async () => {
                      setRotatingKrisp(true);
                      try {
                        const res = await fetch(
                          "/api/integrations/krisp/config",
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "rotate" }),
                          }
                        );
                        if (res.ok) {
                          const refreshed = await fetch(
                            "/api/integrations/krisp/config",
                            { cache: "no-store" }
                          );
                          if (refreshed.ok) {
                            setKrispConfig(
                              (await refreshed.json()) as {
                                webhookUrlWithSecret: string;
                                stats: {
                                  totalMeetings: number;
                                  savedToDriveCount: number;
                                };
                              }
                            );
                          }
                          setConfirmRotateKrisp(false);
                          showToast("Nouvelle clé secrète Krisp générée.");
                        }
                      } finally {
                        setRotatingKrisp(false);
                      }
                    }}
                    className="rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700"
                  >
                    Confirmer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRotateKrisp(false)}
                    className="rounded-lg px-2 py-1 font-medium text-slate-600 dark:text-slate-300"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="space-y-5">
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

        {/* Pennylane Card */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Facturation Pennylane
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pré-remplit vos brouillons Gmail lors de la validation d&apos;une
                facture.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="pennylaneEmail"
                className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Email fournisseurs Pennylane
              </label>
              <input
                id="pennylaneEmail"
                type="email"
                value={pennylaneEmail}
                onChange={(e) => setPennylaneEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="defaultCcEmails"
                className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Personnes en copie (CC)
              </label>
              <input
                id="defaultCcEmails"
                type="text"
                value={defaultCcEmails}
                onChange={(e) => setDefaultCcEmails(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-900 focus:border-rose-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
              />
            </div>
          </div>
        </section>

        {/* Technical Keys Accordion */}
        <section className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
          <button
            type="button"
            onClick={() => setTechKeysOpen((v) => !v)}
            className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-slate-50/60 dark:hover:bg-slate-800/70"
          >
            <div className="flex items-center gap-3">
              <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Clés d&apos;accès techniques (Google & Gemini)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {allReady
                    ? "Toutes les clés sont enregistrées et chiffrées."
                    : "À renseigner lors de la première configuration."}
                </p>
              </div>
            </div>
            {techKeysOpen ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {techKeysOpen && (
            <div className="grid gap-4 border-t border-slate-100 p-6 md:grid-cols-3 dark:border-slate-800/80">
              <div>
                <label
                  htmlFor="googleClientId"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  ID Client Google
                </label>
                <input
                  id="googleClientId"
                  type="text"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  placeholder={
                    data?.envStatus.googleClientId.masked ??
                    "xxxx.apps.googleusercontent.com"
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 font-mono text-xs text-slate-900 focus:border-rose-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="googleClientSecret"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Secret Client Google
                </label>
                <input
                  id="googleClientSecret"
                  type="password"
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  placeholder={
                    data?.envStatus.googleClientSecret.masked ?? "GOCSPX-..."
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 font-mono text-xs text-slate-900 focus:border-rose-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="geminiApiKey"
                  className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Clé API Gemini
                </label>
                <input
                  id="geminiApiKey"
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={
                    data?.envStatus.geminiApiKey.masked ?? "AIzaSy..."
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 font-mono text-xs text-slate-900 focus:border-rose-400 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-800/60 dark:text-white dark:focus:bg-slate-900"
                />
              </div>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div
            data-testid="prod-lock-banner"
            className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
          >
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>
              Vos dossiers de production Drive sont protégés contre toute
              modification.
            </span>
          </div>

          <button
            type="submit"
            disabled={saving}
            data-testid="save-settings-btn"
            className="rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}
