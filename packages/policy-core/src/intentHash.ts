import crypto from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";

/**
 * Compute SHA-256 hash of a settlement intent object for SPA intent binding.
 * Deterministic: same intent always yields same hash.
 */
export function computeIntentHash(intent: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(intent)).digest("hex");
}
