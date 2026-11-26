import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CryptoKeyError } from "@/lib/crypto";
import {
  InternalOnlySyncForbiddenError,
  RetroplanningPermanentSyncForbiddenError,
} from "@/lib/drive/sync-policy";
import { AppHttpError, OAuthStateError, PreconditionError } from "@/lib/errors";
import { SandboxViolationError } from "@/lib/google/sandbox-guard";
import { CpConflictError } from "@/lib/isolation/cp-guard";

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof PreconditionError) {
    return NextResponse.json(err.toJSON(), { status: 412 });
  }

  if (err instanceof SandboxViolationError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        operation: err.operation,
        targetId: err.targetId,
        reason: err.reason,
        ancestryChain: err.ancestryChain,
      },
      { status: 403 }
    );
  }

  if (
    err instanceof RetroplanningPermanentSyncForbiddenError ||
    err instanceof InternalOnlySyncForbiddenError
  ) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        nodeCode: err.nodeCode,
      },
      { status: 403 }
    );
  }

  if (err instanceof CpConflictError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        result: err.result,
      },
      { status: 409 }
    );
  }

  if (err instanceof OAuthStateError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
      },
      { status: 400 }
    );
  }

  if (err instanceof AppHttpError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      { status: err.httpStatus }
    );
  }

  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Données d'entrée invalides.",
        code: "VALIDATION_ERROR",
        issues: err.issues,
      },
      { status: 400 }
    );
  }

  if (err instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: "Corps JSON invalide.",
        code: "INVALID_JSON",
      },
      { status: 400 }
    );
  }

  if (err instanceof CryptoKeyError) {
    console.error("[CRYPTO_KEY_ERROR]", err.message);
    return NextResponse.json(
      {
        error: "Configuration de chiffrement serveur incomplète.",
        code: "CRYPTO_KEY_ERROR",
      },
      { status: 500 }
    );
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return NextResponse.json(
        {
          error: "Un enregistrement identique existe déjà.",
          code: "UNIQUE_CONSTRAINT_VIOLATION",
        },
        { status: 409 }
      );
    }
    if (err.code === "P2025") {
      return NextResponse.json(
        {
          error: "Élément introuvable.",
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }
    if (err.code === "P2003") {
      return NextResponse.json(
        {
          error: "Référence liée invalide ou introuvable.",
          code: "FOREIGN_KEY_VIOLATION",
        },
        { status: 400 }
      );
    }
  }

  console.error("[API_INTERNAL_ERROR]", err);
  const message =
    process.env.NODE_ENV === "production"
      ? "Une erreur interne est survenue. Veuillez réessayer."
      : err instanceof Error
        ? err.message
        : "Erreur interne inattendue.";
  return NextResponse.json(
    {
      error: message,
      code: "INTERNAL_ERROR",
    },
    { status: 500 }
  );
}
