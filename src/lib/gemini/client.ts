import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { decryptSecret } from "@/lib/crypto";
import { PreconditionError } from "@/lib/errors";
import type {
  GeminiPort,
  InfluenceVisionInput,
  InfluenceVisionOutput,
  InvoiceExtractionInput,
  InvoiceExtractionOutput,
  RetroVeilleInput,
  RetroVeilleOutput,
} from "@/lib/ports";

export const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

export const InvoiceExtractionZodSchema = z.object({
  prestataire: z.string().min(1),
  numeroFacture: z.string().min(1),
  dateFacture: z.string().min(1),
  montantHT: z.number().finite().nonnegative(),
  tvaRate: z.number().finite().nonnegative(),
  montantTTC: z.number().finite().nonnegative(),
  typeFacture: z.enum(["ACOMPTE", "SOLDE", "UNIQUE"]),
  codeProjetDetecte: z.string().nullable(),
  prestationSummary: z.string(),
  suggestedBudgetLineId: z.string().nullable(),
  suggestedBudgetLineLabel: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  rawWarnings: z.array(z.string()),
  extractedRawTextSnippet: z.string(),
});

export const RetroVeilleResponseZodSchema = z.object({
  proposals: z.array(
    z.object({
      retroTaskId: z.string().nullable(),
      taskTitle: z.string(),
      proposedStatus: z.enum([
        "A_FAIRE",
        "EN_COURS",
        "EN_ATTENTE_CLIENT",
        "TERMINE",
      ]),
      proposedStartDate: z.string().nullable(),
      proposedEndDate: z.string().nullable(),
      deltaDays: z.number().int(),
      sourceType: z.enum(["GMAIL", "DRIVE"]),
      sourceRef: z.string(),
      summary: z.string(),
      detectedCodeProjet: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

export const InfluenceVisionZodSchema = z.object({
  detectedPlatform: z.string(),
  views: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  shares: z.number().int().nonnegative().nullable(),
  reposts: z.number().int().nonnegative().nullable(),
  saves: z.number().int().nonnegative().nullable(),
  engagementRate: z.number().nonnegative().nullable(),
  detectedHandleOrCaption: z.string().nullable(),
  fieldConfidence: z.record(z.string(), z.number()),
  extractionNotes: z.array(z.string()),
});

function isRetryableGeminiError(err: unknown): boolean {
  const status =
    (err as { status?: number; code?: number })?.status ??
    (err as { code?: number })?.code;
  if (status === 429 || status === 503) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("UNAVAILABLE")
  );
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryableGeminiError(err)) {
        throw err;
      }
      const exponential = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
    }
  }

  throw lastError;
}

export async function resolveGeminiApiKey(
  prisma: PrismaClient
): Promise<{ apiKey: string; source: "db" | "env" }> {
  const row = await prisma.appSetting.findUnique({
    where: { key: "GEMINI_API_KEY" },
  });
  if (row?.valueEnc) {
    try {
      const dec = decryptSecret(row.valueEnc).trim();
      if (dec) {
        return { apiKey: dec, source: "db" };
      }
    } catch {
      // fall through to env check
    }
  }

  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) {
    return { apiKey: envKey, source: "env" };
  }

  throw new PreconditionError(
    "GEMINI_KEY_MISSING",
    "Clé API Gemini non configurée. Renseignez GEMINI_API_KEY dans Paramètres ou .env.local."
  );
}

export class GeminiClient implements GeminiPort {
  private readonly ai: GoogleGenAI;

  constructor(params: { apiKey: string; baseUrl?: string }) {
    this.ai = new GoogleGenAI({
      apiKey: params.apiKey,
      ...(params.baseUrl ? { httpOptions: { baseUrl: params.baseUrl } } : {}),
    });
  }

  static async fromPrisma(
    prisma: PrismaClient,
    options?: { baseUrl?: string }
  ): Promise<GeminiClient> {
    const { apiKey } = await resolveGeminiApiKey(prisma);
    return new GeminiClient({
      apiKey,
      baseUrl: options?.baseUrl,
    });
  }

