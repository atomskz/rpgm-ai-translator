import { describe, expect, it } from "vitest";
import { createProvider } from "../src/providers/public-api.js";

describe("createProvider", () => {
  it("creates the mock and deepseek providers", () => {
    expect(createProvider("mock").name).toBe("mock");
    expect(createProvider("deepseek").name).toBe("deepseek");
  });

  it("accepts provider config such as a custom base URL", () => {
    expect(createProvider("deepseek", { baseUrl: "http://localhost:1234/v1" }).name).toBe("deepseek");
  });

  it("throws for an unknown provider", () => {
    expect(() => createProvider("nope")).toThrow("Unknown provider 'nope'");
  });
});
