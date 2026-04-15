import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BaseContract, ethers } from "ethers";
import hre from "hardhat";

import { OracleAggregatorConfig } from "../../config/types";
import {
  API3CompositeWrapperWithThresholding,
  API3Wrapper,
  API3WrapperWithThresholding,
  MockAPI3Oracle,
  MockAPI3ServerV1,
  MockChainlinkAggregatorV3,
  OracleAggregator,
  RedstoneChainlinkCompositeWrapperWithThresholding,
  RedstoneChainlinkWrapper,
  RedstoneChainlinkWrapperWithThresholding,
} from "../../typechain-types";
import {
  applyApi3RoutingPlan,
  applyApi3SetupPlan,
  applyRedstoneRoutingPlan,
  applyRedstoneSetupPlan,
  buildUsdOracleRoutingPlan,
  buildUsdOracleSetupPlan,
} from "../../typescript/oracle_aggregator/deploy-helpers";

const BASE_CURRENCY = ethers.ZeroAddress;
const BASE_CURRENCY_UNIT = ethers.parseUnits("1", 18);

describe("USD oracle deploy helpers", () => {
  it("sets wrapper state, routes assets by feedAsset, and remains idempotent", async () => {
    const fixture = await loadFixture(deployUsdOracleScriptFixture);
    const setupPlan = buildUsdOracleSetupPlan(fixture.config);
    const routingPlan = buildUsdOracleRoutingPlan(fixture.config);

    expect(routingPlan.api3.map((entry) => entry.asset)).to.deep.equal([
      fixture.assets.api3Plain,
      fixture.assets.api3Threshold,
      fixture.assets.api3CompositeFeedAsset,
    ]);
    expect(routingPlan.redstone.map((entry) => entry.asset)).to.deep.equal([
      fixture.assets.redstonePlain,
      fixture.assets.redstoneThreshold,
      fixture.assets.redstoneCompositeFeedAsset,
    ]);

    const api3SetupResult = await applyApi3SetupPlan(
      setupPlan.api3,
      {
        plainWrapper: fixture.contracts.api3Wrapper,
        thresholdWrapper: fixture.contracts.api3ThresholdWrapper,
        compositeWrapper: fixture.contracts.api3CompositeWrapper,
      },
      BASE_CURRENCY_UNIT,
    );
    const redstoneSetupResult = await applyRedstoneSetupPlan(
      setupPlan.redstone,
      {
        plainWrapper: fixture.contracts.redstoneWrapper,
        thresholdWrapper: fixture.contracts.redstoneThresholdWrapper,
        compositeWrapper: fixture.contracts.redstoneCompositeWrapper,
      },
      BASE_CURRENCY_UNIT,
    );

    expect(api3SetupResult.writes).to.equal(4);
    expect(redstoneSetupResult.writes).to.equal(4);

    await expectApi3SetupState(fixture);
    await expectRedstoneSetupState(fixture);

    const api3RoutingResult = await applyApi3RoutingPlan(routingPlan.api3, fixture.contracts.oracleAggregator, {
      plainWrapper: await fixture.contracts.api3Wrapper.getAddress(),
      thresholdWrapper: await fixture.contracts.api3ThresholdWrapper.getAddress(),
      compositeWrapper: await fixture.contracts.api3CompositeWrapper.getAddress(),
    });
    const redstoneRoutingResult = await applyRedstoneRoutingPlan(routingPlan.redstone, fixture.contracts.oracleAggregator, {
      plainWrapper: await fixture.contracts.redstoneWrapper.getAddress(),
      thresholdWrapper: await fixture.contracts.redstoneThresholdWrapper.getAddress(),
      compositeWrapper: await fixture.contracts.redstoneCompositeWrapper.getAddress(),
    });

    expect(api3RoutingResult.writes).to.equal(3);
    expect(redstoneRoutingResult.writes).to.equal(3);

    await expectAggregatorRoutingState(fixture);

    const setupSnapshot = await snapshotWrapperAndAggregatorState(fixture);

    const secondApi3SetupResult = await applyApi3SetupPlan(
      setupPlan.api3,
      {
        plainWrapper: fixture.contracts.api3Wrapper,
        thresholdWrapper: fixture.contracts.api3ThresholdWrapper,
        compositeWrapper: fixture.contracts.api3CompositeWrapper,
      },
      BASE_CURRENCY_UNIT,
    );
    const secondRedstoneSetupResult = await applyRedstoneSetupPlan(
      setupPlan.redstone,
      {
        plainWrapper: fixture.contracts.redstoneWrapper,
        thresholdWrapper: fixture.contracts.redstoneThresholdWrapper,
        compositeWrapper: fixture.contracts.redstoneCompositeWrapper,
      },
      BASE_CURRENCY_UNIT,
    );
    const secondApi3RoutingResult = await applyApi3RoutingPlan(routingPlan.api3, fixture.contracts.oracleAggregator, {
      plainWrapper: await fixture.contracts.api3Wrapper.getAddress(),
      thresholdWrapper: await fixture.contracts.api3ThresholdWrapper.getAddress(),
      compositeWrapper: await fixture.contracts.api3CompositeWrapper.getAddress(),
    });
    const secondRedstoneRoutingResult = await applyRedstoneRoutingPlan(routingPlan.redstone, fixture.contracts.oracleAggregator, {
      plainWrapper: await fixture.contracts.redstoneWrapper.getAddress(),
      thresholdWrapper: await fixture.contracts.redstoneThresholdWrapper.getAddress(),
      compositeWrapper: await fixture.contracts.redstoneCompositeWrapper.getAddress(),
    });

    expect(secondApi3SetupResult.writes).to.equal(0);
    expect(secondRedstoneSetupResult.writes).to.equal(0);
    expect(secondApi3RoutingResult.writes).to.equal(0);
    expect(secondRedstoneRoutingResult.writes).to.equal(0);

    const idempotentSnapshot = await snapshotWrapperAndAggregatorState(fixture);
    expect(idempotentSnapshot).to.deep.equal(setupSnapshot);
  });

  it("fails fast on duplicated bucket placement", async () => {
    const fixture = await loadFixture(deployUsdOracleScriptFixture);

    const malformedConfig: OracleAggregatorConfig = {
      ...fixture.config,
      redstoneOracleAssets: {
        ...fixture.config.redstoneOracleAssets,
        plainRedstoneOracleWrappers: {
          ...fixture.config.redstoneOracleAssets.plainRedstoneOracleWrappers,
          [fixture.assets.api3Plain]: await fixture.mocks.redstonePlainFeed.getAddress(),
        },
      },
    };

    expect(() => buildUsdOracleSetupPlan(malformedConfig)).to.throw(
      `Asset ${fixture.assets.api3Plain} is configured in multiple oracle buckets: api3.plain, redstone.plain`,
    );
  });

  it("fails fast on zero-address feeds and proxies", async () => {
    const fixture = await loadFixture(deployUsdOracleScriptFixture);

    const malformedConfig: OracleAggregatorConfig = {
      ...fixture.config,
      api3OracleAssets: {
        ...fixture.config.api3OracleAssets,
        api3OracleWrappersWithThresholding: {
          ...fixture.config.api3OracleAssets.api3OracleWrappersWithThresholding,
          [fixture.assets.api3Threshold]: {
            ...fixture.config.api3OracleAssets.api3OracleWrappersWithThresholding[fixture.assets.api3Threshold],
            proxy: ethers.ZeroAddress,
          },
        },
      },
    };

    expect(() => buildUsdOracleSetupPlan(malformedConfig)).to.throw(
      `Zero address is not allowed for api3.threshold[${fixture.assets.api3Threshold}] proxy`,
    );
  });
});

