import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

function readAppVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function resolveCommitSha(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim()
      .slice(0, 7);
  } catch {
    return "dev";
  }
}

function formatParisBuildDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} à ${get("hour")}:${get("minute")}`;
}

const vercelEnv = process.env.VERCEL_ENV;
const appEnvLabel =
  vercelEnv === "production"
    ? "Production"
    : vercelEnv === "preview"
      ? "Preview"
      : "Local";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "exceljs", "unpdf"],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: readAppVersion(),
    NEXT_PUBLIC_APP_COMMIT: resolveCommitSha(),
    NEXT_PUBLIC_APP_ENV: appEnvLabel,
    NEXT_PUBLIC_BUILD_DATETIME: formatParisBuildDateTime(new Date()),
  },
};

export default nextConfig;
