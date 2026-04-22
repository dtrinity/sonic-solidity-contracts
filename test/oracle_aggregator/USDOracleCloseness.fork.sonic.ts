import { expect } from "chai";
import hre, { ethers } from "hardhat";

import usdOracleAggregatorDeployment from "../../deployments/sonic_mainnet/USD_OracleAggregator.json";
import { ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT } from "../../typescript/oracle_aggregator/constants";

const SONIC_RPC_URL = process.env.SONIC_RPC_URL || process.env.SONIC_MAINNET_RPC_URL;
const RATIO_PRECISION = 10_000n;
const MAX_DEVIATION_BPS = 100n;
const CHAINLINK_BASE_UNIT = 10n ** 8n;

const WS = "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38";
const FRXUSD = "0x80Eede496655FB9047dd39d9f418d5483ED600df";
const SFRXUSD = "0x5Bff88cA1442c2496f7E475E9e7786383Bc070c0";
const USDC_E = "0x29219dd400f2Bf60E5a23d13Be72B486D4038894";
const SCUSD = "0xd3DCe716f3eF535C5Ff8d041c1A41C3bd89b97aE";
const WETH = "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b";
const SCETH = "0x3bcE5CB273F0F148010BbEa2470e7b5df84C7812";
const STS = "0xE5DA20F15420aD15DE0fa650600aFc998bbE3955";
const WSTKSCETH = "0xE8a41c62BB4d5863C6eadC96792cFE90A1f37C47";
const PT_A_USDC = "0x930441Aa7Ab17654dF5663781CA0C02CC17e6643";
const PT_WSTKSCUSD = "0x0Fb682C9692AddCc1769f4D4d938c54420D54fA3";
const WOS = "0x9F0dF7799f6FDAd409300080cfF680f5A23df4b1";
const WSTKSCUSD = "0x9fb76f7ce5FCeAA2C42887ff441D46095E494206";

const WSTKSCUSD_RATE_PROVIDER = "0x13cCc810DfaA6B71957F2b87060aFE17e6EB8034";
const S_USD_FEED = "0xc76dFb89fF298145b417d221B2c747d84952e01d";
const FRXUSD_USD_FEED = "0xCa1371745467bAe4F9768aF689D50F55D1E75f8e";
const USDC_USD_FEED = "0x55bCa887199d5520B3Ce285D41e6dC10C08716C9";
const WETH_USD_FEED = "0x824364077993847f71293B24ccA8567c00c2de11";
const SFRXUSD_FRXUSD_FEED = "0xD2FB92548227143FDE27B37Aa71CfE4e35Bd478D";
const STS_S_SOURCE_FEED = "0xf97A2074fCCFDcD2FF567faEbfE235eCF0091c3D";
const WSTKSCETH_STKSCETH_FEED = "0xaA0eA5aa28dCB4280d0469167Bb8Bf99F51427D3";
const PT_A_USDC_USDC_FEED = "0xc65F6b9dBAFa2A9243CeceDbf80EE9a79d6ADf09";
const PT_WSTKSCUSD_SCUSD_FEED = "0x2EfEb81d6A0E5638bfe917C6cFCeb42989058d08";
const WOS_OS_FEED = "0x19E84B1f41d1Eb2ff22baC55797bD767558585De";
const OS_USD_COMPOSITE_FEED = "0xF6819756b86678dEd7A0aECD983697c4F7D42bbc";

const ORACLE_AGGREGATOR_ABI = [
  "function assetOracles(address asset) view returns (address)",
  "function getPriceInfo(address asset) view returns (uint256 price, bool isAlive)",
];

const ORACLE_WRAPPER_ABI = ["function getPriceInfo(address asset) view returns (uint256 price, bool isAlive)"];

const PRICE_FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

const LEGACY_COMPOSITE_ABI = [
  "function compositeFeeds(address asset) view returns (address feed1, address feed2, tuple(uint256 lowerThresholdInBase, uint256 fixedPriceInBase) primaryThreshold, tuple(uint256 lowerThresholdInBase, uint256 fixedPriceInBase) secondaryThreshold)",
];

const LEGACY_PLAIN_ABI = [
  "function assetToFeed(address asset) view returns (address)",
  "function assetThresholds(address asset) view returns (uint256 lowerThresholdInBase, uint256 fixedPriceInBase)",
];