async function deployUsdOracleScriptFixture() {
  const assets = {
    api3Plain: randomAddress(),
    api3Threshold: randomAddress(),
    api3CompositeConfigKey: randomAddress(),
    api3CompositeFeedAsset: randomAddress(),
    redstonePlain: randomAddress(),
    redstoneThreshold: randomAddress(),
    redstoneCompositeConfigKey: randomAddress(),
    redstoneCompositeFeedAsset: randomAddress(),
  };

  const api3Server = await deploy<MockAPI3ServerV1>("MockAPI3ServerV1");
  const api3PlainProxy = await deploy<MockAPI3Oracle>("MockAPI3Oracle", [await api3Server.getAddress()]);
  const api3ThresholdProxy = await deploy<MockAPI3Oracle>("MockAPI3Oracle", [await api3Server.getAddress()]);
  const api3CompositeProxy1 = await deploy<MockAPI3Oracle>("MockAPI3Oracle", [await api3Server.getAddress()]);
  const api3CompositeProxy2 = await deploy<MockAPI3Oracle>("MockAPI3Oracle", [await api3Server.getAddress()]);

  const now = Number(await time.latest());
  await api3PlainProxy.setMock(ethers.parseUnits("1.11", 18), now);
  await api3ThresholdProxy.setMock(ethers.parseUnits("1.02", 18), now);
  await api3CompositeProxy1.setMock(ethers.parseUnits("1.05", 18), now);
  await api3CompositeProxy2.setMock(ethers.parseUnits("1.00", 18), now);

  const redstonePlainFeed = await deploy<MockChainlinkAggregatorV3>("MockChainlinkAggregatorV3", [8, "plain"]);
  const redstoneThresholdFeed = await deploy<MockChainlinkAggregatorV3>("MockChainlinkAggregatorV3", [8, "threshold"]);
  const redstoneCompositeFeed1 = await deploy<MockChainlinkAggregatorV3>("MockChainlinkAggregatorV3", [8, "composite-1"]);
  const redstoneCompositeFeed2 = await deploy<MockChainlinkAggregatorV3>("MockChainlinkAggregatorV3", [8, "composite-2"]);

  await redstonePlainFeed.setMock(ethers.parseUnits("1.09", 8));
  await redstoneThresholdFeed.setMock(ethers.parseUnits("1.01", 8));
  await redstoneCompositeFeed1.setMock(ethers.parseUnits("1.04", 8));
  await redstoneCompositeFeed2.setMock(ethers.parseUnits("1.00", 8));

  const oracleAggregator = await deploy<OracleAggregator>("OracleAggregator", [BASE_CURRENCY, BASE_CURRENCY_UNIT]);
  const api3Wrapper = await deploy<API3Wrapper>("API3Wrapper", [BASE_CURRENCY, BASE_CURRENCY_UNIT]);
  const api3ThresholdWrapper = await deploy<API3WrapperWithThresholding>("API3WrapperWithThresholding", [
    BASE_CURRENCY,
    BASE_CURRENCY_UNIT,
  ]);
  const api3CompositeWrapper = await deploy<API3CompositeWrapperWithThresholding>("API3CompositeWrapperWithThresholding", [
    BASE_CURRENCY,
    BASE_CURRENCY_UNIT,
  ]);
  const redstoneWrapper = await deploy<RedstoneChainlinkWrapper>("RedstoneChainlinkWrapper", [BASE_CURRENCY, BASE_CURRENCY_UNIT]);
  const redstoneThresholdWrapper = await deploy<RedstoneChainlinkWrapperWithThresholding>("RedstoneChainlinkWrapperWithThresholding", [
    BASE_CURRENCY,
    BASE_CURRENCY_UNIT,
  ]);
  const redstoneCompositeWrapper = await deploy<RedstoneChainlinkCompositeWrapperWithThresholding>(
    "RedstoneChainlinkCompositeWrapperWithThresholding",
    [BASE_CURRENCY, BASE_CURRENCY_UNIT],
  );

  const config: OracleAggregatorConfig = {
    priceDecimals: 18,
    hardDStablePeg: BASE_CURRENCY_UNIT,
    baseCurrency: BASE_CURRENCY,
    api3OracleAssets: {
      plainApi3OracleWrappers: {
        [assets.api3Plain]: await api3PlainProxy.getAddress(),
      },
      api3OracleWrappersWithThresholding: {
        [assets.api3Threshold]: {
          proxy: await api3ThresholdProxy.getAddress(),
          lowerThreshold: ethers.parseUnits("1.00", 18),
          fixedPrice: ethers.parseUnits("1.00", 18),
        },
      },
      compositeApi3OracleWrappersWithThresholding: {
        [assets.api3CompositeConfigKey]: {
          feedAsset: assets.api3CompositeFeedAsset,
          proxy1: await api3CompositeProxy1.getAddress(),
          proxy2: await api3CompositeProxy2.getAddress(),
          lowerThresholdInBase1: ethers.parseUnits("1.00", 18),
          fixedPriceInBase1: ethers.parseUnits("1.00", 18),
          lowerThresholdInBase2: 0n,
          fixedPriceInBase2: 0n,
        },
      },
    },
    redstoneOracleAssets: {
      plainRedstoneOracleWrappers: {
        [assets.redstonePlain]: await redstonePlainFeed.getAddress(),
      },
      redstoneOracleWrappersWithThresholding: {
        [assets.redstoneThreshold]: {
          feed: await redstoneThresholdFeed.getAddress(),
          lowerThreshold: ethers.parseUnits("1.00", 18),
          fixedPrice: ethers.parseUnits("1.00", 18),
        },
      },
      compositeRedstoneOracleWrappersWithThresholding: {
        [assets.redstoneCompositeConfigKey]: {
          feedAsset: assets.redstoneCompositeFeedAsset,
          feed1: await redstoneCompositeFeed1.getAddress(),
          feed2: await redstoneCompositeFeed2.getAddress(),
          lowerThresholdInBase1: ethers.parseUnits("1.00", 18),
          fixedPriceInBase1: ethers.parseUnits("1.00", 18),
          lowerThresholdInBase2: 0n,
          fixedPriceInBase2: 0n,
        },
      },
    },
  };

  return {
    assets,
    config,
    contracts: {
      oracleAggregator,
      api3Wrapper,
      api3ThresholdWrapper,
      api3CompositeWrapper,
      redstoneWrapper,
      redstoneThresholdWrapper,
      redstoneCompositeWrapper,
    },
    mocks: {
      api3PlainProxy,
      api3ThresholdProxy,
      api3CompositeProxy1,
      api3CompositeProxy2,
      redstonePlainFeed,
      redstoneThresholdFeed,
      redstoneCompositeFeed1,
      redstoneCompositeFeed2,
    },
  };
}

