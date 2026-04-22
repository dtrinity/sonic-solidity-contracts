import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { setupNewReserves } from "../../typescript/dlend";
import { USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const reserveSymbol = "wstkscUSD";

async function assertWstkscUSDOracleReady(hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const wstkscUSDAddress = config.tokenAddresses.wstkscUSD;

  if (!wstkscUSDAddress) {
    return;
  }

  const thirdFeedConfig = config.oracleAggregators.USD.safeRateProviderAssets?.erc4626RateProviderThirdFeedWrappers?.[wstkscUSDAddress];
  if (!thirdFeedConfig) {
    return;
  }

  const wrapperDeployment = await hre.deployments.get(USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID);
  const oracleAggregatorDeployment = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorDeployment.address, signer);

  const configuredOracle = await oracleAggregator.assetOracles(wstkscUSDAddress);
  if (configuredOracle.toLowerCase() !== wrapperDeployment.address.toLowerCase()) {
    throw new Error(
      `wstkscUSD OracleAggregator route is not ready. Expected ${wrapperDeployment.address}, found ${configuredOracle}. Execute the queued ${USD_ERC4626_RATE_PROVIDER_THIRD_FEED_WRAPPER_ID} governance oracle flip before adding the reserve.`,
    );
  }

  const priceInfo = await oracleAggregator.getPriceInfo(wstkscUSDAddress);
  const price = BigInt(priceInfo.price ?? priceInfo[0]);
  const isAlive = Boolean(priceInfo.isAlive ?? priceInfo[1]);

  if (!isAlive || price <= 0n) {
    throw new Error(`wstkscUSD OracleAggregator price is not alive or is non-positive after routing to ${wrapperDeployment.address}.`);
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log(`Starting setup for ${reserveSymbol} reserve using helper...`);

  await assertWstkscUSDOracleReady(hre);
  await setupNewReserves(hre, [reserveSymbol]);
  console.log(`✅ ${__filename.split("/").slice(-2).join("/")}: ${reserveSymbol} reserve setup complete.`);

  return true;
};

// Update ID, Tags, and Dependencies
func.id = `add-${reserveSymbol}-reserve`;
func.tags = ["dlend", "dlend-market", "dlend-reserves", `dlend-${reserveSymbol}`];
func.dependencies = [
  "dLend:init_reserves",
  "setup-wstkscusd-for-usd-redstone-composite-oracle-wrapper",
  "queue-erc4626-rate-provider-third-feed-oracle-updates",
];

export default func;