const SAFE_RATE_PROVIDER_COMPOSITE_ABI = [
  "function compositeFeeds(address asset) view returns (address feed1, address rateProvider, uint256 rateProviderUnit, tuple(uint256 lowerThresholdInBase, uint256 fixedPriceInBase) primaryThreshold, tuple(uint256 lowerThresholdInBase, uint256 fixedPriceInBase) secondaryThreshold)",
];

const SAFE_RATE_PROVIDER_COMPOSITE_WITH_USD_ABI = [
  "function compositeFeeds(address asset) view returns (address feed1, address rateProvider, address feed3, uint256 rateProviderUnit, uint8 feed1Decimals, uint256 feed1Unit, uint8 feed3Decimals, uint256 feed3Unit, tuple(uint256 lowerThresholdInBase, uint256 fixedPriceInBase) primaryThreshold, tuple(uint256 lowerThresholdInBase, uint256 fixedPriceInBase) secondaryThreshold, tuple(uint256 lowerThresholdInBase, uint256 fixedPriceInBase) tertiaryThreshold)",
];

const RATE_PROVIDER_SAFE_ABI = ["function getRateSafe() view returns (uint256)"];

type SimpleCandidate = {
  label: string;
  asset: string;
  feed: string;
  lowerThreshold: bigint;
  fixedPrice: bigint;
};

type CompositeCandidate = {
  label: string;
  asset: string;
  feed1: string;
  feed2: string;
  lowerThresholdInBase1: bigint;
  fixedPriceInBase1: bigint;
  lowerThresholdInBase2: bigint;
  fixedPriceInBase2: bigint;
};

type ThresholdConfig = {
  lowerThresholdInBase: bigint;
  fixedPriceInBase: bigint;
};

type PriceReportRow = {
  asset: string;
  kind: string;
  currentOracle: string;
  currentPrice: bigint;
  candidatePrice: bigint;
  ratioBps: bigint;
  deviationBps: bigint;
  candidateFeeds: string;
};

const priceReportRows: PriceReportRow[] = [];

const SIMPLE_CANDIDATES: SimpleCandidate[] = [
  {
    label: "wS",
    asset: WS,
    feed: S_USD_FEED,
    lowerThreshold: 0n,
    fixedPrice: 0n,
  },
  {
    label: "frxUSD",
    asset: FRXUSD,
    feed: FRXUSD_USD_FEED,
    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  },
  {
    label: "USDCe",
    asset: USDC_E,
    feed: USDC_USD_FEED,
    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  },
  {
    label: "scUSD",
    asset: SCUSD,
    feed: USDC_USD_FEED,
    lowerThreshold: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    fixedPrice: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  },
  {
    label: "WETH",
    asset: WETH,
    feed: WETH_USD_FEED,
    lowerThreshold: 0n,
    fixedPrice: 0n,
  },
  {
    label: "scETH",
    asset: SCETH,
    feed: WETH_USD_FEED,
    lowerThreshold: 0n,
    fixedPrice: 0n,
  },
];

const COMPOSITE_CANDIDATES: CompositeCandidate[] = [
  {
    label: "sfrxUSD",
    asset: SFRXUSD,
    feed1: SFRXUSD_FRXUSD_FEED,
    feed2: FRXUSD_USD_FEED,
    lowerThresholdInBase1: 0n,
    fixedPriceInBase1: 0n,
    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  },
  {
    label: "stS",
    asset: STS,
    feed1: STS_S_SOURCE_FEED,
    feed2: S_USD_FEED,
    lowerThresholdInBase1: 0n,
    fixedPriceInBase1: 0n,
    lowerThresholdInBase2: 0n,
    fixedPriceInBase2: 0n,
  },
  {
    label: "wstkscETH",
    asset: WSTKSCETH,
    feed1: WSTKSCETH_STKSCETH_FEED,
    feed2: WETH_USD_FEED,
    lowerThresholdInBase1: 0n,
    fixedPriceInBase1: 0n,
    lowerThresholdInBase2: 0n,
    fixedPriceInBase2: 0n,
  },
  {
    label: "PTaUSDC",
    asset: PT_A_USDC,
    feed1: PT_A_USDC_USDC_FEED,
    feed2: USDC_USD_FEED,
    lowerThresholdInBase1: 0n,
    fixedPriceInBase1: 0n,
    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  },
  {
    label: "PTwstkscUSD",
    asset: PT_WSTKSCUSD,
    feed1: PT_WSTKSCUSD_SCUSD_FEED,
    feed2: USDC_USD_FEED,
    lowerThresholdInBase1: 0n,
    fixedPriceInBase1: 0n,
    lowerThresholdInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    fixedPriceInBase2: ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  },
];

