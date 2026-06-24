import { describe, expect, it } from "vitest";
import {
  decodeEncodedJsonSegment,
  encodeArrayIndexSegment,
  encodeObjectKeySegment,
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

describe("encoded-json segment round-trip", () => {
  it("distinguishes an array index from a numeric object key", () => {
    expect(encodeArrayIndexSegment(0)).toBe("#0");
    expect(encodeObjectKeySegment("0")).toBe("0");
    expect(decodeEncodedJsonSegment("#0")).toBe("0");
    expect(decodeEncodedJsonSegment("0")).toBe("0");
  });

  it("escapes an object key that begins with #", () => {
    expect(encodeObjectKeySegment("#tag")).toBe("##tag");
    expect(decodeEncodedJsonSegment("##tag")).toBe("#tag");
    // A real array index still decodes back to the bare number.
    expect(decodeEncodedJsonSegment(encodeArrayIndexSegment(5))).toBe("5");
  });
});
