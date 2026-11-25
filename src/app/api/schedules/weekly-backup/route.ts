import { handleSchedule } from "@vercel/schedules";
import { createBackupSnapshot } from "@/lib/backup/backup-service";
import { prisma } from "@/lib/prisma";

export const POST = handleSchedule(async (metadata) => {
  await createBackupSnapshot(prisma, {
    trigger: "WEEKLY_SCHEDULE",
    executionId: metadata.executionId,
    createdBy: `schedule:${metadata.name}`,
  });
});
