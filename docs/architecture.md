# Architecture

The project is split into independent layers:

- `core/engine-detector`: identifies the RPG Maker engine and relevant data roots.
- `core/extractors`: turns game files into `TranslationUnit` objects.
- `core/placeholders`: protects RPG Maker control codes before text reaches an LLM.
- `core/validators`: checks translation safety and consistency.
- `core/patch-writer`: writes translated JSON into a separate patch folder.
- `core/reports`: report types and future report writers.
- `core/memory`: translation memory interfaces and future storage implementations.
- `providers/*`: LLM adapters, isolated from core game-file logic.
- `cli`: command-line orchestration only.

The first implemented adapter targets RPG Maker MV/MZ JSON data. VX Ace, VX, and XP
are intentionally out of scope for the MVP, but the `Extractor` and `EngineDetector`
interfaces are designed for additional engine adapters.
