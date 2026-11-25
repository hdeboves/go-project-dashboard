import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_BUDGET_TEMPLATES,
  DEFAULT_RETRO_TEMPLATE_TASKS,
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_META,
  getBudgetTemplateForCategory,
  getRetroTemplateTasks,
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

const UpdateTemplateSchema = z.object({
  target: z.enum(["JEU", "YOUTUBE", "EVENEMENT", "SPONSOR", "RETRO_GLOBAL"]),
  reset: z.boolean().optional(),
  budgetLines: z.array(BudgetTemplateLineSchema).optional(),
  retroTasks: z.array(RetroTemplateTaskSchema).optional(),
});

export async function GET() {
  try {
    const [budgetEntries, retroTasks] = await Promise.all([
      Promise.all(
        PROJECT_CATEGORIES.map(async (cat) => ({
          category: cat,
          meta: PROJECT_CATEGORY_META[cat],
          budgetLines: await getBudgetTemplateForCategory(prisma, cat),
        }))
      ),
      getRetroTemplateTasks(prisma),
    ]);

    return NextResponse.json({
      categories: budgetEntries,
      retroTasks,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = UpdateTemplateSchema.parse(await req.json());

    if (body.reset) {
      await prisma.categoryTemplate.deleteMany({
        where: { category: body.target },
      });
      if (body.target === "RETRO_GLOBAL") {
        return NextResponse.json({
          ok: true,
          target: body.target,
          retroTasks: DEFAULT_RETRO_TEMPLATE_TASKS,
        });
      }
      return NextResponse.json({
        ok: true,
        target: body.target,
        budgetLines: DEFAULT_BUDGET_TEMPLATES[body.target as ProjectCategory],
      });
    }

    if (body.target === "RETRO_GLOBAL") {
      const tasks = body.retroTasks ?? [];
      await prisma.categoryTemplate.upsert({
        where: { category: "RETRO_GLOBAL" },
        update: { retroTasksJson: JSON.stringify(tasks) },
        create: {
          category: "RETRO_GLOBAL",
          retroTasksJson: JSON.stringify(tasks),
        },
      });
      return NextResponse.json({
        ok: true,
        target: "RETRO_GLOBAL",
        retroTasks: tasks,
      });
    }

    const lines = body.budgetLines ?? [];
    await prisma.categoryTemplate.upsert({
      where: { category: body.target },
      update: { budgetLinesJson: JSON.stringify(lines) },
      create: {
        category: body.target,
        budgetLinesJson: JSON.stringify(lines),
      },
    });

    return NextResponse.json({
      ok: true,
      target: body.target,
      budgetLines: lines,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
