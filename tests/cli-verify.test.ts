import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/app.js";

async function makeGame(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rpgm-verify-game-"));
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "data", "Actors.json"), JSON.stringify([null, { id: 1, name: "Aria" }]), "utf8");
  return root;
}

async function makePatch(content: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rpgm-verify-patch-"));
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "data", "Actors.json"), content, "utf8");
  return root;
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (t: string) => stdout.push(t), stderr: (t: string) => stderr.push(t) } };
}

describe("verify", () => {
  it("passes a patch that structurally matches the game", async () => {
    const game = await makeGame();
    const patch = await makePatch(JSON.stringify([null, { id: 1, name: "Ария" }]));
    const { stdout, io } = capture();

    const code = await runCli(["verify", game, patch], io);

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("1 ok, 0 failed");
  });

  it("fails a patch whose JSON does not parse", async () => {
    const game = await makeGame();
    const patch = await makePatch("[null, {");
    const { stdout, io } = capture();

    const code = await runCli(["verify", game, patch], io);

    expect(code).toBe(1);
    expect(stdout.join("")).toContain("does not parse");
  });

  it("fails a patch whose structure differs from the game", async () => {
    const game = await makeGame();
    const patch = await makePatch(JSON.stringify([null, { id: 1, name: "Ария" }, { id: 2, name: "Луна" }]));
    const { stdout, io } = capture();

    const code = await runCli(["verify", game, patch], io);

    expect(code).toBe(1);
    expect(stdout.join("")).toContain("array length differs");
  });

  it("fails on an orphan patch file with no game counterpart", async () => {
    const game = await makeGame();
    const patch = await makePatch(JSON.stringify([null, { id: 1, name: "Ария" }]));
    await writeFile(path.join(patch, "data", "Ghost.json"), JSON.stringify([null]), "utf8");
    const { stdout, io } = capture();

    const code = await runCli(["verify", game, patch], io);

    expect(code).toBe(1);
    expect(stdout.join("")).toContain("orphan patch file");
  });

  it("refuses a patch directory inside the game", async () => {
    const game = await makeGame();
    const inside = path.join(game, "patch");
    await mkdir(inside, { recursive: true });
    const { stderr, io } = capture();

    const code = await runCli(["verify", game, inside], io);

    expect(code).toBe(1);
    expect(stderr.join("")).toContain("not safely separate");
  });
});
