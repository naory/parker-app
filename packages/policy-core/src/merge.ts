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

/** Merge two policies: base + override. Override wins for scalars; allowlists intersected. */
function mergeTwo(base: Policy, override: Policy): Policy {
  return {
    version: POLICY_SCHEMA_VERSION,
    vendorAllowlist: mergeAllowlist(base.vendorAllowlist, override.vendorAllowlist),
    geoAllowlist: mergeGeoAllowlist(base.geoAllowlist, override.geoAllowlist),
    railAllowlist: mergeRailAllowlist(base.railAllowlist, override.railAllowlist),
    assetAllowlist: mergeAssetAllowlist(base.assetAllowlist, override.assetAllowlist),
    capPerTx: override.capPerTx !== undefined ? override.capPerTx : base.capPerTx,
    capPerSession:
      override.capPerSession !== undefined ? override.capPerSession : base.capPerSession,
    capPerDay: override.capPerDay !== undefined ? override.capPerDay : base.capPerDay,
    requireApprovalOver:
      override.requireApprovalOver !== undefined
        ? override.requireApprovalOver
        : base.requireApprovalOver,
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