async function expectApi3SetupState(fixture: Awaited<ReturnType<typeof deployUsdOracleScriptFixture>>): Promise<void> {
  expect(await fixture.contracts.api3Wrapper.assetToProxy(fixture.assets.api3Plain)).to.equal(
    await fixture.mocks.api3PlainProxy.getAddress(),
  );

  expect(await fixture.contracts.api3ThresholdWrapper.assetToProxy(fixture.assets.api3Threshold)).to.equal(
    await fixture.mocks.api3ThresholdProxy.getAddress(),
  );
  const api3Threshold = await fixture.contracts.api3ThresholdWrapper.assetThresholds(fixture.assets.api3Threshold);
  expect(api3Threshold.lowerThresholdInBase).to.equal(ethers.parseUnits("1.00", 18));
  expect(api3Threshold.fixedPriceInBase).to.equal(ethers.parseUnits("1.00", 18));

  const api3Composite = await fixture.contracts.api3CompositeWrapper.compositeFeeds(fixture.assets.api3CompositeFeedAsset);
  expect(api3Composite.proxy1).to.equal(await fixture.mocks.api3CompositeProxy1.getAddress());
  expect(api3Composite.proxy2).to.equal(await fixture.mocks.api3CompositeProxy2.getAddress());
  expect(api3Composite.primaryThreshold.lowerThresholdInBase).to.equal(ethers.parseUnits("1.00", 18));
  expect(api3Composite.primaryThreshold.fixedPriceInBase).to.equal(ethers.parseUnits("1.00", 18));
  expect(api3Composite.secondaryThreshold.lowerThresholdInBase).to.equal(0n);
  expect(api3Composite.secondaryThreshold.fixedPriceInBase).to.equal(0n);

  const plainComposite = await fixture.contracts.api3CompositeWrapper.compositeFeeds(fixture.assets.api3Plain);
  expect(plainComposite.proxy1).to.equal(ethers.ZeroAddress);
  expect(plainComposite.proxy2).to.equal(ethers.ZeroAddress);
}

