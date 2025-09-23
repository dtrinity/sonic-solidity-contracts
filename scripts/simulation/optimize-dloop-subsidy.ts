#!/usr/bin/env ts-node
/* eslint-disable no-console */

/**
 * optimize-subsidy.ts
 * --------------------------------------------
 * Monte-Carlo simulator that sweeps `maxSubsidyBps` and
 * returns the value that maximises the vault's retained value
 * under a simplified price process.
 *
 * The model is deliberately abstract; it is meant for research
 * tuning rather than on-chain safety guarantees.
 *
 * Usage:
 *   ts-node scripts/simulation/optimize-subsidy.ts --target 30000 --lower 25000 --upper 35000 \
 *         --steps 1000 --trials 250 --sigma 0.2 --mu 0.05 --subsidyMin 0 --subsidyMax 5000 --subsidyStep 250
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

interface SimParams {
  target: number; // in bps
  lower: number; // in bps
  upper: number; // in bps
  sigma: number; // annualised vol (e.g. 0.2)
  muMean: number; // mean of annual drift (e.g. 0.05)
  rateSigma: number; // volatility of annual drift allowing negative rates
  steps: number; // timesteps per trial (e.g. 1000)
  trials: number; // Monte Carlo paths (e.g. 100)
  subsidyMin: number; // min maxSubsidyBps
  subsidyMax: number; // max maxSubsidyBps
  subsidyStep: number; // step size
  initialPrice: number; // starting collateral price in base currency
  initialCollateralTokens: number; // starting collateral units
  costBps: number;
  multMin: number;
  multMax: number;
  multStep: number;
  currentMult: number;
}

interface TrialResult {
  value: number;
  meanLev: number; // average leverage bps during the trial
}

const parser = yargs(hideBin(process.argv))
  .options({
    target: {
      type: "number",
      demandOption: true,
      describe: "Target leverage in bps (e.g. 30000 for 3x)",
    },
    lower: {
      type: "number",
      demandOption: true,
      describe: "Lower bound leverage bps",
    },
    upper: {
      type: "number",
      demandOption: true,
      describe: "Upper bound leverage bps",
    },
    sigma: {
      type: "number",
      default: 0.2,
      describe: "Annualised volatility of collateral price",
    },
    muMean: {
      type: "number",
      default: 0.05,
      describe: "Mean annual drift of collateral price",
    },
    rateSigma: {
      type: "number",
      default: 0.1,
      describe: "Std-dev of annual drift, allowing negative periods",
    },
    steps: { type: "number", default: 1000, describe: "Timesteps per trial" },
    trials: {
      type: "number",
      default: 200,
      describe: "Number of Monte Carlo trials",
    },
    subsidyMin: {
      type: "number",
      default: 0,
      describe: "Minimum maxSubsidyBps to test",
    },
    subsidyMax: {
      type: "number",
      default: 5000,
      describe: "Maximum maxSubsidyBps to test",
    },
    subsidyStep: {
      type: "number",
      default: 250,
      describe: "Increment when sweeping subsidy bps",
    },
    initialPrice: {
      type: "number",
      default: 100,
      describe: "Initial collateral price in base currency",
    },
    initialCollateral: {
      type: "number",
      default: 100,
      describe: "Initial collateral tokens held by vault",
    },
    costBps: {
      type: "number",
      default: 30,
      describe: "Approximate slippage cost borne by rebalancer, in bps of swapped notional",
    },
    multMin: {
      type: "number",
      default: 0.5,
      describe: "Minimum deviation multiplier",
    },
    multMax: {
      type: "number",
      default: 2,
      describe: "Maximum deviation multiplier",
    },
    multStep: {
      type: "number",
      default: 0.1,
      describe: "Step for deviation multiplier",
    },
  })
  .strict();

// Yargs v17 exposes `parseSync()`, older versions expose synchronous parsing via `.argv` or `.parse()`.
// This shim keeps compatibility with either API surface.
const argv = (parser as any).parseSync ? (parser as any).parseSync() : parser.parse();

const params: SimParams = {
  target: argv.target,
  lower: argv.lower,
  upper: argv.upper,
  sigma: argv.sigma,
  muMean: argv.muMean,
  rateSigma: argv.rateSigma,
  steps: argv.steps,
  trials: argv.trials,
  subsidyMin: argv.subsidyMin,
  subsidyMax: argv.subsidyMax,
  subsidyStep: argv.subsidyStep,
  initialPrice: argv.initialPrice,
  initialCollateralTokens: argv.initialCollateral,
  costBps: argv.costBps,
  multMin: argv.multMin,
  multMax: argv.multMax,
  multStep: argv.multStep,
  currentMult: argv.multMin,
};

const ONE_HUNDRED_PERCENT_BPS = 10_000;

/** Generate a standard normal random using Box-Muller */
function randomNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random(); // avoid 0
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Compute leverage in bps. Infinite leverage returns Number.MAX_SAFE_INTEGER */
function leverageBps(collateralBase: number, debtBase: number): number {
  if (collateralBase <= debtBase) return Number.MAX_SAFE_INTEGER;
  return (collateralBase * ONE_HUNDRED_PERCENT_BPS) / (collateralBase - debtBase);
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/** Optimise over subsidy range */
function runOptimisation(): void {
  const results: Array<{
    multiplier: number;
    meanValue: number;
    avgLev: number;
    q25: number;
    q75: number;
  }> = [];

  for (
    let mult = params.multMin;
    mult <= params.multMax + 1e-9;
    mult = Math.round((mult + params.multStep) * 1e6) / 1e6 // avoid FP drift
  ) {
    params.currentMult = mult;

    // we keep maxSubsidyBps constant (params.subsidyMax) but could sweep too
    const maxSubsidyBps = params.subsidyMax;

    let aggValue = 0;
    const leverages: number[] = [];

    for (let t = 0; t < params.trials; t++) {
      const { value, meanLev } = runSingleSimulation(maxSubsidyBps);
      aggValue += value;
      leverages.push(meanLev);
    }

    const meanValue = aggValue / params.trials;
    // derive leverage stats
    leverages.sort((a, b) => a - b);
    const avgLev = leverages.reduce((s, v) => s + v, 0) / leverages.length;
    const q25 = percentile(leverages, 25);
    const q75 = percentile(leverages, 75);

    results.push({ multiplier: mult, meanValue, avgLev, q25, q75 });
  }

  // Determine optimal
  const optimal = results.reduce((best, curr) => (curr.meanValue > best.meanValue ? curr : best));

  console.table(results);
  console.log(
    "Optimal multiplier:",
    optimal.multiplier.toFixed(2),
    "with mean retained value",
    optimal.meanValue.toFixed(2),
  );
}

function runSingleSimulation(maxSubsidyBps: number): TrialResult {
  // Initial state
  let price = params.initialPrice;
  let collateralTokens = params.initialCollateralTokens;

  const targetDebtRatio = 1 - ONE_HUNDRED_PERCENT_BPS / params.target; // proportion of debt to collateralBase
  let collateralBase = collateralTokens * price;
  let debtBase = collateralBase * targetDebtRatio;
  let debtTokens = debtBase; // debt token price = 1

  let cumulativeSubsidyBase = 0;
  let levSum = 0; // for mean leverage

  const dt = 1 / params.steps; // one step represents 1/steps of a year

  for (let i = 0; i < params.steps; i++) {
    // stochastic annual drift (interest rate) for this step
    const muStep = params.muMean + params.rateSigma * randomNormal();

    // price evolution via GBM with time-varying drift
    const z = randomNormal();
    price = price * Math.exp((muStep - 0.5 * params.sigma ** 2) * dt + params.sigma * Math.sqrt(dt) * z);

    collateralBase = collateralTokens * price;
    debtBase = debtTokens; // debt token pegged at 1

    const currentLevBps = leverageBps(collateralBase, debtBase);
    levSum += currentLevBps;

    if (currentLevBps > params.upper || currentLevBps < params.lower) {
      // Need rebalance
      const netAssetBase = collateralBase - debtBase;
      const deviationBps = Math.abs(currentLevBps - params.target);
      const rawSubsidy = (params.currentMult * (deviationBps * ONE_HUNDRED_PERCENT_BPS)) / params.target;
      const subsidyBps = Math.min(rawSubsidy, maxSubsidyBps);

      // Rebalancer will only act if net profit positive
      if (subsidyBps <= params.costBps) {
        // Skip rebalance, keep current state and continue simulation
        continue;
      }

      // Value lost as subsidy:
      // Assume we rebalance exactly back to target leverage.
      // Required debt/collateral change is |netAssetDiff| * (L-1)/L. For simplicity we approximate subsidyValue = subsidyBps * netAssetBase / 1e4
      const subsidyValueBase = (subsidyBps * netAssetBase) / ONE_HUNDRED_PERCENT_BPS;
      cumulativeSubsidyBase += subsidyValueBase;

      // New net asset after paying subsidy
      const netAssetAfter = netAssetBase - subsidyValueBase;
      if (netAssetAfter <= 0) {
        // Vault wiped out
        return { value: 0, meanLev: 0 };
      }

      // Recompute collateral & debt to hit target leverage again
      const targetLeverage = params.target / ONE_HUNDRED_PERCENT_BPS;
      const newCollateralBase = targetLeverage * netAssetAfter;
      const newDebtBase = newCollateralBase - netAssetAfter;

      collateralTokens = newCollateralBase / price;
      debtTokens = newDebtBase; // price =1

      // continue loop
    }
  }

  // Final value
  collateralBase = collateralTokens * price;
  debtBase = debtTokens;
  const finalValue = collateralBase - debtBase - cumulativeSubsidyBase;
  const meanLev = levSum / params.steps;
  return { value: finalValue, meanLev };
}

runOptimisation();
