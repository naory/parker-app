/**
 * Pure merge of layered policies (platform → owner → vehicle → lot).
 * No DB, Express, or chain clients.
 */

import type { Policy, PolicyStack, PolicySchemaVersion, Rail, Asset, GeoCircle } from "./types.js";
import { POLICY_SCHEMA_VERSION } from "./types.js";

function mergeAllowlist<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

function mergeGeoAllowlist(
  a: GeoCircle[] | undefined,
  b: GeoCircle[] | undefined
): GeoCircle[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return b.length > 0 ? b : a;
}

function mergeRailAllowlist(
  a: Rail[] | undefined,
  b: Rail[] | undefined
): Rail[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  const set = new Set(b);
  return a.filter((r) => set.has(r));
}

function mergeAssetAllowlist(
  a: Asset[] | undefined,
  b: Asset[] | undefined
): Asset[] | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  const key = (x: Asset) =>
    x.kind === "XRP"
      ? "XRP"
      : x.kind === "IOU"
        ? `IOU:${x.currency}:${x.issuer}`
        : `ERC20:${x.chainId}:${x.token}`;
  const keysB = new Set(b.map(key));
  return a.filter((x) => keysB.has(key(x)));
}

function mergeCapMin(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return BigInt(a) <= BigInt(b) ? a : b;
}

/** Merge two policies: allowlists intersect; caps use strictest numeric min. */
function mergeTwo(base: Policy, override: Policy): Policy {
  return {
    version: POLICY_SCHEMA_VERSION,
    lotAllowlist: mergeAllowlist(base.lotAllowlist, override.lotAllowlist),
    operatorAllowlist: mergeAllowlist(
      base.operatorAllowlist ?? base.vendorAllowlist,
      override.operatorAllowlist ?? override.vendorAllowlist,
    ),
    vendorAllowlist: undefined,
    geoAllowlist: mergeGeoAllowlist(base.geoAllowlist, override.geoAllowlist),
    railAllowlist: mergeRailAllowlist(base.railAllowlist, override.railAllowlist),
    assetAllowlist: mergeAssetAllowlist(base.assetAllowlist, override.assetAllowlist),
    capPerTxMinor: mergeCapMin(base.capPerTxMinor, override.capPerTxMinor),
    capPerSessionMinor: mergeCapMin(base.capPerSessionMinor, override.capPerSessionMinor),
    capPerDayMinor: mergeCapMin(base.capPerDayMinor, override.capPerDayMinor),
    requireApprovalOverMinor:
      override.requireApprovalOverMinor !== undefined
        ? override.requireApprovalOverMinor
        : base.requireApprovalOverMinor,
  };
}

/**
 * Resolve effective policy from a layered stack.
 * Precedence: platform < owner < vehicle < lot (each layer overrides the previous).
 */
export function resolveEffectivePolicy(stack: PolicyStack): Policy {
  let out: Policy = stack.platform;
  if (stack.owner) out = mergeTwo(out, stack.owner);
  if (stack.vehicle) out = mergeTwo(out, stack.vehicle);
  if (stack.lot) out = mergeTwo(out, stack.lot);
  return out;
}
