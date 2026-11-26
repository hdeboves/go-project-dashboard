import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import {
  getCurrentUser,
  requireAdminOrBootstrap,
} from "@/lib/auth/session";
import { AppHttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_BUDGET_TEMPLATES,
  DEFAULT_RETRO_TEMPLATE_TASKS,
  DEFAULT_WEEKLY_TEMPLATE,
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_META,
  type BlankBudgetTemplateLine,
  type BlankRetroTemplateTask,
  type BlankWeeklyTemplate,
  type ProjectCategory,
} from "@/lib/templates/project-templates";

const BudgetTemplateLineSchema = z.object({
  category: z.string().trim().min(1),
  objet: z.string().trim().min(1),
  expenseType: z.enum(["Externe", "RH Internes", "Amortissement"]),
  realisePar: z.string().trim().nullable().optional(),
});

const RetroTemplateTaskSchema = z.object({
  phase: z.string().trim().min(1),
  etape: z.string().trim().min(1),
  tache: z.string().trim().min(1),
  isMilestone: z.boolean().optional(),
  milestoneType: z
    .enum(["INFLUENCE", "LANCEMENT_MAP", "WEEKLY", "CUSTOM"])
    .nullable()
    .optional(),
});

const WeeklyTemplateSchema = z.object({
  nextStepsClient: z.array(z.string().trim().min(1)),
  nextStepsGo: z.array(z.string().trim().min(1)),
  summaryPlaceholder: z.string().trim().min(1),
});

const UpdateTemplateSchema = z.object({
  target: z.enum([
    "JEU",
    "YOUTUBE",
    "PROD_CREA",
    "EVENEMENT",
    "SPONSOR",
    "RETRO_GLOBAL",
    "WEEKLY_GLOBAL",
  ]),
  reset: z.boolean().optional(),
  budgetLines: z.array(BudgetTemplateLineSchema).optional(),
  retroTasks: z.array(RetroTemplateTaskSchema).optional(),
  weeklyTemplate: WeeklyTemplateSchema.optional(),
});

