import { describe, expect, it } from "vitest";
import { createProvider, SUPPORTED_PROVIDER_NAMES } from "../src/providers/public-api.js";

describe("createProvider", () => {
  it("creates the mock and deepseek providers", () => {
    expect(createProvider("mock").name).toBe("mock");
    expect(createProvider("deepseek").name).toBe("deepseek");
  });

  it("accepts provider config such as a custom base URL", () => {
    expect(createProvider("deepseek", { baseUrl: "http://localhost:1234/v1" }).name).toBe("deepseek");
  });

  it("throws for an unknown provider, listing the registry's supported names", () => {
    expect(() => createProvider("nope")).toThrow("Unknown provider 'nope'");
    expect(() => createProvider("nope")).toThrow(SUPPORTED_PROVIDER_NAMES.join(", "));
  });

  it("derives the supported-name list from the registry", () => {
    // Each registered name must build a working provider whose name round-trips,
    // so the derived list cannot drift from what createProvider actually accepts.
    expect(SUPPORTED_PROVIDER_NAMES).toContain("mock");
    expect(SUPPORTED_PROVIDER_NAMES).toContain("deepseek");
    for (const name of SUPPORTED_PROVIDER_NAMES) {
      expect(createProvider(name).name).toBe(name);
    }
  });
});
