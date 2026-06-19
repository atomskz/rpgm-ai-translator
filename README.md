# rpgm-ai-translator

AI-assisted translation pipeline for RPG Maker MV/MZ games.

The first milestone focuses on a reliable CLI core:

```text
detect -> extract -> protect placeholders -> translate -> validate -> apply patch -> report
```

Current scaffold includes:

- typed core interfaces;
- MV/MZ engine detection;
- JSON extraction for common RPG Maker MV/MZ data files;
- RPG Maker control-code placeholder protection;
- validation of translation results;
- safe patch writing for JSON files;
- tests for detector, extractor, placeholders, validator, and patch writer.

## Commands

```bash
npm install
npm test
npm run build

rpgm-ai-translator detect ./game
rpgm-ai-translator extract ./game --out ./work/units.json
rpgm-ai-translator apply ./game ./work/translations.json --mode patch --out ./translated-patch
```

DeepSeek and other LLM providers are intentionally isolated behind the `LLMProvider`
interface and will be added without coupling provider logic to extraction or patching.
