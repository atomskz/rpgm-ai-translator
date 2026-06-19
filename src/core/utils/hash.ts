import { createHash } from "node:crypto";

export function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
