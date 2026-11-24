import { cookies } from "next/headers";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderGit2,
  FolderKanban,
  Lock,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ACTIVE_PROJECT_COOKIE } from "@/app/api/shell/status/route";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const cookieProjectId = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value ?? null;

  const projects = await prisma.project.findMany({
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
      take: 10,
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

  let stats = {
    driveNodes: 0,
    extDrift: 0,
    budgetSoldHt: 0,
    budgetPostOpHt: 0,
    pendingInvoices: 0,
    cpConflicts: 0,
    retroTasks: 0,
    retroProposals: 0,
    calendarEvents: 0,
    weeklyReports: 0,
    influenceMetrics: 0,
  };

  if (activeProject) {
    const [
      driveNodes,
      extDrift,
      budgetAgg,
      pendingInvoices,
      cpConflicts,
      retroTasks,
      retroProposals,
      calendarEvents,
      weeklyReports,
      influenceMetrics,
    ] = await Promise.all([
      prisma.driveNode.count({ where: { projectId: activeProject.id } }),
      prisma.syncStatus.count({
        where: { projectId: activeProject.id, driftDetected: true },
      }),
      prisma.budgetLine.aggregate({
        where: { projectId: activeProject.id },
        _sum: { saleTotalHt: true, postOpTotalHt: true },
      }),
      prisma.invoice.count({
        where: { projectId: activeProject.id, status: "PENDING_VALIDATION" },
      }),
      prisma.invoice.count({
        where: {
          projectId: activeProject.id,
          cpConflict: true,
          status: "CONFLICT_BLOCKED",
        },
      }),
      prisma.retroTask.count({ where: { projectId: activeProject.id } }),
      prisma.retroProposal.count({
        where: { projectId: activeProject.id, status: "PENDING" },
      }),
      prisma.calendarEvent.count({ where: { projectId: activeProject.id } }),
      prisma.weeklyReport.count({ where: { projectId: activeProject.id } }),
      prisma.influenceMetric.count({ where: { projectId: activeProject.id } }),
    ]);

    stats = {
      driveNodes,
      extDrift,
      budgetSoldHt: budgetAgg._sum.saleTotalHt ?? 0,
      budgetPostOpHt: budgetAgg._sum.postOpTotalHt ?? 0,
      pendingInvoices,
      cpConflicts,
      retroTasks,
      retroProposals,
      calendarEvents,
      weeklyReports,
      influenceMetrics,
    };
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Hero Banner */}
      <section className="rounded-xl border border-[#232b3d] bg-gradient-to-br from-[#11151f] via-[#11151f] to-[#171d2b] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#e11d48]/15 px-2 py-0.5 font-mono text-xs font-semibold text-rose-300 ring-1 ring-[#e11d48]/40">
                SOCLE M1 ACTIF
              </span>
              <span className="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30">
                BAC À SABLE STRICT
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
              Centre de Commande — GO Project Hub
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {activeProject ? (
                <>
                  Projet actif :{" "}
                  <span className="font-mono font-semibold text-cyan-300">
                    CP {activeProject.codeProjet}
                  </span>{" "}
                  · {activeProject.client} — {activeProject.nomJeu}
                </>
              ) : (
                "Aucun projet initialisé. Configurez vos connecteurs puis lancez le projet pilote [PILOTE - 326027]."
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 rounded-lg border border-[#232b3d] bg-[#171d2b] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-[#232b3d]"
            >
              <Settings className="h-4 w-4 text-cyan-400" />
              Paramètres OAuth2 & Gemini
            </Link>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 rounded-lg bg-[#e11d48] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff2e58]"
            >
              <FolderKanban className="h-4 w-4" />
              {activeProject
                ? "Gérer Projets & Talents"
                : "Initialiser Pilote 326027"}
            </Link>
          </div>
        </div>
      </section>

      {/* Connector & Isolation Status Strip */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Google Workspace OAuth2
            </span>
            {googleConn ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-400" />
            )}
          </div>
          <p className="mt-2 text-lg font-bold text-white">
            {googleConn ? googleConn.userEmail : "Non connecté"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Drive, Sheets, Slides, Gmail (Draft-First), Agenda secondaire
          </p>
        </div>

        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              API Gemini (gemini-2.5-flash)
            </span>
            <Sparkles
              className={`h-5 w-5 ${geminiConfigured ? "text-emerald-400" : "text-amber-400"}`}
            />
          </div>
          <p className="mt-2 text-lg font-bold text-white">
            {geminiConfigured ? "Clé configurée" : "Clé manquante (412)"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Extraction factures PDF, veille rétroplanning, vision Influence
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-[#11151f] p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
              Verrou PROD & Rétroplanning
            </span>
            <ShieldCheck className="h-5 w-5 text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-sm font-bold text-white">
            PROD 16Vi3KE... Verrouillé
          </p>
          <p className="mt-1 text-xs text-slate-400">
            002.1 Rétroplanning Actif :{" "}
            <span className="font-semibold text-amber-300">
              NO_PERMANENT_EXT_SYNC
            </span>
          </p>
        </div>
      </section>

      {/* Active Project KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/drive"
          className="group rounded-xl border border-[#232b3d] bg-[#11151f] p-5 transition-colors hover:border-cyan-500/50"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Arborescence Drive 001→006</span>
            <FolderGit2 className="h-4 w-4 text-cyan-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-white">
            {stats.driveNodes} nœuds
          </p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span
              className={
                stats.extDrift > 0 ? "text-amber-300" : "text-emerald-400"
              }
            >
              {stats.extDrift > 0
                ? `${stats.extDrift} décalage(s) [EXT]`
                : "Miroir [EXT] à jour"}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-cyan-400" />
          </div>
        </Link>

        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Isolation CP & Factures</span>
            {stats.cpConflicts > 0 ? (
              <AlertTriangle className="h-4 w-4 text-red-400" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            )}
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-white">
            {stats.cpConflicts} conflit(s)
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {stats.pendingInvoices} facture(s) en attente ·{" "}
            {stats.budgetPostOpHt.toFixed(0)} € post-op
          </p>
        </div>

        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Rétroplanning & Agenda</span>
            <Lock className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-white">
            {stats.retroTasks} tâches
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {stats.retroProposals} propositions IA · {stats.calendarEvents}{" "}
            jalons Agenda
          </p>
        </div>

        <div className="rounded-xl border border-[#232b3d] bg-[#11151f] p-5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Weeklys & Reporting</span>
            <Activity className="h-4 w-4 text-rose-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-white">
            {stats.weeklyReports} weeklys
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {stats.influenceMetrics} métriques Influence consolidées
          </p>
        </div>
      </section>

      {/* Recent Audit Log */}
      <section className="rounded-xl border border-[#232b3d] bg-[#11151f] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">
            Journal d&apos;Audit & Sécurité (AuditLog)
          </h2>
          <span className="font-mono text-xs text-slate-400">
            {recentLogs.length} entrée(s) récentes
          </span>
        </div>

        {recentLogs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            Aucun événement enregistré pour l&apos;instant. Lancez la
            configuration OAuth2 ou le bootstrap du projet pilote 326027.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#232b3d] text-slate-400">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Acteur</th>
                  <th className="py-2 pr-4">Cible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232b3d]/60">
                {recentLogs.map((log) => (
                  <tr key={log.id} className="text-slate-200">
                    <td className="py-2 pr-4 font-mono text-slate-400">
                      {log.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="py-2 pr-4 font-mono font-semibold text-cyan-300">
                      {log.action}
                    </td>
                    <td className="py-2 pr-4">{log.actor}</td>
                    <td className="py-2 pr-4 font-mono text-slate-400">
                      {log.targetType}
                      {log.targetId ? `:${log.targetId}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