async function expectRedstoneSetupState(fixture: Awaited<ReturnType<typeof deployUsdOracleScriptFixture>>): Promise<void> {
  expect(await fixture.contracts.redstoneWrapper.assetToFeed(fixture.assets.redstonePlain)).to.equal(
    await fixture.mocks.redstonePlainFeed.getAddress(),
  );

  expect(await fixture.contracts.redstoneThresholdWrapper.assetToFeed(fixture.assets.redstoneThreshold)).to.equal(
    await fixture.mocks.redstoneThresholdFeed.getAddress(),
  );
  const redstoneThreshold = await fixture.contracts.redstoneThresholdWrapper.assetThresholds(fixture.assets.redstoneThreshold);
  expect(redstoneThreshold.lowerThresholdInBase).to.equal(ethers.parseUnits("1.00", 18));
  expect(redstoneThreshold.fixedPriceInBase).to.equal(ethers.parseUnits("1.00", 18));

  const redstoneComposite = await fixture.contracts.redstoneCompositeWrapper.compositeFeeds(fixture.assets.redstoneCompositeFeedAsset);
  expect(redstoneComposite.feed1).to.equal(await fixture.mocks.redstoneCompositeFeed1.getAddress());
  expect(redstoneComposite.feed2).to.equal(await fixture.mocks.redstoneCompositeFeed2.getAddress());
  expect(redstoneComposite.primaryThreshold.lowerThresholdInBase).to.equal(ethers.parseUnits("1.00", 18));
  expect(redstoneComposite.primaryThreshold.fixedPriceInBase).to.equal(ethers.parseUnits("1.00", 18));
  expect(redstoneComposite.secondaryThreshold.lowerThresholdInBase).to.equal(0n);
  expect(redstoneComposite.secondaryThreshold.fixedPriceInBase).to.equal(0n);

  const plainComposite = await fixture.contracts.redstoneCompositeWrapper.compositeFeeds(fixture.assets.redstonePlain);
  expect(plainComposite.feed1).to.equal(ethers.ZeroAddress);
  expect(plainComposite.feed2).to.equal(ethers.ZeroAddress);
}

