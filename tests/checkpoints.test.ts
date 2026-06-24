import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  checkpointMetaPath,
  checkpointSignature,
  readCheckpointSignatureFile,
  resolveCheckpoint
} from "../src/cli/checkpoints.js";

const SIGNATURE = checkpointSignature("deepseek", { targetLanguage: "ru", model: "m" });

function resultLine(translation: string): string {
  return `${JSON.stringify({ id: "a", source: "a", translation, provider: "p", model: "m", status: "translated" })}\n`;
}

async function tempCheckpoint(seed: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rpgm-ckpt-"));
  const checkpointPath = path.join(root, "c.jsonl");
  await writeFile(checkpointPath, seed, "utf8");
  return checkpointPath;
}

describe("resolveCheckpoint signature gating", () => {
  it("resumes an explicit checkpoint that has no signature file", async () => {
    const checkpointPath = await tempCheckpoint(resultLine("[ru] a"));
    const resolved = await resolveCheckpoint({
      checkpointOption: checkpointPath,
      derivedPath: `${checkpointPath}.derived`,
      signature: SIGNATURE
    });
    expect(resolved.stale).toBe(false);
    expect(resolved.resumed).toBe(true);
    expect(resolved.results).toHaveLength(1);
  });

  it("discards a checkpoint whose signature is present but incomplete", async () => {
    const checkpointPath = await tempCheckpoint(resultLine("[ru] a"));
    // A half-written or older-format meta missing glossaryHash must be treated as
    // stale, not resumed as "no information" (which could ship mismatched output).
    await writeFile(
      checkpointMetaPath(checkpointPath),
      JSON.stringify({ targetLanguage: "ru", provider: "deepseek", model: "m" }),
      "utf8"
    );
    const resolved = await resolveCheckpoint({
      checkpointOption: checkpointPath,
      derivedPath: `${checkpointPath}.derived`,
      signature: SIGNATURE
    });
    expect(resolved.stale).toBe(true);
    expect(resolved.resumed).toBe(false);
    expect(resolved.results).toHaveLength(0);
  });

  it("discards a checkpoint whose signature does not match", async () => {
    const checkpointPath = await tempCheckpoint(resultLine("[en] a"));
    await writeFile(
      checkpointMetaPath(checkpointPath),
      JSON.stringify(checkpointSignature("deepseek", { targetLanguage: "en", model: "m" })),
      "utf8"
    );
    const resolved = await resolveCheckpoint({
      checkpointOption: checkpointPath,
      derivedPath: `${checkpointPath}.derived`,
      signature: SIGNATURE
    });
    expect(resolved.stale).toBe(true);
    expect(resolved.resumed).toBe(false);
  });
});

describe("readCheckpointSignatureFile", () => {
  it("reports absent, invalid and ok signatures distinctly", async () => {
    const checkpointPath = await tempCheckpoint("");
    const metaPath = checkpointMetaPath(checkpointPath);

    expect((await readCheckpointSignatureFile(metaPath)).status).toBe("absent");

    await writeFile(metaPath, "{ not valid json", "utf8");
    expect((await readCheckpointSignatureFile(metaPath)).status).toBe("invalid");

    await writeFile(metaPath, JSON.stringify({ targetLanguage: "ru", provider: "deepseek" }), "utf8");
    expect((await readCheckpointSignatureFile(metaPath)).status).toBe("invalid");

    await writeFile(metaPath, JSON.stringify(SIGNATURE), "utf8");
    const ok = await readCheckpointSignatureFile(metaPath);
    expect(ok.status).toBe("ok");
    expect(ok.status === "ok" && ok.signature.targetLanguage).toBe("ru");
  });
});