  async ping(): Promise<{ ok: true; model: string; latencyMs: number }> {
    const start = Date.now();
    await withGeminiRetry(() =>
      this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ text: 'Respond with JSON: {"pong":true}' }],
        config: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      })
    );
    return {
      ok: true,
      model: GEMINI_MODEL,
      latencyMs: Date.now() - start,
    };
  }

  async extractInvoiceFromPdf(
    input: InvoiceExtractionInput
  ): Promise<InvoiceExtractionOutput> {
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        prestataire: { type: Type.STRING },
        numeroFacture: { type: Type.STRING },
        dateFacture: { type: Type.STRING },
        montantHT: { type: Type.NUMBER },
        tvaRate: { type: Type.NUMBER },
        montantTTC: { type: Type.NUMBER },
        typeFacture: {
          type: Type.STRING,
          enum: ["ACOMPTE", "SOLDE", "UNIQUE"],
        },
        codeProjetDetecte: { type: Type.STRING, nullable: true },
        prestationSummary: { type: Type.STRING },
        suggestedBudgetLineId: { type: Type.STRING, nullable: true },
        suggestedBudgetLineLabel: { type: Type.STRING, nullable: true },
        confidence: { type: Type.NUMBER },
        rawWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
        extractedRawTextSnippet: { type: Type.STRING },
      },
      required: [
        "prestataire",
        "numeroFacture",
        "dateFacture",
        "montantHT",
        "tvaRate",
        "montantTTC",
        "typeFacture",
        "codeProjetDetecte",
        "prestationSummary",
        "suggestedBudgetLineId",
        "suggestedBudgetLineLabel",
        "confidence",
        "rawWarnings",
        "extractedRawTextSnippet",
      ],
    };

    const budgetLinesText = input.budgetLines
      .map(
        (b) =>
          `- id=${b.id} | cat=${b.category} | objet=${b.objet}${b.realisePar ? ` | realisePar=${b.realisePar}` : ""} | preOpHT=${b.preOpTotalHt}`
      )
      .join("\n");

    const quotesText = (input.quotes ?? [])
      .map(
        (q) =>
          `- id=${q.id} | num=${q.quoteNumber} | presta=${q.vendorName} | ht=${q.amountHt}`
      )
      .join("\n");

    const prompt = [
      "Tu es l'assistant comptable automatisé de GamersOrigin / L'Intrus (GO Project Hub).",
      "RÈGLE CRITIQUE — IDENTITÉ DE L'ACHETEUR (CLIENT) :",
      "- Nous sommes 'GamersOrigin' (GO) ou 'L'Intrus'.",
      "- 'GamersOrigin' et 'L'Intrus' sont TOUJOURS le CLIENT / DESTINATAIRE facturé, JAMAIS le prestataire !",
      "- Dans 'prestataire', retourne OBLIGATOIREMENT le véritable émetteur / fournisseur / studio / freelance de la facture (en-tête émetteur, pied de page légal, raison sociale ou titulaire RIB hors GamersOrigin et L'Intrus).",
      `Projet actif : CP ${input.projectContext.codeProjet} | Client: ${input.projectContext.client} | Jeu: ${input.projectContext.nomJeu}.`,
      input.allProjectCodes && input.allProjectCodes.length > 0
        ? `Codes projet connus de l'agence : ${input.allProjectCodes.join(", ")}`
        : "",
      input.filename ? `Nom de fichier : ${input.filename}` : "",
      input.emailSubject ? `Objet mail : ${input.emailSubject}` : "",
      "Lignes budgétaires disponibles (choisis le meilleur suggestedBudgetLineId correspondant à la prestation ou au prestataire) :",
      budgetLinesText || "(aucune ligne importée)",
      quotesText ? `Devis existants du projet :\n${quotesText}` : "",
      "Extrais TOUTES les informations de cette facture PDF en JSON afin de pré-remplir automatiquement tous les champs :",
      "- prestataire : nom propre et exact du fournisseur (JAMAIS GamersOrigin ni L'Intrus)",
      "- numeroFacture : numéro exact de la facture",
      "- dateFacture : date d'ÉMISSION au format YYYY-MM-DD (ne pas confondre avec la date d'échéance !)",
      "- montantHT, tvaRate, montantTTC : détecte précisément s'il y a de la TVA ou NON. S'il n'y a PAS de TVA (franchise en base art. 293 B, exonéré, autoliquidation, ou aucune ligne TVA et HT = TTC), retourne OBLIGATOIREMENT tvaRate = 0 et montantTTC = montantHT. S'il y a de la TVA, retourne le taux exact (5, 10 ou 20).",
      "- typeFacture : ACOMPTE, SOLDE ou UNIQUE",
      "- codeProjetDetecte : code projet principal détecté (si plusieurs codes projet apparaissent, indique-les tous dans extractedRawTextSnippet)",
      "- prestationSummary : intitulé synthétique et clair de la prestation facturée",
      "- suggestedBudgetLineId : ID de la ligne budgétaire la plus pertinente parmi la liste ci-dessus (ou null)",
    ]
      .filter(Boolean)
      .join("\n");

    let uploadedFileName: string | null = null;
    let tempFilePath: string | null = null;

    try {
      let filePart: Record<string, unknown>;
      if (input.pdfBuffer.byteLength <= MAX_INLINE_BYTES) {
        filePart = {
          inlineData: {
            mimeType: "application/pdf",
            data: input.pdfBuffer.toString("base64"),
          },
        };
      } else {
        tempFilePath = path.join(
          os.tmpdir(),
          `go_invoice_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`
        );
        fs.writeFileSync(tempFilePath, input.pdfBuffer);
        const uploaded = await this.ai.files.upload({
          file: tempFilePath,
          config: { mimeType: "application/pdf" },
        });
        uploadedFileName = uploaded.name ?? null;
        filePart = {
          fileData: {
            fileUri: uploaded.uri,
            mimeType: "application/pdf",
          },
        };
      }

      const response = await withGeminiRetry(() =>
        this.ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: [filePart, { text: prompt }],
          config: {
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.1,
          },
        })
      );

      const parsed = JSON.parse(response.text ?? "{}");
      return InvoiceExtractionZodSchema.parse(parsed);
    } finally {
      if (uploadedFileName) {
        try {
          await this.ai.files.delete({ name: uploadedFileName });
        } catch {
          // ignore cleanup failure
        }
      }
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  async analyzeRetroplanningVeille(
    input: RetroVeilleInput
  ): Promise<RetroVeilleOutput> {
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        proposals: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              retroTaskId: { type: Type.STRING, nullable: true },
              taskTitle: { type: Type.STRING },
              proposedStatus: {
                type: Type.STRING,
                enum: ["A_FAIRE", "EN_COURS", "EN_ATTENTE_CLIENT", "TERMINE"],
              },
              proposedStartDate: { type: Type.STRING, nullable: true },
              proposedEndDate: { type: Type.STRING, nullable: true },
              deltaDays: { type: Type.INTEGER },
              sourceType: { type: Type.STRING, enum: ["GMAIL", "DRIVE"] },
              sourceRef: { type: Type.STRING },
              summary: { type: Type.STRING },
              detectedCodeProjet: { type: Type.STRING, nullable: true },
              confidence: { type: Type.NUMBER },
            },
            required: [
              "retroTaskId",
              "taskTitle",
              "proposedStatus",
              "proposedStartDate",
              "proposedEndDate",
              "deltaDays",
              "sourceType",
              "sourceRef",
              "summary",
              "detectedCodeProjet",
              "confidence",
            ],
          },
        },
      },
      required: ["proposals"],
    };

    const prompt = [
      `Analyse de veille rétroplanning pour le projet CP ${input.projectContext.codeProjet} (${input.projectContext.client} - ${input.projectContext.nomJeu}).`,
      "Tâches actuelles :",
      JSON.stringify(input.currentTasks),
      "Emails récents :",
      JSON.stringify(input.emails),
      "Fichiers Drive récents :",
      JSON.stringify(input.driveFiles),
      "Propose uniquement les mises à jour de statut/dates justifiées par les preuves ci-dessus.",
    ].join("\n\n");

    const response = await withGeminiRetry(() =>
      this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ text: prompt }],
        config: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.1,
        },
      })
    );

    const parsed = JSON.parse(response.text ?? "{}");
    return RetroVeilleResponseZodSchema.parse(parsed);
  }

  async extractInfluenceMetricsFromImage(
    input: InfluenceVisionInput
  ): Promise<InfluenceVisionOutput> {
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        detectedPlatform: { type: Type.STRING },
        views: { type: Type.INTEGER, nullable: true },
        likes: { type: Type.INTEGER, nullable: true },
        comments: { type: Type.INTEGER, nullable: true },
        shares: { type: Type.INTEGER, nullable: true },
        reposts: { type: Type.INTEGER, nullable: true },
        saves: { type: Type.INTEGER, nullable: true },
        engagementRate: { type: Type.NUMBER, nullable: true },
        detectedHandleOrCaption: { type: Type.STRING, nullable: true },
        fieldConfidence: { type: Type.OBJECT },
        extractionNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        "detectedPlatform",
        "views",
        "likes",
        "comments",
        "shares",
        "reposts",
        "saves",
        "engagementRate",
        "detectedHandleOrCaption",
        "fieldConfidence",
        "extractionNotes",
      ],
    };

    const prompt = [
      `Extrais les métriques de performance social media depuis cette capture écran WhatsApp/Analytics pour le talent "${input.talentName}" sur ${input.platform}.`,
      "Retourne null pour toute métrique absente ou illisible sur la capture (ne pas inventer de chiffres).",
      "Convertis les notations abrégées (ex: 12,4K -> 12400, 1.2M -> 1200000) en entiers exacts.",
    ].join("\n");

    const response = await withGeminiRetry(() =>
      this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.imageBuffer.toString("base64"),
            },
          },
          { text: prompt },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.1,
        },
      })
    );

    const parsed = JSON.parse(response.text ?? "{}");
    const validated = InfluenceVisionZodSchema.parse(parsed);

    // Deterministic engagement rate calculation whenever views > 0
    if (validated.views !== null && validated.views > 0) {
      const interactions =
        (validated.likes ?? 0) +
        (validated.comments ?? 0) +
        (validated.shares ?? 0) +
        (validated.reposts ?? 0) +
        (validated.saves ?? 0);
      validated.engagementRate = Number(
        ((interactions / validated.views) * 100).toFixed(2)
      );
    }

    return validated;
  }
}