async function expectAggregatorRoutingState(fixture: Awaited<ReturnType<typeof deployUsdOracleScriptFixture>>): Promise<void> {
  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.api3Plain)).to.equal(
    await fixture.contracts.api3Wrapper.getAddress(),
  );
  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.api3Threshold)).to.equal(
    await fixture.contracts.api3ThresholdWrapper.getAddress(),
  );
  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.api3CompositeFeedAsset)).to.equal(
    await fixture.contracts.api3CompositeWrapper.getAddress(),
  );
  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.api3CompositeConfigKey)).to.equal(ethers.ZeroAddress);

  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.redstonePlain)).to.equal(
    await fixture.contracts.redstoneWrapper.getAddress(),
  );
  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.redstoneThreshold)).to.equal(
    await fixture.contracts.redstoneThresholdWrapper.getAddress(),
  );
  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.redstoneCompositeFeedAsset)).to.equal(
    await fixture.contracts.redstoneCompositeWrapper.getAddress(),
  );
  expect(await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.redstoneCompositeConfigKey)).to.equal(ethers.ZeroAddress);
}

async function snapshotWrapperAndAggregatorState(fixture: Awaited<ReturnType<typeof deployUsdOracleScriptFixture>>) {
  const api3Threshold = await fixture.contracts.api3ThresholdWrapper.assetThresholds(fixture.assets.api3Threshold);
  const api3Composite = await fixture.contracts.api3CompositeWrapper.compositeFeeds(fixture.assets.api3CompositeFeedAsset);
  const redstoneThreshold = await fixture.contracts.redstoneThresholdWrapper.assetThresholds(fixture.assets.redstoneThreshold);
  const redstoneComposite = await fixture.contracts.redstoneCompositeWrapper.compositeFeeds(fixture.assets.redstoneCompositeFeedAsset);

  return {
    api3PlainProxy: await fixture.contracts.api3Wrapper.assetToProxy(fixture.assets.api3Plain),
    api3ThresholdProxy: await fixture.contracts.api3ThresholdWrapper.assetToProxy(fixture.assets.api3Threshold),
    api3Threshold: {
      lowerThresholdInBase: api3Threshold.lowerThresholdInBase,
      fixedPriceInBase: api3Threshold.fixedPriceInBase,
    },
    api3Composite: {
      proxy1: api3Composite.proxy1,
      proxy2: api3Composite.proxy2,
      primaryLowerThresholdInBase: api3Composite.primaryThreshold.lowerThresholdInBase,
      primaryFixedPriceInBase: api3Composite.primaryThreshold.fixedPriceInBase,
      secondaryLowerThresholdInBase: api3Composite.secondaryThreshold.lowerThresholdInBase,
      secondaryFixedPriceInBase: api3Composite.secondaryThreshold.fixedPriceInBase,
    },
    redstonePlainFeed: await fixture.contracts.redstoneWrapper.assetToFeed(fixture.assets.redstonePlain),
    redstoneThresholdFeed: await fixture.contracts.redstoneThresholdWrapper.assetToFeed(fixture.assets.redstoneThreshold),
    redstoneThreshold: {
      lowerThresholdInBase: redstoneThreshold.lowerThresholdInBase,
      fixedPriceInBase: redstoneThreshold.fixedPriceInBase,
    },
    redstoneComposite: {
      feed1: redstoneComposite.feed1,
      feed2: redstoneComposite.feed2,
      primaryLowerThresholdInBase: redstoneComposite.primaryThreshold.lowerThresholdInBase,
      primaryFixedPriceInBase: redstoneComposite.primaryThreshold.fixedPriceInBase,
      secondaryLowerThresholdInBase: redstoneComposite.secondaryThreshold.lowerThresholdInBase,
      secondaryFixedPriceInBase: redstoneComposite.secondaryThreshold.fixedPriceInBase,
    },
    aggregator: {
      api3Plain: await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.api3Plain),
      api3Threshold: await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.api3Threshold),
      api3Composite: await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.api3CompositeFeedAsset),
      redstonePlain: await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.redstonePlain),
      redstoneThreshold: await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.redstoneThreshold),
      redstoneComposite: await fixture.contracts.oracleAggregator.assetOracles(fixture.assets.redstoneCompositeFeedAsset),
    },
  };
}

async function deploy<T extends BaseContract>(contractName: string, args: unknown[] = []): Promise<T> {
  const contract = (await hre.ethers.deployContract(contractName, args)) as T;
  await contract.waitForDeployment();
  return contract;
}

function randomAddress(): string {
  return ethers.Wallet.createRandom().address;
}
