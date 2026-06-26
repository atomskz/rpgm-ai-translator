# Security Policy

## Supported versions

`rpgm-ai-translator` is an alpha (`0.1.x`) project. Security fixes are made against
the latest released `0.1.x` version and `main`. There is no long-term support
branch yet.

| Version | Supported |
| ------- | --------- |
| latest `0.1.x` | ✅ |
| older `0.1.x` | ❌ (upgrade to the latest) |

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue:

- Preferred: open a private report through GitHub's **"Report a vulnerability"**
  button on the repository's **Security** tab (Security Advisories).

Include, where possible:

- a description of the issue and its impact;
- the version / commit affected;
- steps to reproduce (a minimal `units.json`, game fixture, or command line);
- any relevant logs (with API keys and proprietary game text redacted).

Please do **not** include real API keys or copyrighted game files in a report.

We aim to acknowledge a report within a few days and to ship a fix or mitigation
for confirmed issues in a subsequent `0.1.x` release, crediting the reporter unless
they prefer otherwise.

## Scope and handling notes

This tool runs locally and talks to a translation provider you configure. Keep in
mind when assessing or reporting:

- **API keys** are read from the environment (`DEEPSEEK_API_KEY`) and are never
  written to files, reports, or error output. `init` scaffolds `.env.example` with
  an empty placeholder, never a real key.
- **Untrusted input.** A `units.json` or game project from an untrusted source is
  parsed and used to compute write paths. Path traversal and symlink escapes are
  defended against (relative-path validation plus a write-time realpath re-check on
  both the in-place and patch sides); a bypass of those guards is in scope.
- **Generated artifacts** (translation memory, checkpoints, reports) contain the
  game's text. They are written to the work directory and are git-ignored by the
  scaffolded config; treat them as proprietary.