const DECIMAL_ONLY_COMPOSITE_CANDIDATES: CompositeCandidate[] = [
  {
    label: "wOS",
    asset: WOS,
    feed1: WOS_OS_FEED,
    feed2: OS_USD_COMPOSITE_FEED,
    lowerThresholdInBase1: 0n,
    fixedPriceInBase1: 0n,
    lowerThresholdInBase2: 0n,
    fixedPriceInBase2: 0n,
  },
];

function applyThreshold(price: bigint, threshold: ThresholdConfig): bigint {
  if (threshold.lowerThresholdInBase > 0n && price > threshold.lowerThresholdInBase) {
    return threshold.fixedPriceInBase;
  }

  return price;
}

function expectCloseEnough(candidatePrice: bigint, currentPrice: bigint): void {
  const ratio = (candidatePrice * RATIO_PRECISION) / currentPrice;
  const deviation = ratio > RATIO_PRECISION ? ratio - RATIO_PRECISION : RATIO_PRECISION - ratio;

  expect(deviation, `candidate=${candidatePrice}, current=${currentPrice}, ratio=${ratio}, deviationBps=${deviation}`).to.be.lte(
    MAX_DEVIATION_BPS,
  );
}

function calculateRatio(candidatePrice: bigint, currentPrice: bigint): { ratioBps: bigint; deviationBps: bigint } {
  const ratioBps = (candidatePrice * RATIO_PRECISION) / currentPrice;
  const deviationBps = ratioBps > RATIO_PRECISION ? ratioBps - RATIO_PRECISION : RATIO_PRECISION - ratioBps;

  return { ratioBps, deviationBps };
}

