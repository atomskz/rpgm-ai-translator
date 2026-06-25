import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "out/**", "test/game/**", "examples/mz-sample/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      parserOptions: {
        project: false
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  // Architectural layer boundaries (hexagonal / ports-and-adapters). Dependencies
  // point inward only: cli is the composition root and may import any layer;
  // engines, providers, and config are adapters that may depend only on core;
  // core is the domain and depends on nothing outward. Enforced by forbidding the
  // relative imports that would cross a boundary the wrong way.
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "**/engines/**", "**/providers/**", "**/config/**"],
              message: "core is the domain and must not depend on outer layers (cli, engines, providers, config)."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/engines/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "**/providers/**", "**/config/**"],
              message: "engines is an adapter and may depend only on core."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/providers/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "**/engines/**", "**/config/**"],
              message: "providers are adapters and may depend only on core."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/config/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "**/engines/**", "**/providers/**"],
              message: "config is an adapter and may depend only on core."
            }
          ]
        }
      ]
    }
  }
);
