import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadProjectConfig, PROJECT_CONFIG_FILENAME } from "../src/config/public-api.js";
import { mergeConfigIntoArgs } from "../src/cli/config-args.js";

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

  it("rejects a value of the wrong type, naming the file and key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-type-"));
    const configPath = path.join(dir, "bad-type.json");
    await writeFile(configPath, JSON.stringify({ batchSize: "x" }), "utf8");
    await expect(loadProjectConfig(dir, configPath)).rejects.toThrow(
      /config key 'batchSize' in '.*bad-type\.json': expected a finite number/
    );
  });

  it("rejects an unknown validation issue code in repairCodes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-codes-"));
    const configPath = path.join(dir, "bad-codes.json");
    await writeFile(configPath, JSON.stringify({ repairCodes: ["MAX_LENGTH_EXCEEDED", "NOPE"] }), "utf8");
    await expect(loadProjectConfig(dir, configPath)).rejects.toThrow(/unknown validation issue code 'NOPE'/);
  });

  it("warns about an unknown top-level key but still loads the rest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-unknown-"));
    const configPath = path.join(dir, "typo.json");
    await writeFile(configPath, JSON.stringify({ temprature: 0.3, target: "ru" }), "utf8");
    const warnings: string[] = [];
    await expect(loadProjectConfig(dir, configPath, (message) => warnings.push(message))).resolves.toEqual({
      temprature: 0.3,
      target: "ru"
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Unknown config key 'temprature'");
  });

  it("treats a null value as absent rather than a type error", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rpgm-config-null-"));
    const configPath = path.join(dir, "null.json");
    await writeFile(configPath, JSON.stringify({ batchSize: null, target: "en" }), "utf8");
    await expect(loadProjectConfig(dir, configPath)).resolves.toEqual({ batchSize: null, target: "en" });
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

  it("injects a numeric config default that an explicit flag still overrides", () => {
    const fromConfig = mergeConfigIntoArgs("run", ["./game", "--out", "./out"], { batchSize: 10 });
    expect(fromConfig[fromConfig.indexOf("--batch-size") + 1]).toBe("10");

    const overridden = mergeConfigIntoArgs("run", ["./game", "--out", "./out", "--batch-size", "4"], {
      batchSize: 10
    });
    expect(overridden.filter((token) => token === "--batch-size")).toHaveLength(1);
    expect(overridden[overridden.indexOf("--batch-size") + 1]).toBe("4");
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
