import type { PrismaClient } from "@prisma/client";
import { CalendarAdapter } from "@/lib/google/calendar";
import { DriveAdapter } from "@/lib/google/drive";
import { GmailAdapter } from "@/lib/google/gmail";
import { getAuthenticatedOAuth2Client } from "@/lib/google/oauth";
import type {
  SandboxProjectContext,
  SandboxViolationError,
} from "@/lib/google/sandbox-guard";
import { SheetsAdapter } from "@/lib/google/sheets";
import { SlidesAdapter } from "@/lib/google/slides";
import type { GoogleWorkspacePort } from "@/lib/ports";

export class GoogleWorkspaceGateway implements GoogleWorkspacePort {
  readonly userEmail?: string;
  readonly drive: DriveAdapter;
  readonly sheets: SheetsAdapter;
  readonly slides: SlidesAdapter;
  readonly gmail: GmailAdapter;
  readonly calendar: CalendarAdapter;

  constructor(params: {
    auth: Parameters<typeof DriveAdapter.prototype.getFileMetadata> extends never
      ? never
      : ConstructorParameters<typeof DriveAdapter>[0]["auth"];
    userEmail?: string;
    sandboxCtx: SandboxProjectContext;
    registeredCalendarIds: string[];
    rootUrl?: string;
  }) {
    this.userEmail = params.userEmail;
    this.drive = new DriveAdapter({
      auth: params.auth,
      sandboxCtx: params.sandboxCtx,
      rootUrl: params.rootUrl,
    });
    this.sheets = new SheetsAdapter({
      auth: params.auth,
      resolver: this.drive,
      sandboxCtx: params.sandboxCtx,
      rootUrl: params.rootUrl,
    });
    this.slides = new SlidesAdapter({
      auth: params.auth,
      drive: this.drive,
      resolver: this.drive,
      sandboxCtx: params.sandboxCtx,
      rootUrl: params.rootUrl,
    });
    this.gmail = new GmailAdapter({
      auth: params.auth,
      rootUrl: params.rootUrl,
    });
    this.calendar = new CalendarAdapter({
      auth: params.auth,
      registeredCalendarIds: params.registeredCalendarIds,
      rootUrl: params.rootUrl,
    });
  }

  static async fromPrisma(
    prisma: PrismaClient,
    options?: {
      activeProjectId?: string;
      rootUrl?: string;
      userId?: string | null;
    }
  ): Promise<GoogleWorkspaceGateway> {
    const { oauth2Client, userEmail } = await getAuthenticatedOAuth2Client(
      prisma,
      undefined,
      options?.userId
    );

    const projects = await prisma.project.findMany({
      select: {
        id: true,
        isSandbox: true,
        driveInternalRootId: true,
        driveExternalRootId: true,
        calendarId: true,
      },
    });

    const allowedRootIds = projects.flatMap((p) =>
      [p.driveInternalRootId, p.driveExternalRootId].filter(
        (id): id is string => Boolean(id)
      )
    );
    const registeredCalendarIds = projects
      .map((p) => p.calendarId)
      .filter((id): id is string => Boolean(id));

    const sandboxCtx: SandboxProjectContext = {
      projectId: options?.activeProjectId,
      allowedRootIds,
      onViolation: async (err: SandboxViolationError) => {
        await prisma.auditLog.create({
          data: {
            projectId: err.projectId ?? options?.activeProjectId ?? null,
            actor: "system:sandbox-guard",
            action: "SANDBOX_VIOLATION_BLOCKED",
            targetType: "GOOGLE_RESOURCE",
            targetId: err.targetId,
            detailsJson: JSON.stringify({
              operation: err.operation,
              reason: err.reason,
              ancestryChain: err.ancestryChain ?? [],
            }),
          },
        });
      },
    };

    return new GoogleWorkspaceGateway({
      auth: oauth2Client,
      userEmail,
      sandboxCtx,
      registeredCalendarIds,
      rootUrl: options?.rootUrl,
    });
  }
}
