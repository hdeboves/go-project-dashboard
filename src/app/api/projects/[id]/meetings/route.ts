import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/api-error";
import { assertProjectAccess, getCurrentUser } from "@/lib/auth/session";
import {
  ingestKrispMeeting,
  serializeMeetingNote,
} from "@/lib/krisp/krisp-service";
import { prisma } from "@/lib/prisma";

const CreateMeetingSchema = z.object({
  simulate: z.boolean().optional(),
  title: z.string().optional(),
  meetingDate: z.string().optional(),
  durationMinutes: z.number().int().positive().optional().nullable(),
  participants: z.array(z.string()).optional(),
  summary: z.string().optional(),
  keyDecisions: z.array(z.string()).optional(),
  actionItems: z
    .array(
      z.union([
        z.string(),
        z.object({
          text: z.string().min(1),
          owner: z.string().optional().nullable(),
          dueDate: z.string().optional().nullable(),
        }),
      ])
    )
    .optional(),
  rawTranscript: z.string().optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, projectId, currentUser, "VIEW");
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        codeProjet: true,
        client: true,
        nomJeu: true,
      },
    });
    if (!project) {
      return NextResponse.json(
        { error: "Projet introuvable." },
        { status: 404 }
      );
    }

    const [notes, crFolderNode] = await Promise.all([
      prisma.meetingNote.findMany({
        where: { projectId },
        orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      }),
      prisma.driveNode.findFirst({
        where: { projectId, code: "002.3" },
        select: { driveFileId: true, name: true },
      }),
    ]);

    return NextResponse.json({
      project,
      crFolder: crFolderNode?.driveFileId
        ? {
            code: "002.3",
            name: crFolderNode.name,
            driveFileId: crFolderNode.driveFileId,
            url: `https://drive.google.com/drive/folders/${crFolderNode.driveFileId}`,
          }
        : null,
      meetings: notes.map(serializeMeetingNote),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await context.params;
    const currentUser = await getCurrentUser(prisma);
    await assertProjectAccess(prisma, projectId, currentUser, "EDIT");
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      return NextResponse.json(
        { error: "Projet introuvable." },
        { status: 404 }
      );
    }

    const body = CreateMeetingSchema.parse(await req.json());

    if (body.simulate) {
      const todayIso = new Date().toISOString();
      const result = await ingestKrispMeeting(prisma, {
        projectId: project.id,
        source: "KRISP_WEBHOOK",
        title: `Point Hebdo ${project.client} — ${project.nomJeu}`,
        meetingDate: todayIso,
        durationMinutes: 35,
        participants: ["Hugo Deboves (GO)", "Client", "Direction Créa"],
        summary:
          "Point d'avancement hebdomadaire enregistré via Krisp. Validation globale des assets créatifs de la phase en cours, confirmation des dates de mise en ligne des talents et revue du suivi budgétaire sans dérive critique.",
        keyDecisions: [
          "Validation de la direction artistique du kit de communication",
          "Envoi du Weekly Slides client vendredi à 15h",
          "Gel du planning de tournage pour la semaine prochaine",
        ],
        actionItems: [
          {
            text: "Partager les assets validés dans l'espace client Drive",
            owner: "Hugo",
            dueDate: new Date(Date.now() + 2 * 86_400_000)
              .toISOString()
              .slice(0, 10),
          },
          {
            text: "Confirmer le créneau de validation juridique avec le client",
            owner: "Client",
            dueDate: new Date(Date.now() + 4 * 86_400_000)
              .toISOString()
              .slice(0, 10),
          },
        ],
        rawTranscript:
          "[00:02] Hugo : Bonjour à tous, on fait le point sur l'avancement de la semaine.\n[08:15] Créa : Les maquettes sont prêtes pour validation client dans le dossier 004.4.\n[24:40] Client : Top, on valide le kit com et on revient vers vous d'ici jeudi pour le juridique.",
      });
      return NextResponse.json(result, { status: 201 });
    }

    if (!body.title?.trim() || !body.summary?.trim()) {
      return NextResponse.json(
        { error: "Le titre et le résumé du compte rendu sont requis." },
        { status: 400 }
      );
    }

    const result = await ingestKrispMeeting(prisma, {
      projectId: project.id,
      source: "KRISP_IMPORT",
      title: body.title.trim(),
      meetingDate: body.meetingDate ?? new Date().toISOString(),
      durationMinutes: body.durationMinutes ?? null,
      participants: body.participants ?? [],
      summary: body.summary.trim(),
      keyDecisions: body.keyDecisions ?? [],
      actionItems: body.actionItems ?? [],
      rawTranscript: body.rawTranscript ?? null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
