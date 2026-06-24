import { describe, expect, it } from "vitest";
import {
  getJsonPath,
  isUnsafePathSegment,
  setJsonPath,
  setJsonPathSegments
} from "../src/core/utils/json-path.js";

describe("json-path prototype-pollution guard", () => {
  it("flags the dangerous segment names", () => {
    expect(isUnsafePathSegment("__proto__")).toBe(true);
    expect(isUnsafePathSegment("constructor")).toBe(true);
    expect(isUnsafePathSegment("prototype")).toBe(true);
    expect(isUnsafePathSegment("name")).toBe(false);
  });

  it("refuses to write through __proto__/constructor/prototype", () => {
    const root: Record<string, unknown> = {};
    expect(() => setJsonPath(root, "__proto__.polluted", "x")).toThrow(/unsafe JSON path segment/);
    expect(() => setJsonPathSegments(root, ["constructor", "prototype", "polluted"], "x")).toThrow(/unsafe/);
    // Object.prototype must not have been polluted by either attempt.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reads an unsafe segment as undefined instead of returning the prototype", () => {
    expect(getJsonPath({}, "__proto__")).toBeUndefined();
    expect(getJsonPath({}, "constructor.prototype")).toBeUndefined();
  });

  it("still writes and reads a normal nested path", () => {
    const root: Record<string, unknown> = { a: { b: "old" } };
    setJsonPath(root, "a.b", "new");
    expect(getJsonPath(root, "a.b")).toBe("new");
  });
});
