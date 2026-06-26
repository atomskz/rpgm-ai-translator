# Contributing to rpgm-ai-translator

Thanks for your interest! This is an alpha project; contributions, bug reports and
ideas are welcome.

## Getting started

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Node 20.19+ is required (CI runs Node 20/22/24).

## Validation baseline

Every change must keep the following green — this is exactly what CI enforces:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

For provider/packaging changes also run:

```bash
npm run coverage    # coverage thresholds are enforced in CI
npm run pack:check  # builds and inspects the publishable tarball
```

A quick end-to-end smoke (no network, uses the mock provider and the bundled
sample) after a build:

```bash
node dist/cli/index.js run ./examples/mz-sample --provider mock --target ru \
  --include-plugins --review --repair --out /tmp/p
```

## Architecture

The code is a hexagonal (ports-and-adapters) layout; dependencies point inward:

- `core/` — the domain and the `LLMProvider` / `Extractor` / `EngineDetector`
  ports. Depends on nothing outward.
- `engines/` — engine adapters (RPG Maker MV/MZ today). A new engine is a sibling
  adapter folder plus one entry in `engines/registry.ts`, not edits in every command.
- `providers/` — provider adapters. `providers/openai-chat` is a shared
  OpenAI-compatible base; a new provider is a small subclass plus one entry in the
  `PROVIDERS` registry in `providers/providers.ts`.
- `config/` — config/glossary/character loaders.
- `cli/` — the composition root; wires everything together.

Two rules are enforced by eslint and will fail `lint`/CI:

1. **Layer boundaries.** An adapter (`engines`/`providers`/`config`) may depend
   only on `core`; `core` must not import an outer layer.
2. **Module facades.** Import a module through its `public-api.ts`, never its
   internal files.

The per-command option spec in `cli/options/command-args.ts` is the single source
of truth for a command's flags, validation and help. To add a flag or command,
start there, then wire `app.ts` (`COMMANDS`), `help.ts` (`COMMAND_HELP` + the
top-level list), a handler in `cli/commands/`, and a behavior test in
`tests/cli-*.test.ts`.

Do not change translation-unit id construction (`extract/shared.ts`) without a
migration: `apply` matches by id, so changing it silently breaks every saved patch.

## Tests

Tests use [Vitest](https://vitest.dev/). Add a test with your change:

- a CLI behavior test for a new/changed command (`tests/cli-*.test.ts`);
- a unit/fixture test for core or engine logic.

Prefer a mock-fetch test over hitting the network for provider changes.

## Pull requests

- Keep a PR focused on one logical change.
- Update `CHANGELOG.md` (under `## Unreleased`) describing the change.
- Make sure the validation baseline above passes.
- Never commit secrets, real commercial game files, or generated translation
  memory (see `.gitignore` and the README's Safety section).

## License

By contributing you agree that your contributions are licensed under the project's
[GPL-3.0-or-later](./LICENSE) license.
