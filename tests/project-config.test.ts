import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadProjectConfig, mergeConfigIntoArgs, PROJECT_CONFIG_FILENAME } from "../src/config/project.js";

describe("loadProjectConfig", () => {
  it("returns undefined when no default config exists", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-none-"));
    await expect(loadProjectConfig(dir, undefined)).resolves.toBeUndefined();
  });

  it("loads the default config from the working directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-default-"));
    await writeFile(
      path.join(dir, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ provider: "deepseek", target: "en", includePlugins: true }),
      "utf8"
    );
    await expect(loadProjectConfig(dir, undefined)).resolves.toEqual({
      provider: "deepseek",
      target: "en",
      includePlugins: true
    });
  });

  it("throws when an explicit --config path is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-missing-"));
    await expect(loadProjectConfig(dir, path.join(dir, "nope.json"))).rejects.toThrow("Cannot read config file");
  });

  it("throws on malformed config JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-bad-"));
    const configPath = path.join(dir, "bad.json");
    await writeFile(configPath, "{not json", "utf8");
    await expect(loadProjectConfig(dir, configPath)).rejects.toThrow("Invalid config JSON");
  });

  it("rejects a non-object config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-array-"));
    const configPath = path.join(dir, "arr.json");
    await writeFile(configPath, "[1,2,3]", "utf8");
    await expect(loadProjectConfig(dir, configPath)).rejects.toThrow("must be a JSON object");
  });
});

describe("mergeConfigIntoArgs", () => {
  it("injects config values as defaults for absent flags", () => {
    const merged = mergeConfigIntoArgs("run", ["./game", "--out", "./out"], {
      provider: "deepseek",
      target: "en",
      includePlugins: true
    });
    expect(merged).toContain("--provider");
    expect(merged[merged.indexOf("--provider") + 1]).toBe("deepseek");
    expect(merged).toContain("--target");
    expect(merged[merged.indexOf("--target") + 1]).toBe("en");
    expect(merged).toContain("--include-plugins");
  });

  it("lets an explicit CLI flag override the config value", () => {
    const merged = mergeConfigIntoArgs("run", ["./game", "--out", "./out", "--target", "ja"], {
      target: "en"
    });
    expect(merged.filter((token) => token === "--target")).toHaveLength(1);
    expect(merged[merged.indexOf("--target") + 1]).toBe("ja");
  });

  it("does not inject flags the command does not accept", () => {
    const merged = mergeConfigIntoArgs("detect", ["./game"], { provider: "deepseek", target: "en" });
    expect(merged).toEqual(["./game"]);
  });

  it("never injects a false boolean and has no --no- form", () => {
    const merged = mergeConfigIntoArgs("run", ["./game", "--out", "./out"], { review: false });
    expect(merged).not.toContain("--review");
  });

  it("joins array values such as repairCodes", () => {
    const merged = mergeConfigIntoArgs("run", ["./game", "--out", "./out", "--repair"], {
      repairCodes: ["MAX_LENGTH_EXCEEDED", "MISSING_TRANSLATION"]
    });
    expect(merged[merged.indexOf("--repair-codes") + 1]).toBe("MAX_LENGTH_EXCEEDED,MISSING_TRANSLATION");
  });

  it("returns args unchanged when config is undefined", () => {
    const args = ["./game", "--out", "./out"];
    expect(mergeConfigIntoArgs("run", args, undefined)).toBe(args);
  });
});
