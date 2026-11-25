import { execSync } from "node:child_process";

const dbUrl = (process.env.DATABASE_URL || "").trim();

if (!dbUrl || !/^postgres(ql)?:\/\//i.test(dbUrl)) {
  console.log(
    "[sync-db-on-build] Skipping prisma db push (no PostgreSQL DATABASE_URL in environment)."
  );
  process.exit(0);
}

console.log("[sync-db-on-build] Running prisma db push --skip-generate...");
try {
  execSync("npx prisma db push --skip-generate", {
    stdio: "inherit",
    env: process.env,
  });
  console.log("[sync-db-on-build] Database schema synchronized.");
} catch (err) {
  console.error("[sync-db-on-build] prisma db push failed:", err);
  process.exit(1);
}
