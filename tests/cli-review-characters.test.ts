import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";
import {
  actorNameUnit,
  createCliTempDir,
  dialogueUnit,
  translatedResult,
  writeJsonFixture,
  writeJsonlFixture
} from "./cli/helpers.js";

describe("CLI review and characters", () => {
  it("reviews a translations file with the mock provider", async () => {
    const root = await createCliTempDir("rpgm-cli-review-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const outPath = path.join(root, "translations.reviewed.json");
    const unit = dialogueUnit();
    await writeJsonFixture(unitsPath, [unit]);
    await writeJsonFixture(translationsPath, [
      translatedResult({
        id: unit.id,
        source: unit.source,
        translation: "Я готов.",
        provider: "deepseek",
        model: "deepseek-v4-flash"
      })
    ]);
    const output: string[] = [];

    const exitCode = await runCli(
      ["review", unitsPath, translationsPath, "--provider", "mock", "--target", "ru", "--out", outPath],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const reviewed = JSON.parse(await readFile(outPath, "utf8"));
    const checkpointLines = (await readFile(path.join(root, "translations.reviewed.jsonl"), "utf8")).trim().split(/\r?\n/);
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Reviewing batch 1/1");
    expect(output.join("")).toContain("Completed review batch 1/1");
    expect(output.join("")).toContain("Review checkpoint saved: 1 results.");
    expect(checkpointLines).toHaveLength(1);
    expect(output.join("")).toContain("Reviewed: 1");
    expect(reviewed[0]).toMatchObject({
      id: unit.id,
      translation: "Я готов.",
      metadata: { reviewed: true }
    });
  });

  it("reuses explicit review checkpoints even when the translations file is incomplete", async () => {
    const root = await createCliTempDir("rpgm-cli-review-checkpoint-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const checkpointPath = path.join(root, "review.checkpoint.jsonl");
    const outPath = path.join(root, "translations.reviewed.json");
    const unit = dialogueUnit();
    await writeJsonFixture(unitsPath, [unit]);
    await writeJsonFixture(translationsPath, []);
    await writeJsonlFixture(checkpointPath, [
      {
        id: unit.id,
        source: unit.source,
        translation: "Я готов из checkpoint.",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "translated"
      }
    ]);

    const exitCode = await runCli(
      ["review", unitsPath, translationsPath, "--provider", "mock", "--checkpoint", checkpointPath, "--out", outPath],
      {
        stdout: () => undefined,
        stderr: () => undefined
      }
    );

    const reviewed = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(reviewed).toEqual([
      expect.objectContaining({
        id: unit.id,
        translation: "Я готов из checkpoint.",
        metadata: { fromCheckpoint: true }
      })
    ]);
  });

  it("discards an explicit review checkpoint when the target language changed", async () => {
    const root = await createCliTempDir("rpgm-cli-review-stale-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const checkpointPath = path.join(root, "review.checkpoint.jsonl");
    const outPath = path.join(root, "translations.reviewed.json");
    const unit = dialogueUnit();
    await writeJsonFixture(unitsPath, [unit]);
    await writeJsonFixture(translationsPath, [
      translatedResult({ id: unit.id, source: unit.source, translation: "Я готов." })
    ]);
    await writeJsonlFixture(checkpointPath, [
      {
        id: unit.id,
        source: unit.source,
        translation: "STALE EN CHECKPOINT",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        status: "translated"
      }
    ]);
    // The signature beside the checkpoint records a different target language, so
    // the checkpoint must be discarded rather than mixed into a --target ru review.
    await writeJsonFixture(`${checkpointPath}.meta.json`, {
      targetLanguage: "en",
      sourceLanguage: "",
      provider: "mock",
      model: "",
      glossaryHash: "stale"
    });

    const stderr: string[] = [];
    const exitCode = await runCli(
      ["review", unitsPath, translationsPath, "--provider", "mock", "--target", "ru", "--checkpoint", checkpointPath, "--out", outPath],
      {
        stdout: () => undefined,
        stderr: (text) => stderr.push(text)
      }
    );

    const reviewed = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("checkpoint parameters");
    expect(reviewed[0].translation).not.toBe("STALE EN CHECKPOINT");
    expect(reviewed[0]).toMatchObject({ id: unit.id, metadata: { reviewed: true } });
  });

  it("generates a character glossary from units", async () => {
    const root = await createCliTempDir("rpgm-cli-characters-");
    const unitsPath = path.join(root, "units.json");
    const translationsPath = path.join(root, "translations.json");
    const outPath = path.join(root, "characters.json");
    await writeJsonFixture(unitsPath, [
      actorNameUnit({
        normalizedSource: undefined,
        engine: "rpgmaker-mz",
        hash: "hash-aria"
      }),
      dialogueUnit({
        normalizedSource: undefined,
        context: { speaker: "Aria" },
        hash: "hash-dialogue"
      })
    ]);
    await writeJsonFixture(translationsPath, [translatedResult()]);
    const output: string[] = [];

    const exitCode = await runCli(
      ["characters", unitsPath, "--translations", translationsPath, "--provider", "mock", "--out", outPath],
      {
        stdout: (text) => output.push(text),
        stderr: () => undefined
      }
    );

    const characters = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("Character candidates: 1");
    expect(characters).toEqual({
      Aria: expect.objectContaining({
        translation: "Ария",
        gender: "unknown",
        type: "person"
      })
    });
  });

  it("builds a draft glossary with --provider none", async () => {
    const root = await createCliTempDir("rpgm-cli-characters-none-");
    const unitsPath = path.join(root, "units.json");
    const outPath = path.join(root, "characters.json");
    await writeJsonFixture(unitsPath, [actorNameUnit({ normalizedSource: undefined, hash: "hash-aria" })]);

    const exitCode = await runCli(["characters", unitsPath, "--provider", "none", "--out", outPath], {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const characters = JSON.parse(await readFile(outPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(characters.Aria).toMatchObject({ review: true });
  });
});
