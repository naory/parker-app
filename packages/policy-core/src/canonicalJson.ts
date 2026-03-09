/**
 * Canonical JSON for deterministic hashing of protocol structures.
 * - Keys sorted lexicographically
 * - undefined and null object fields omitted
 * - undefined in arrays replaced with null
 * - Throws on top-level undefined
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new Error("Cannot canonicalize undefined");
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}