function formatBasePrice(price: bigint): string {
  const whole = price / ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;
  const fraction = price % ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;
  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");

  return fractionText.length > 0 ? `${whole}.${fractionText}` : whole.toString();
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function pushPriceReportRow(row: Omit<PriceReportRow, "ratioBps" | "deviationBps">): void {
  const { ratioBps, deviationBps } = calculateRatio(row.candidatePrice, row.currentPrice);

  priceReportRows.push({
    ...row,
    ratioBps,
    deviationBps,
  });
}

function printPriceReport(): void {
  if (priceReportRows.length === 0) {
    return;
  }

  const sortedRows = [...priceReportRows].sort((a, b) => a.asset.localeCompare(b.asset));

  console.log("\n### USD Oracle Migration Price Report");
  console.log(
    "| Asset | Candidate path | Current oracle | Current price | Candidate price | Ratio bps | Deviation bps | Candidate feeds |",
  );
  console.log("| --- | --- | --- | ---: | ---: | ---: | ---: | --- |");

  for (const row of sortedRows) {
    console.log(
      `| ${row.asset} | ${row.kind} | ${shortAddress(row.currentOracle)} | ${formatBasePrice(row.currentPrice)} | ${formatBasePrice(row.candidatePrice)} | ${row.ratioBps} | ${row.deviationBps} | ${row.candidateFeeds} |`,
    );
  }
}

async function readPositiveChainlinkPrice(feedAddress: string): Promise<{ price: bigint; decimals: bigint; updatedAt: bigint }> {
  const feed = await ethers.getContractAt(PRICE_FEED_ABI, feedAddress);
  const decimals = BigInt(await feed.decimals());
  const roundData = await feed.latestRoundData();
  const answer = BigInt(roundData.answer ?? roundData[1]);
  const updatedAt = BigInt(roundData.updatedAt ?? roundData[3]);

  expect(answer, `feed ${feedAddress} returned non-positive answer`).to.be.gt(0n);
  expect(decimals, `feed ${feedAddress} returned zero decimals`).to.be.gt(0n);

  return { price: answer, decimals, updatedAt };
}

async function expectFeedDecimals(feedAddress: string, expectedDecimals: bigint, label: string): Promise<void> {
  const feed = await ethers.getContractAt(PRICE_FEED_ABI, feedAddress);
  const decimals = BigInt(await feed.decimals());

  expect(decimals, `${label} feed ${feedAddress} decimals`).to.equal(expectedDecimals);
}

async function expectSupportedFeedDecimals(feedAddress: string, label: string): Promise<void> {
  const feed = await ethers.getContractAt(PRICE_FEED_ABI, feedAddress);
  const decimals = BigInt(await feed.decimals());

  expect(decimals, `${label} feed ${feedAddress} decimals`).to.be.gt(0n);
  expect(decimals, `${label} feed ${feedAddress} decimals`).to.be.lte(36n);
}

async function readLegacyOraclePriceFromOnchainFeeds(oracleAddress: string, asset: string): Promise<bigint> {
  const legacyComposite = await ethers.getContractAt(LEGACY_COMPOSITE_ABI, oracleAddress);

  try {
    const composite = await legacyComposite.compositeFeeds(asset);

    if (composite.feed1 !== ethers.ZeroAddress && composite.feed2 !== ethers.ZeroAddress) {
      const feed1 = await readPositiveChainlinkPrice(composite.feed1);
      const feed2 = await readPositiveChainlinkPrice(composite.feed2);

      expect(feed1.decimals, `current legacy composite feed1 ${composite.feed1} must be 8 decimals`).to.equal(8n);
      expect(feed2.decimals, `current legacy composite feed2 ${composite.feed2} must be 8 decimals`).to.equal(8n);

      let price1 = (feed1.price * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / CHAINLINK_BASE_UNIT;
      let price2 = (feed2.price * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / CHAINLINK_BASE_UNIT;

      price1 = applyThreshold(price1, composite.primaryThreshold);
      price2 = applyThreshold(price2, composite.secondaryThreshold);

      console.log(`Current composite oracle: ${oracleAddress}`);
      console.log(`  feed1=${composite.feed1}, answer=${feed1.price}, decimals=${feed1.decimals}, updatedAt=${feed1.updatedAt}`);
      console.log(`  feed2=${composite.feed2}, answer=${feed2.price}, decimals=${feed2.decimals}, updatedAt=${feed2.updatedAt}`);

      return (price1 * price2) / ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;
    }
  } catch (_error) {
    // Fall through to other supported oracle wrapper shapes.
  }

  const safeCompositeWithUsd = await ethers.getContractAt(SAFE_RATE_PROVIDER_COMPOSITE_WITH_USD_ABI, oracleAddress);

  try {
    const composite = await safeCompositeWithUsd.compositeFeeds(asset);

    if (composite.feed1 !== ethers.ZeroAddress && composite.rateProvider !== ethers.ZeroAddress && composite.feed3 !== ethers.ZeroAddress) {
      const feed1 = await readPositiveChainlinkPrice(composite.feed1);
      const feed3 = await readPositiveChainlinkPrice(composite.feed3);
      const rateProvider = await ethers.getContractAt(RATE_PROVIDER_SAFE_ABI, composite.rateProvider);
      const rate = BigInt(await rateProvider.getRateSafe());

      expect(feed1.decimals, `current safe-rate-provider USD feed1 ${composite.feed1} decimals`).to.equal(BigInt(composite.feed1Decimals));
      expect(feed3.decimals, `current safe-rate-provider USD feed3 ${composite.feed3} decimals`).to.equal(BigInt(composite.feed3Decimals));
      expect(rate, `rate provider ${composite.rateProvider} returned zero rate`).to.be.gt(0n);

      let price1 = (feed1.price * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / BigInt(composite.feed1Unit);
      let price2 = (rate * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / BigInt(composite.rateProviderUnit);
      let price3 = (feed3.price * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / BigInt(composite.feed3Unit);

      price1 = applyThreshold(price1, composite.primaryThreshold);
      price2 = applyThreshold(price2, composite.secondaryThreshold);
      price3 = applyThreshold(price3, composite.tertiaryThreshold);

      console.log(`Current safe-rate-provider USD oracle: ${oracleAddress}`);
      console.log(`  feed1=${composite.feed1}, answer=${feed1.price}, decimals=${feed1.decimals}, updatedAt=${feed1.updatedAt}`);
      console.log(`  rateProvider=${composite.rateProvider}, rate=${rate}`);
      console.log(`  feed3=${composite.feed3}, answer=${feed3.price}, decimals=${feed3.decimals}, updatedAt=${feed3.updatedAt}`);

      return (((price1 * price2) / ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) * price3) / ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;
    }
  } catch (_error) {
    // Fall through to two-leg safe-rate-provider wrappers.
  }

  const safeComposite = await ethers.getContractAt(SAFE_RATE_PROVIDER_COMPOSITE_ABI, oracleAddress);

  try {
    const composite = await safeComposite.compositeFeeds(asset);

    if (composite.feed1 !== ethers.ZeroAddress && composite.rateProvider !== ethers.ZeroAddress) {
      const feed = await readPositiveChainlinkPrice(composite.feed1);
      const rateProvider = await ethers.getContractAt(RATE_PROVIDER_SAFE_ABI, composite.rateProvider);
      const rate = BigInt(await rateProvider.getRateSafe());

      expect(rate, `rate provider ${composite.rateProvider} returned zero rate`).to.be.gt(0n);
      expect(feed.decimals, `current safe-rate-provider feed1 ${composite.feed1} must be 8 decimals`).to.equal(8n);

      let price1 = (feed.price * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / 10n ** feed.decimals;
      let price2 = (rate * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / BigInt(composite.rateProviderUnit);

      price1 = applyThreshold(price1, composite.primaryThreshold);
      price2 = applyThreshold(price2, composite.secondaryThreshold);

      console.log(`Current safe-rate-provider oracle: ${oracleAddress}`);
      console.log(`  feed1=${composite.feed1}, answer=${feed.price}, decimals=${feed.decimals}, updatedAt=${feed.updatedAt}`);
      console.log(`  rateProvider=${composite.rateProvider}, rate=${rate}`);

      return (price1 * price2) / ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT;
    }
  } catch (_error) {
    // Fall through to plain feed wrappers.
  }

  const plain = await ethers.getContractAt(LEGACY_PLAIN_ABI, oracleAddress);

  try {
    const feedAddress = await plain.assetToFeed(asset);

    if (feedAddress !== ethers.ZeroAddress) {
      const feed = await readPositiveChainlinkPrice(feedAddress);
      expect(feed.decimals, `current plain wrapper feed ${feedAddress} must be 8 decimals`).to.equal(8n);
      let price = (feed.price * ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT) / CHAINLINK_BASE_UNIT;

      try {
        price = applyThreshold(price, await plain.assetThresholds(asset));
      } catch (_error) {
        // Some plain wrappers do not expose threshold config.
      }

      console.log(`Current plain oracle: ${oracleAddress}`);
      console.log(`  feed=${feedAddress}, answer=${feed.price}, decimals=${feed.decimals}, updatedAt=${feed.updatedAt}`);

      return price;
    }
  } catch (_error) {
    // Throw a clear error below.
  }

  throw new Error(`Unsupported current USD oracle shape for asset ${asset}: ${oracleAddress}`);
}

async function readCurrentOraclePriceFromOnchainFeeds(
  oracleAggregator: any,
  label: string,
  asset: string,
): Promise<{ oracleAddress: string; price: bigint }> {
  const currentOracleAddress = await oracleAggregator.assetOracles(asset);

  expect(currentOracleAddress, `${label} current oracle must be configured on USD_OracleAggregator`).to.not.equal(ethers.ZeroAddress);

  const currentOracle = await ethers.getContractAt(ORACLE_WRAPPER_ABI, currentOracleAddress);
  const currentInfo = await currentOracle.getPriceInfo(asset);
  const currentPrice = BigInt(currentInfo.price ?? currentInfo[0]);
  const currentAlive = Boolean(currentInfo.isAlive ?? currentInfo[1]);

  expect(currentAlive, `${label} current oracle should be alive`).to.equal(true);
  expect(currentPrice, `${label} current oracle should return a positive price`).to.be.gt(0n);

  const priceFromOnchainFeeds = await readLegacyOraclePriceFromOnchainFeeds(currentOracleAddress, asset);
  expect(priceFromOnchainFeeds, `${label} recomputed on-chain feed price should match current oracle price`).to.equal(currentPrice);

  return { oracleAddress: currentOracleAddress, price: currentPrice };
}

async function readSimpleCandidatePrice(candidate: SimpleCandidate): Promise<bigint> {
  const wrapper = await ethers.deployContract("ChainlinkWrapperWithThresholding", [
    ethers.ZeroAddress,
    ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  ]);
  await wrapper.waitForDeployment();

  await wrapper.setFeed(candidate.asset, candidate.feed);
  await wrapper.setThresholdConfig(candidate.asset, candidate.lowerThreshold, candidate.fixedPrice);

  const priceInfo = await wrapper.getPriceInfo(candidate.asset);
  const price = BigInt(priceInfo.price ?? priceInfo[0]);
  const alive = Boolean(priceInfo.isAlive ?? priceInfo[1]);

  expect(alive, `${candidate.label} candidate oracle should be alive`).to.equal(true);
  expect(price, `${candidate.label} candidate oracle should return a positive price`).to.be.gt(0n);

  return price;
}

async function readFeedDecimalsForReport(feedAddress: string): Promise<string> {
  const feed = await ethers.getContractAt(PRICE_FEED_ABI, feedAddress);
  return (await feed.decimals()).toString();
}

async function describeSimpleCandidateFeeds(candidate: SimpleCandidate): Promise<string> {
  const decimals = await readFeedDecimalsForReport(candidate.feed);
  return `feed=${shortAddress(candidate.feed)} (${decimals}d)`;
}

async function readCompositeCandidatePrice(candidate: CompositeCandidate): Promise<{ price: bigint; feed1: string }> {
  const wrapper = await ethers.deployContract("ChainlinkWrapperWithThresholding", [
    ethers.ZeroAddress,
    ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
  ]);
  await wrapper.waitForDeployment();

  await wrapper.addCompositeFeed(
    candidate.asset,
    candidate.feed1,
    candidate.feed2,
    candidate.lowerThresholdInBase1,
    candidate.fixedPriceInBase1,
    candidate.lowerThresholdInBase2,
    candidate.fixedPriceInBase2,
  );

  const priceInfo = await wrapper.getPriceInfo(candidate.asset);
  const price = BigInt(priceInfo.price ?? priceInfo[0]);
  const alive = Boolean(priceInfo.isAlive ?? priceInfo[1]);

  expect(alive, `${candidate.label} candidate oracle should be alive`).to.equal(true);
  expect(price, `${candidate.label} candidate oracle should return a positive price`).to.be.gt(0n);

  return { price, feed1: candidate.feed1 };
}

async function getEffectiveCompositeFeed1(candidate: CompositeCandidate): Promise<string> {
  return candidate.feed1;
}

async function describeCompositeCandidateFeeds(candidate: CompositeCandidate, effectiveFeed1: string): Promise<string> {
  const feed1Decimals = await readFeedDecimalsForReport(effectiveFeed1);
  const feed2Decimals = await readFeedDecimalsForReport(candidate.feed2);
  const feed1Label = `${shortAddress(effectiveFeed1)} (${feed1Decimals}d)`;

  return `feed1=${feed1Label}; feed2=${shortAddress(candidate.feed2)} (${feed2Decimals}d)`;
}

async function describeWstkscUSDCandidateFeeds(): Promise<string> {
  const thirdFeedDecimals = await readFeedDecimalsForReport(USDC_USD_FEED);
  return `vault=${shortAddress(WSTKSCUSD)}; rateProvider=${shortAddress(WSTKSCUSD_RATE_PROVIDER)}; thirdFeed=${shortAddress(USDC_USD_FEED)} (${thirdFeedDecimals}d)`;
}

describe("USD oracle closeness on Sonic fork", () => {
  before(async function () {
    if (!SONIC_RPC_URL) {
      this.skip();
      return;
    }

    this.timeout(120000);

    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: SONIC_RPC_URL,
          },
        },
      ],
    });
  });

  after(function () {
    printPriceReport();
  });

  it("validates every candidate feed has supported decimals for its wrapper path", async function () {
    this.timeout(120000);

    for (const candidate of SIMPLE_CANDIDATES) {
      await expectSupportedFeedDecimals(candidate.feed, `${candidate.label} simple candidate`);
    }

    for (const candidate of COMPOSITE_CANDIDATES) {
      const feed1 = await getEffectiveCompositeFeed1(candidate);
      await expectSupportedFeedDecimals(feed1, `${candidate.label} Chainlink composite candidate feed1`);
      await expectSupportedFeedDecimals(candidate.feed2, `${candidate.label} Chainlink composite candidate feed2`);
    }

    for (const candidate of DECIMAL_ONLY_COMPOSITE_CANDIDATES) {
      await expectFeedDecimals(candidate.feed1, 8n, `${candidate.label} legacy composite candidate feed1`);
      await expectFeedDecimals(candidate.feed2, 8n, `${candidate.label} legacy composite candidate feed2`);
    }
  });

  for (const candidate of SIMPLE_CANDIDATES) {
    it(`compares ${candidate.label} candidate simple oracle against the current on-chain USD oracle feeds`, async function () {
      this.timeout(120000);

      const oracleAggregator = await ethers.getContractAt(ORACLE_AGGREGATOR_ABI, usdOracleAggregatorDeployment.address);
      const current = await readCurrentOraclePriceFromOnchainFeeds(oracleAggregator, candidate.label, candidate.asset);
      const candidatePrice = await readSimpleCandidatePrice(candidate);

      console.log(`${candidate.label} current oracle=${current.oracleAddress}`);
      console.log(`${candidate.label} current oracle price=${current.price}`);
      console.log(`${candidate.label} candidate oracle price=${candidatePrice}`);

      pushPriceReportRow({
        asset: candidate.label,
        kind: "simple",
        currentOracle: current.oracleAddress,
        currentPrice: current.price,
        candidatePrice,
        candidateFeeds: await describeSimpleCandidateFeeds(candidate),
      });

      expectCloseEnough(candidatePrice, current.price);
    });
  }

  for (const candidate of COMPOSITE_CANDIDATES) {
    it(`compares ${candidate.label} candidate composite oracle against the current on-chain USD oracle feeds`, async function () {
      this.timeout(120000);

      const oracleAggregator = await ethers.getContractAt(ORACLE_AGGREGATOR_ABI, usdOracleAggregatorDeployment.address);
      const current = await readCurrentOraclePriceFromOnchainFeeds(oracleAggregator, candidate.label, candidate.asset);
      const candidateResult = await readCompositeCandidatePrice(candidate);
      const candidatePrice = candidateResult.price;

      console.log(`${candidate.label} current oracle=${current.oracleAddress}`);
      console.log(`${candidate.label} current oracle price=${current.price}`);
      console.log(`${candidate.label} candidate oracle price=${candidatePrice}`);

      pushPriceReportRow({
        asset: candidate.label,
        kind: "composite",
        currentOracle: current.oracleAddress,
        currentPrice: current.price,
        candidatePrice,
        candidateFeeds: await describeCompositeCandidateFeeds(candidate, candidateResult.feed1),
      });

      expectCloseEnough(candidatePrice, current.price);
    });
  }

  it("compares wstkscUSD candidate oracle against the current on-chain USD oracle feeds", async function () {
    this.timeout(120000);

    const oracleAggregator = await ethers.getContractAt(ORACLE_AGGREGATOR_ABI, usdOracleAggregatorDeployment.address);
    const current = await readCurrentOraclePriceFromOnchainFeeds(oracleAggregator, "wstkscUSD", WSTKSCUSD);

    const candidateWrapper = await ethers.deployContract("ERC4626RateProviderThirdFeedWrapperWithThresholding", [
      ethers.ZeroAddress,
      ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    ]);
    await candidateWrapper.waitForDeployment();

    await candidateWrapper.setFeed(
      WSTKSCUSD,
      WSTKSCUSD,
      WSTKSCUSD_RATE_PROVIDER,
      USDC_USD_FEED,
      0,
      0,
      ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
      ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
      ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
      ORACLE_AGGREGATOR_BASE_CURRENCY_UNIT,
    );

    const candidateInfo = await candidateWrapper.getPriceInfo(WSTKSCUSD);
    const candidatePrice = BigInt(candidateInfo.price ?? candidateInfo[0]);
    const candidateAlive = Boolean(candidateInfo.isAlive ?? candidateInfo[1]);

    expect(candidateAlive, "candidate wstkscUSD oracle should be alive").to.equal(true);
    expect(candidatePrice, "candidate wstkscUSD oracle should return a positive price").to.be.gt(0n);

    console.log(`wstkscUSD current oracle=${current.oracleAddress}`);
    console.log(`wstkscUSD current oracle price=${current.price}`);
    console.log(`wstkscUSD candidate oracle price=${candidatePrice}`);

    pushPriceReportRow({
      asset: "wstkscUSD",
      kind: "ERC4626/rate/third-feed",
      currentOracle: current.oracleAddress,
      currentPrice: current.price,
      candidatePrice,
      candidateFeeds: await describeWstkscUSDCandidateFeeds(),
    });

    expectCloseEnough(candidatePrice, current.price);
  });
});
