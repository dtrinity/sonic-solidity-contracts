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

/**
 * Read a price sample from a wrapper or aggregator using the richest available interface.
 *
 * @param source - Human-readable source label for diagnostics.
 * @param oracle - Oracle-like contract exposing getAssetPrice and optionally getPriceInfo.
 * @param asset - Asset address to query.
 */
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

/**
 * Require a sampled oracle price to be alive and positive.
 *
 * @param sample - Oracle price sample to validate.
 * @param context - Extra context for any thrown error.
 */
export function assertOraclePriceAlive(sample: OraclePriceSample, context: string): void {
  if (!sample.isAlive || sample.price <= 0n) {
    throw new Error(
      `${context}: dead or zero price from ${sample.source} for ${sample.asset} (price=${sample.price}, isAlive=${sample.isAlive})`,
    );
  }
}

/**
 * Require two oracle samples to stay within a configured basis-point tolerance.
 *
 * @param reference - Reference sample to compare against.
 * @param candidate - Candidate sample being validated.
 * @param toleranceBps - Maximum tolerated deviation in basis points.
 * @param context - Extra context for any thrown error.
 */
export function assertPriceContinuity(
  reference: OraclePriceSample,
  candidate: OraclePriceSample,
  toleranceBps: bigint,
  context: string,
): void {
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

/**
 * Normalize unknown thrown values into a readable message.
 *
 * @param error - Unknown error-like value.
 */
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

func.skip = async (): Promise<boolean> => true;
func.tags = [];
func.id = "shared-oracle-price-sanity";

export default func;