export async function GET() {
  try {
    const rows = await prisma.categoryTemplate.findMany({
      where: {
        category: {
          in: [...PROJECT_CATEGORIES, "RETRO_GLOBAL", "WEEKLY_GLOBAL"],
        },
      },
    });
    const byKey = new Map(rows.map((r) => [r.category, r]));

    const categories = PROJECT_CATEGORIES.map((cat) => {
      const row = byKey.get(cat);
      let budgetLines: BlankBudgetTemplateLine[] = [
        ...DEFAULT_BUDGET_TEMPLATES[cat],
      ];
      if (row?.budgetLinesJson) {
        try {
          const parsed = JSON.parse(row.budgetLinesJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            budgetLines = parsed as BlankBudgetTemplateLine[];
          }
        } catch {
          // keep default
        }
      }
      return {
        category: cat,
        meta: PROJECT_CATEGORY_META[cat],
        budgetLines,
      };
    });

    let retroTasks: BlankRetroTemplateTask[] = [...DEFAULT_RETRO_TEMPLATE_TASKS];
    const retroRow = byKey.get("RETRO_GLOBAL");
    if (retroRow?.retroTasksJson) {
      try {
        const parsed = JSON.parse(retroRow.retroTasksJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          retroTasks = parsed as BlankRetroTemplateTask[];
        }
      } catch {
        // keep default
      }
    }

    let weeklyTemplate: BlankWeeklyTemplate = {
      nextStepsClient: [...DEFAULT_WEEKLY_TEMPLATE.nextStepsClient],
      nextStepsGo: [...DEFAULT_WEEKLY_TEMPLATE.nextStepsGo],
      summaryPlaceholder: DEFAULT_WEEKLY_TEMPLATE.summaryPlaceholder,
    };
    const weeklyRow = byKey.get("WEEKLY_GLOBAL");
    if (weeklyRow?.weeklyTemplateJson) {
      try {
        const parsed = JSON.parse(
          weeklyRow.weeklyTemplateJson
        ) as Partial<BlankWeeklyTemplate>;
        weeklyTemplate = {
          nextStepsClient: Array.isArray(parsed.nextStepsClient)
            ? parsed.nextStepsClient.filter(
                (s): s is string => typeof s === "string"
              )
            : [...DEFAULT_WEEKLY_TEMPLATE.nextStepsClient],
          nextStepsGo: Array.isArray(parsed.nextStepsGo)
            ? parsed.nextStepsGo.filter(
                (s): s is string => typeof s === "string"
              )
            : [...DEFAULT_WEEKLY_TEMPLATE.nextStepsGo],
          summaryPlaceholder:
            typeof parsed.summaryPlaceholder === "string" &&
            parsed.summaryPlaceholder.trim()
              ? parsed.summaryPlaceholder.trim()
              : DEFAULT_WEEKLY_TEMPLATE.summaryPlaceholder,
        };
      } catch {
        // keep default
      }
    }

    return NextResponse.json({
      categories,
      retroTasks,
      weeklyTemplate,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const currentUser = (await requireAdminOrBootstrap(prisma)) ?? (await getCurrentUser(prisma));
    const body = UpdateTemplateSchema.parse(await req.json());

    if (body.reset) {
      await prisma.categoryTemplate.deleteMany({
        where: { category: body.target },
      });
      await prisma.auditLog.create({
        data: {
          actor: currentUser?.email ?? "user",
          action: "TEMPLATE_UPDATED",
          targetType: "TEMPLATE",
          targetId: body.target,
          detailsJson: JSON.stringify({ target: body.target, reset: true }),
        },
      });
      if (body.target === "RETRO_GLOBAL") {
        return NextResponse.json({
          ok: true,
          target: body.target,
          retroTasks: DEFAULT_RETRO_TEMPLATE_TASKS,
        });
      }
      if (body.target === "WEEKLY_GLOBAL") {
        return NextResponse.json({
          ok: true,
          target: body.target,
          weeklyTemplate: DEFAULT_WEEKLY_TEMPLATE,
        });
      }
      return NextResponse.json({
        ok: true,
        target: body.target,
        budgetLines: DEFAULT_BUDGET_TEMPLATES[body.target as ProjectCategory],
      });
    }

    if (body.target === "RETRO_GLOBAL") {
      if (!body.retroTasks) {
        throw new AppHttpError(
          400,
          "MISSING_RETRO_TASKS",
          "Le tableau retroTasks est requis pour sauvegarder le modèle rétroplanning."
        );
      }
      await prisma.categoryTemplate.upsert({
        where: { category: "RETRO_GLOBAL" },
        update: { retroTasksJson: JSON.stringify(body.retroTasks) },
        create: {
          category: "RETRO_GLOBAL",
          retroTasksJson: JSON.stringify(body.retroTasks),
        },
      });
      return NextResponse.json({
        ok: true,
        target: "RETRO_GLOBAL",
        retroTasks: body.retroTasks,
      });
    }

    if (body.target === "WEEKLY_GLOBAL") {
      if (!body.weeklyTemplate) {
        throw new AppHttpError(
          400,
          "MISSING_WEEKLY_TEMPLATE",
          "L'objet weeklyTemplate est requis pour sauvegarder le modèle Weekly."
        );
      }
      await prisma.categoryTemplate.upsert({
        where: { category: "WEEKLY_GLOBAL" },
        update: { weeklyTemplateJson: JSON.stringify(body.weeklyTemplate) },
        create: {
          category: "WEEKLY_GLOBAL",
          weeklyTemplateJson: JSON.stringify(body.weeklyTemplate),
        },
      });
      return NextResponse.json({
        ok: true,
        target: "WEEKLY_GLOBAL",
        weeklyTemplate: body.weeklyTemplate,
      });
    }

    if (!body.budgetLines) {
      throw new AppHttpError(
        400,
        "MISSING_BUDGET_LINES",
        "Le tableau budgetLines est requis pour sauvegarder le modèle budget."
      );
    }

    await prisma.categoryTemplate.upsert({
      where: { category: body.target },
      update: { budgetLinesJson: JSON.stringify(body.budgetLines) },
      create: {
        category: body.target,
        budgetLinesJson: JSON.stringify(body.budgetLines),
      },
    });

    return NextResponse.json({
      ok: true,
      target: body.target,
      budgetLines: body.budgetLines,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
