import type { PrismaClient } from "@prisma/client";
import { PreconditionError } from "@/lib/errors";
import { GeminiClient, resolveGeminiApiKey } from "@/lib/gemini/client";
import { GoogleWorkspaceGateway } from "@/lib/google/gateway";
import type { GeminiPort, GoogleWorkspacePort } from "@/lib/ports";
import { prisma } from "@/lib/prisma";

export { PreconditionError };

export interface TestBoundaryOverrides {
  respectCredentials?: boolean;
  googleGateway?: GoogleWorkspacePort;
  geminiClient?: GeminiPort;
}

declare global {
  var __GO_TEST_BOUNDARY__: TestBoundaryOverrides | undefined;
}

export function isTestBoundaryHarnessActive(): boolean {
  return (
    process.env.TEST_BOUNDARY_HARNESS === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

export interface AppServices {
  prisma: PrismaClient;
  getGoogleGateway: (activeProjectId?: string) => Promise<GoogleWorkspacePort>;
  getGeminiClient: () => Promise<GeminiPort>;
}

export async function getGoogleGateway(
  activeProjectId?: string,
  db: PrismaClient = prisma
): Promise<GoogleWorkspacePort> {
  if (isTestBoundaryHarnessActive()) {
    const boundary = globalThis.__GO_TEST_BOUNDARY__;
    if (boundary?.googleGateway) {
      if (boundary.respectCredentials) {
        const conn = await db.googleConnection.findFirst();
        if (!conn) {
          throw new PreconditionError(
            "GOOGLE_NOT_CONNECTED",
            "Compte Google Workspace non connecté. Connectez votre compte dans Paramètres."
          );
        }
      }
      return boundary.googleGateway;
    }

    const harnessUrl = process.env.TEST_BOUNDARY_HARNESS_URL?.trim();
    if (harnessUrl) {
      return GoogleWorkspaceGateway.fromPrisma(db, {
        activeProjectId,
        rootUrl: harnessUrl,
      });
    }
  }

  return GoogleWorkspaceGateway.fromPrisma(db, { activeProjectId });
}

export async function getGeminiClient(
  db: PrismaClient = prisma
): Promise<GeminiPort> {
  if (isTestBoundaryHarnessActive()) {
    const boundary = globalThis.__GO_TEST_BOUNDARY__;
    if (boundary?.geminiClient) {
      if (boundary.respectCredentials) {
        await resolveGeminiApiKey(db);
      }
      return boundary.geminiClient;
    }

    const harnessUrl = process.env.TEST_BOUNDARY_HARNESS_URL?.trim();
    if (harnessUrl) {
      return GeminiClient.fromPrisma(db, { baseUrl: harnessUrl });
    }
  }

  return GeminiClient.fromPrisma(db);
}

export function getServices(db: PrismaClient = prisma): AppServices {
  return {
    prisma: db,
    getGoogleGateway: (activeProjectId?: string) =>
      getGoogleGateway(activeProjectId, db),
    getGeminiClient: () => getGeminiClient(db),
  };
}
