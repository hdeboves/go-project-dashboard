import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const TEST_DOUBLE_PATTERNS = [
  {
    group: ["**/tests/doubles*", "**/tests/doubles/**", "tests/doubles/**"],
    message: "Test doubles in tests/doubles/ must NEVER be imported inside src/.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // 1. Default boundary for all src/ files
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "googleapis",
              message: "Import googleapis ONLY inside src/lib/google/** to enforce SandboxGuard.",
            },
            {
              name: "@google/genai",
              message: "Import @google/genai ONLY inside src/lib/gemini/**.",
            },
            {
              name: "@google/generative-ai",
              message: "Legacy SDK forbidden. Use @google/genai ONLY inside src/lib/gemini/**.",
            },
          ],
          patterns: TEST_DOUBLE_PATTERNS,
        },
      ],
    },
  },

  // 2. Allow googleapis inside src/lib/google/** (still ban @google/genai and tests/doubles)
  {
    files: ["src/lib/google/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@google/genai",
              message: "Import @google/genai ONLY inside src/lib/gemini/**.",
            },
            {
              name: "@google/generative-ai",
              message: "Legacy SDK forbidden.",
            },
          ],
          patterns: TEST_DOUBLE_PATTERNS,
        },
      ],
    },
  },

  // 3. Allow @google/genai inside src/lib/gemini/** (still ban googleapis and tests/doubles)
  {
    files: ["src/lib/gemini/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "googleapis",
              message: "Import googleapis ONLY inside src/lib/google/**.",
            },
            {
              name: "@google/generative-ai",
              message: "Legacy SDK forbidden. Use @google/genai.",
            },
          ],
          patterns: TEST_DOUBLE_PATTERNS,
        },
      ],
    },
  },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
