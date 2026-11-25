import path from "node:path";
import { defineConfig } from "vitest/config";

const testDbUrl = `file:${path.resolve(__dirname, "prisma/test.db").replace(/\\/g, "/")}`;

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    env: {
      DATABASE_URL: testDbUrl,
    },
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "tests/e2e/**",
      "tests/e2e-opaque/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
