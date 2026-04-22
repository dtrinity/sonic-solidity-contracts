import { DeployFunction } from "hardhat-deploy/types";

type ReadableOracle = {
  getAssetPrice(asset: string): Promise<bigint>;
  getPriceInfo?(asset: string): Promise<{ price: bigint; isAlive: boolean } | [bigint, boolean]>;
};

export type OraclePriceSample = {
  asset: string;
  price: bigint;
  isAlive: boolean;
  source: string;
};

export async function readOraclePriceSample(source: string, oracle: ReadableOracle, asset: string): Promise<OraclePriceSample> {
  if (typeof oracle.getPriceInfo === "function") {
    try {
      const raw = await oracle.getPriceInfo(asset);

      const price = Array.isArray(raw) ? raw[0] : raw.price;
      const isAlive = Array.isArray(raw) ? raw[1] : raw.isAlive;

      return {
        asset,
        price,
        isAlive,
        source,
      };
    } catch (error) {
      throw new Error(`Failed to read price info for ${source} on ${asset}: ${formatError(error)}`);
    }
  }

  try {
    const price = await oracle.getAssetPrice(asset);

    return {
      asset,
      price,
      isAlive: price > 0n,
      source,
    };
  } catch (error) {
    throw new Error(`Failed to read asset price for ${source} on ${asset}: ${formatError(error)}`);
  }
}

export function assertOraclePriceAlive(sample: OraclePriceSample, context: string): void {
  if (!sample.isAlive || sample.price <= 0n) {
    throw new Error(`${context}: dead or zero price from ${sample.source} for ${sample.asset} (price=${sample.price}, isAlive=${sample.isAlive})`);
  }
}

export function assertPriceContinuity(reference: OraclePriceSample, candidate: OraclePriceSample, toleranceBps: bigint, context: string): void {
  assertOraclePriceAlive(reference, `${context} reference`);
  assertOraclePriceAlive(candidate, `${context} candidate`);

  if (reference.price === 0n) {
    if (candidate.price !== 0n) {
      throw new Error(`${context}: expected zero reference price, got ${candidate.price} from ${candidate.source}`);
    }
    return;
  }

  const delta = reference.price > candidate.price ? reference.price - candidate.price : candidate.price - reference.price;
  const deltaBps = (delta * 10_000n) / reference.price;

  if (deltaBps > toleranceBps) {
    throw new Error(
      `${context}: price continuity failed (${reference.source}=${reference.price}, ${candidate.source}=${candidate.price}, deltaBps=${deltaBps}, toleranceBps=${toleranceBps})`,
    );
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

// This file lives under deploy/ for reuse by fork verification tests, so provide
// a no-op deploy export to keep hardhat-deploy from treating it as an invalid script.
const func: DeployFunction = async function () {
  return true;
};

func.skip = async () => true;
func.tags = [];
func.id = "shared-oracle-price-sanity";

export default func;
