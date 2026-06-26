import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Module facades: every directory that exposes a public-api.js is a sealed module.
// Code outside the module must import it through that facade, never its internal
// files. Patterns match the module's directory name anywhere in a relative import
// specifier; the negation re-allows the facade itself. Intra-module imports use
// bare "./file.js" specifiers (no directory segment) and so are never matched.
const FACADE_MODULE_DIRS = [
  "options",
  "config",
  "memory",
  "pipeline",
  "ports",
  "reports",
  "types",
  "validators",
  "rpgmaker-mvmz",
  "patch",
  "providers",
  "openai-chat",
  "deepseek",
  "prompt-builder"
];

const facadePatterns = FACADE_MODULE_DIRS.map((dir) => ({
  group: [`**/${dir}/**`, `!**/${dir}/public-api.js`],
  message: `Import the '${dir}' module only through its public-api.js facade.`
}));

const restrictedImports = (layerGroup) => ({
  "no-restricted-imports": ["error", { patterns: [...(layerGroup ? [layerGroup] : []), ...facadePatterns] }]
});

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
  // core is the domain and depends on nothing outward. Each layer also honours the
  // module facades above. The cli/entry scope carries the facade rules alone.
  {
    files: ["src/core/**/*.ts"],
    rules: restrictedImports({
      group: ["**/cli/**", "**/engines/**", "**/providers/**", "**/config/**"],
      message: "core is the domain and must not depend on outer layers (cli, engines, providers, config)."
    })
  },
  {
    files: ["src/engines/**/*.ts"],
    rules: restrictedImports({
      group: ["**/cli/**", "**/providers/**", "**/config/**"],
      message: "engines is an adapter and may depend only on core."
    })
  },
  {
    files: ["src/providers/**/*.ts"],
    rules: restrictedImports({
      group: ["**/cli/**", "**/engines/**", "**/config/**"],
      message: "providers are adapters and may depend only on core."
    })
  },
  {
    files: ["src/config/**/*.ts"],
    rules: restrictedImports({
      group: ["**/cli/**", "**/engines/**", "**/providers/**"],
      message: "config is an adapter and may depend only on core."
    })
  },
  {
    files: ["src/cli/**/*.ts", "src/*.ts"],
    rules: restrictedImports(null)
  }
);
