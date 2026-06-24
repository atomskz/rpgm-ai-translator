import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";

describe("synthetic fixtures", () => {
  it("runs the mock pipeline against the checked-in MZ sample", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "rpgm-mz-sample-out-"));
    const output: string[] = [];
    const gamePath = path.resolve("examples/mz-sample");

    const exitCode = await runCli(
      ["run", gamePath, "--provider", "mock", "--target", "ru", "--include-plugins", "--out", outDir],
      {
        stdout: (text) => output.push(text),
        stderr: (text) => output.push(text)
      }
    );

    const report = JSON.parse(await readFile(path.join(`${outDir}-work`, "report.json"), "utf8"));
    const map = JSON.parse(await readFile(path.join(outDir, "data", "Map001.json"), "utf8"));
    const plugins = await readFile(path.join(outDir, "js", "plugins.js"), "utf8");

    expect(exitCode).toBe(0);
    expect(report).toMatchObject({
      engine: "rpgmaker-mz",
      failed: 0
    });
    expect(report.unitsExtracted).toBeGreaterThan(10);
    expect(map.events[1].pages[0].list[1].parameters[0]).toContain(String.raw`\N[1]`);
    expect(map.events[1].pages[0].list[1].parameters[0]).toContain(String.raw`\I[64]`);
    expect(map.events[1].pages[0].list[3].parameters[4]).toContain("[ru] Find Aria");
    expect(map.events[1].pages[0].list[4].parameters[3].choices).toContain("[ru] Give the ring?");
    expect(plugins).toContain("[ru] Quest Log");
    expect(plugins).toContain("[ru] Open Quest Log");
    expect(output.join("")).toContain("Units translated:");
  });
});
