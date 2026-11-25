import { cookies } from "next/headers";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  FolderGit2,
  FolderKanban,
  Mic,
  Plus,
  Presentation,
  Receipt,
  Settings,
  Sparkles,
} from "lucide-react";
import { ACTIVE_PROJECT_COOKIE } from "@/app/api/shell/status/route";
import { UpcomingTasksCard } from "@/components/cockpit/UpcomingTasksCard";
import { buildVisibleProjectsWhere, getCurrentUser } from "@/lib/auth/session";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import {
  PROJECT_CATEGORY_META,
  normalizeProjectCategory,
} from "@/lib/templates/project-templates";

export const dynamic = "force-dynamic";

function formatEurCompact(val: number): string {
  const rounded = Math.round(Number.isFinite(val) ? val : 0);
  const formatted = rounded
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  return `${formatted}\u00A0€`;
}

function formatShortDate(date: Date | null): string {
  if (!date) return "Sans date";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(date);
}

const HUMAN_ACTION_LABELS: Record<string, string> = {
  SETTINGS_UPDATED: "Paramètres mis à jour",
  OAUTH_CONNECTED: "Compte Google connecté",
  PROJECT_CREATED: "Nouveau projet créé",
  SANDBOX_BOOTSTRAPPED: "Projet pilote initialisé",
  DRIVE_TREE_PROVISIONED: "Dossiers Drive créés",
  DRIVE_EXT_SYNCED: "Fichiers publiés au client",
  BUDGET_IMPORTED: "Budget importé",
  BUDGET_LINE_UPSERTED: "Poste budgétaire modifié",
  INVOICE_INGESTED: "Facture PDF ajoutée",
  INVOICE_GMAIL_SCAN: "Scan factures Gmail",
  INVOICE_VALIDATED: "Facture validée (Pennylane)",
  CP_CONFLICT_BLOCKED: "Document bloqué (autre CP)",
  KRISP_MEETING_INGESTED: "CR Krisp classé dans Drive",
  KRISP_ACTIONS_TO_TASKS: "Actions Krisp ajoutées au planning",
  RETRO_TASK_UPDATED: "Planning mis à jour",
  RETRO_SNAPSHOT_CREATED: "Archive planning créée",
  CALENDAR_SYNCED: "Rappels Agenda mis à jour",
  WEEKLY_GENERATED: "Weekly Client généré",
  REPORTING_SLIDES_GENERATED: "Slides Reporting générés",
  REPORTING_PUBLISHED_EXT: "Reporting publié au client",
};

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const sp = await searchParams;
  const [cookieStore, currentUser] = await Promise.all([
    cookies(),
    getCurrentUser(prisma),
  ]);
  const cookieProjectId = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value ?? null;

  const projects = await prisma.project.findMany({
    where: buildVisibleProjectsWhere(currentUser),
    orderBy: [{ isSandbox: "desc" }, { createdAt: "asc" }],
  });

  const targetId = sp.projectId || cookieProjectId;
  const activeProject =
    projects.find((p) => p.id === targetId) ?? projects[0] ?? null;

  const [googleConn, geminiRow, recentLogs] = await Promise.all([
    prisma.googleConnection.findFirst({ orderBy: { updatedAt: "desc" } }),
    prisma.appSetting.findUnique({ where: { key: "GEMINI_API_KEY" } }),
    prisma.auditLog.findMany({
      where: activeProject ? { projectId: activeProject.id } : undefined,
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
  ]);

  let hasDbGemini = false;
  if (geminiRow?.valueEnc) {
    try {
      hasDbGemini = decryptSecret(geminiRow.valueEnc).trim().length > 0;
    } catch {
      hasDbGemini = false;
    }
  }
  const geminiConfigured =
    hasDbGemini || Boolean(process.env.GEMINI_API_KEY?.trim());
  const setupComplete =
    Boolean(googleConn) && geminiConfigured && Boolean(activeProject);

  let budgetSoldHt = 0;
  let budgetPreOpHt = 0;
  let budgetPostOpHt = 0;
  let forecastCostHt = 0;
  let overrunCount = 0;
  let pendingInvoices = 0;
  let extDrift = 0;
  let retroProposals = 0;
  let totalTasks = 0;
  let doneTasks = 0;
  let lateTasksCount = 0;
  let upcomingTasks: Array<{
    id: string;
    tache: string;
    phase: string;
    owner: string | null;
    endDate: Date | null;
    status: string;
  }> = [];

  if (activeProject) {
    const [
      budgetLines,
      invPending,
      drift,
      proposals,
      tasksCount,
      tasksDoneCount,
      tasksLateCount,
      nextTasks,
    ] = await Promise.all([
      prisma.budgetLine.findMany({
        where: { projectId: activeProject.id },
        select: { saleTotalHt: true, preOpTotalHt: true, postOpTotalHt: true },
      }),
      prisma.invoice.count({
        where: { projectId: activeProject.id, status: "PENDING_VALIDATION" },
      }),
      prisma.syncStatus.count({
        where: { projectId: activeProject.id, driftDetected: true },
      }),
      prisma.retroProposal.count({
        where: { projectId: activeProject.id, status: "PENDING" },
      }),
      prisma.retroTask.count({ where: { projectId: activeProject.id } }),
      prisma.retroTask.count({
        where: { projectId: activeProject.id, status: "TERMINE" },
      }),
      prisma.retroTask.count({
        where: {
          projectId: activeProject.id,
          status: { not: "TERMINE" },
          endDate: { lt: new Date() },
        },
      }),
      prisma.retroTask.findMany({
        where: {
          projectId: activeProject.id,
          status: { not: "TERMINE" },
        },
        orderBy: [{ endDate: "asc" }, { createdAt: "asc" }],
        take: 5,
        select: {
          id: true,
          tache: true,
          phase: true,
          owner: true,
          endDate: true,
          status: true,
        },
      }),
    ]);

    budgetSoldHt = budgetLines.reduce((s, l) => s + l.saleTotalHt, 0);
    budgetPreOpHt = budgetLines.reduce((s, l) => s + l.preOpTotalHt, 0);
    budgetPostOpHt = budgetLines.reduce((s, l) => s + l.postOpTotalHt, 0);
    forecastCostHt = budgetLines.reduce(
      (s, l) => s + Math.max(l.preOpTotalHt, l.postOpTotalHt),
      0
    );
    overrunCount = budgetLines.filter(
      (l) => l.postOpTotalHt > l.preOpTotalHt
    ).length;
    pendingInvoices = invPending;
    extDrift = drift;
    retroProposals = proposals;
    totalTasks = tasksCount;
    doneTasks = tasksDoneCount;
    lateTasksCount = tasksLateCount;
    upcomingTasks = nextTasks;
  }

  const budgetPct =
    budgetPreOpHt > 0
      ? Math.round((budgetPostOpHt / budgetPreOpHt) * 100)
      : 0;
  const budgetExactSold =
    budgetPreOpHt > 0 &&
    Math.round(budgetPostOpHt * 100) === Math.round(budgetPreOpHt * 100);
  const budgetOverrunStrict =
    overrunCount > 0 ||
    Math.round(budgetPostOpHt * 100) > Math.round(budgetPreOpHt * 100);
  const budgetWarning90 =
    !budgetOverrunStrict && !budgetExactSold && budgetPct >= 90;
  const forecastMarginHt = budgetSoldHt - forecastCostHt;
  const forecastMarginPct =
    budgetSoldHt > 0
      ? Math.round((forecastMarginHt / budgetSoldHt) * 1000) / 10
      : 0;
  const marginTone: "emerald" | "amber" | "rose" =
    forecastMarginHt < 0
      ? "rose"
      : forecastMarginPct >= 30
        ? "emerald"
        : "amber";
  const marginBadgeLabel =
    marginTone === "rose"
      ? "Sous tension"
      : marginTone === "emerald"
        ? "Saine"
        : "Vigilance";
  const tasksPct =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const urgentItems = [
    ...(overrunCount > 0
      ? [
          {
            href: "/budget?overruns=1",
            label: `${overrunCount} poste${overrunCount > 1 ? "s" : ""} en dépassement budgétaire`,
            cta: "Voir le budget",
            tone: "rose" as const,
            icon: AlertTriangle,
          },
        ]
      : []),
    ...(lateTasksCount > 0
      ? [
          {
            href: "/retroplanning",
            label: `${lateTasksCount} tâche${lateTasksCount > 1 ? "s" : ""} dont l'échéance est dépassée`,
            cta: "Traiter",
            tone: "rose" as const,
            icon: Clock,
          },
        ]
      : []),
    ...(pendingInvoices > 0
      ? [
          {
            href: "/budget?tab=invoices",
            label: `${pendingInvoices} facture${pendingInvoices > 1 ? "s" : ""} en attente de validation`,
            cta: "Valider",
            tone: "amber" as const,
            icon: Receipt,
          },
        ]
      : []),
    ...(retroProposals > 0
      ? [
          {
            href: "/retroplanning?tab=ai",
            label: `${retroProposals} suggestion${retroProposals > 1 ? "s" : ""} IA pour le planning`,
            cta: "Examiner",
            tone: "violet" as const,
            icon: Sparkles,
          },
        ]
      : []),
    ...(extDrift > 0
      ? [
          {
            href: "/drive",
            label: `${extDrift} fichier${extDrift > 1 ? "s" : ""} prêt${extDrift > 1 ? "s" : ""} à publier au client`,
            cta: "Publier",
            tone: "emerald" as const,
            icon: FolderGit2,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 1. CLEAN EXECUTIVE HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              {activeProject
                ? `CP ${activeProject.codeProjet} · Vue du jour`
                : "GamersOrigin"}
            </p>
            {activeProject && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  PROJECT_CATEGORY_META[
                    normalizeProjectCategory(activeProject.category)
                  ].badgeClass
                }`}
              >
                {
                  PROJECT_CATEGORY_META[
                    normalizeProjectCategory(activeProject.category)
                  ].label
                }
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {activeProject
              ? `${activeProject.client} — ${activeProject.nomJeu}`
              : "Bienvenue sur GO Project Hub"}
          </h1>
        </div>

        {activeProject ? (
          <Link
            href="/weeklys"
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-rose-700"
          >
            <Presentation className="h-4 w-4" />
            Préparer le Weekly
          </Link>
        ) : (
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
          >
            <FolderKanban className="h-4 w-4" />
            Créer mon premier projet
          </Link>
        )}
      </div>

      {/* Onboarding Banner (disappears once ready) */}
      {!setupComplete && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 px-5 py-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <div className="flex items-center gap-3 text-xs text-indigo-950 dark:text-indigo-100">
            <Settings className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>
              <strong>Configuration initiale :</strong>{" "}
              {!googleConn
                ? "connectez votre compte Google Workspace"
                : !geminiConfigured
                  ? "ajoutez votre clé IA Gemini"
                  : "créez ou ouvrez votre premier projet"}{" "}
              pour activer toutes les automatisations.
            </span>
          </div>
          <Link
            href={!googleConn || !geminiConfigured ? "/settings" : "/projects"}
            className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Terminer la configuration
          </Link>
        </section>
      )}

      {/* 2. ONE UNIFIED PROJECT HEALTH STRIP (3 crisp numbers, zero card clutter) */}
      {activeProject && (
        <section className="grid divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827] md:grid-cols-3 md:divide-x md:divide-y-0">
          {/* Planning Health */}
          <Link
            href="/retroplanning"
            className="group block p-5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Avancement tâches
              </span>
              <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {tasksPct}%
              </span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {doneTasks}{" "}
              <span className="text-base font-normal text-slate-400">
                / {totalTasks}
              </span>
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                style={{ width: `${tasksPct}%` }}
                className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500"
              />
            </div>
          </Link>

          {/* Budget Consumption */}
          <Link
            href="/budget"
            title="Compare vos dépenses réelles validées (Post-Op) au coût prévu avant l'opération (Pre-Op), hors taxes."
            className="group block p-5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Coûts engagés (HT)
              </span>
              <span
                className={`font-mono text-xs font-bold ${
                  budgetOverrunStrict
                    ? "text-rose-600 dark:text-rose-400"
                    : budgetWarning90
                      ? "text-amber-700 dark:text-amber-400"
                      : budgetExactSold
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-sky-600 dark:text-sky-400"
                }`}
              >
                {budgetExactSold ? "100% · Soldé" : `${budgetPct}%`}
              </span>
            </div>
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              <span className="whitespace-nowrap">
                {formatEurCompact(budgetPostOpHt)}
              </span>
              <span className="whitespace-nowrap text-sm font-normal text-slate-400">
                / {formatEurCompact(budgetPreOpHt)} prévu
              </span>
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                style={{ width: `${Math.min(100, budgetPct)}%` }}
                className={`h-full rounded-full ${
                  budgetOverrunStrict
                    ? "bg-rose-600"
                    : budgetWarning90
                      ? "bg-amber-500"
                      : budgetExactSold
                        ? "bg-emerald-500"
                        : "bg-sky-500"
                }`}
              />
            </div>
          </Link>

          {/* Forecast Margin (Atterrissage) */}
          <Link
            href="/budget"
            className="group block p-5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Marge à terminaison
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  marginTone === "emerald"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : marginTone === "amber"
                      ? "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                      : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                }`}
              >
                {marginBadgeLabel}
              </span>
            </div>
            <p
              className={`mt-1.5 font-mono text-2xl font-bold tracking-tight ${
                marginTone === "emerald"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : marginTone === "amber"
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {forecastMarginPct.toFixed(1)}%
            </p>
            <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
              {formatEurCompact(forecastMarginHt)} estimés sur{" "}
              {formatEurCompact(budgetSoldHt)} vendu
            </p>
          </Link>
        </section>
      )}

      {/* 3. ACTIONABLE 2-COLUMN COCKPIT (min-w-0 prevents mobile overflow!) */}
      {activeProject && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* LEFT (8 cols): Priorities + Upcoming Tasks */}
          <div className="min-w-0 space-y-6 lg:col-span-8">
            {/* Attention / Priorities */}
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  À traiter en priorité
                </h2>
                {urgentItems.length === 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Rien d&apos;urgent
                  </span>
                )}
              </div>

              {urgentItems.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Aucune facture bloquée, aucun dépassement budgétaire et tous
                  vos livrables client sont à jour.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {urgentItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="group flex items-center justify-between gap-3 py-3 text-xs first:pt-1 last:pb-1"
                      >
                        <span className="flex items-center gap-2.5 font-medium text-slate-800 dark:text-slate-100">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                              item.tone === "rose"
                                ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                                : item.tone === "amber"
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                  : item.tone === "violet"
                                    ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
                                    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-[13px]">{item.label}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-indigo-600 group-hover:translate-x-0.5 dark:text-indigo-400">
                          {item.cta}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Next Tasks (Interactive 1-click Asana-style completion!) */}
            <UpcomingTasksCard
              projectId={activeProject.id}
              initialTasks={upcomingTasks.map((t) => ({
                id: t.id,
                tache: t.tache,
                phase: t.phase,
                owner: t.owner,
                endDate: t.endDate ? t.endDate.toISOString() : null,
                status: t.status,
              }))}
            />
          </div>

          {/* RIGHT (4 cols): Quick Actions + Quiet Activity */}
          <div className="min-w-0 space-y-6 lg:col-span-4">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
              <h2 className="mb-3.5 text-sm font-bold text-slate-900 dark:text-white">
                Actions rapides
              </h2>
              <div className="grid grid-cols-2 gap-2.5">
                <Link
                  href="/retroplanning"
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-xs font-semibold text-slate-800 transition-all hover:border-sky-300 hover:bg-sky-50/40 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/10"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                    <Plus className="h-4 w-4" />
                  </span>
                  <span>Nouvelle tâche</span>
                </Link>
                <Link
                  href="/budget?tab=invoices"
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-xs font-semibold text-slate-800 transition-all hover:border-rose-300 hover:bg-rose-50/40 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/10"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                    <Receipt className="h-4 w-4" />
                  </span>
                  <span>Déposer facture</span>
                </Link>
                <Link
                  href="/meetings"
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-xs font-semibold text-slate-800 transition-all hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                    <Mic className="h-4 w-4" />
                  </span>
                  <span>CR Krisp</span>
                </Link>
                <Link
                  href="/weeklys"
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-xs font-semibold text-slate-800 transition-all hover:border-amber-300 hover:bg-amber-50/40 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/10"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    <Presentation className="h-4 w-4" />
                  </span>
                  <span>Weekly client</span>
                </Link>
                <Link
                  href="/drive"
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-xs font-semibold text-slate-800 transition-all hover:border-emerald-300 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/10"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    <FolderGit2 className="h-4 w-4" />
                  </span>
                  <span>Publier Drive</span>
                </Link>
                <Link
                  href="/reporting"
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3 text-xs font-semibold text-slate-800 transition-all hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                    <BarChart3 className="h-4 w-4" />
                  </span>
                  <span>Bilan Reporting</span>
                </Link>
              </div>
            </section>

            {recentLogs.length > 0 && (
              <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                    Récent
                  </h2>
                </div>
                <div className="space-y-2.5">
                  {recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="truncate text-slate-700 dark:text-slate-300">
                        {HUMAN_ACTION_LABELS[log.action] ??
                          log.action.replaceAll("_", " ").toLowerCase()}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatShortDate(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
