import { describe, expect, it } from "vitest";
import { computeIntentHash } from "../src/intentHash.js";

describe("computeIntentHash", () => {
  it("produces stable hash for same intent", () => {
    const intent = {
      rail: "xrpl",
      destination: "rDest...",
      amount: "19440000",
      currency: "RLUSD",
      issuer: "rIssuer...",
    };
    const h1 = computeIntentHash(intent);
    const h2 = computeIntentHash(intent);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different intents", () => {
    const intent1 = { rail: "xrpl", amount: "1000" };
    const intent2 = { rail: "xrpl", amount: "2000" };
    expect(computeIntentHash(intent1)).not.toBe(computeIntentHash(intent2));
  });
});
