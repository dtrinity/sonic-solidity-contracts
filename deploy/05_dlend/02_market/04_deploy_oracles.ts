import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  PRICE_ORACLE_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get oracle aggregator address for fallback oracle
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  // Get configuration
  const config = await getConfig(hre);
  const oracleConfig = config.oracleAggregators.USD;

  // Get reserve assets and their oracle sources
  const assets: string[] = [];
  const sources: string[] = [];

  // Process plain API3 oracle wrappers
  for (const [asset, source] of Object.entries(
    oracleConfig.api3OracleAssets.plainApi3OracleWrappers,
  )) {
    assets.push(asset);
    sources.push(source);
  }

  // Process API3 oracle wrappers with thresholding
  for (const [asset, config] of Object.entries(
    oracleConfig.api3OracleAssets.api3OracleWrappersWithThresholding,
  )) {
    assets.push(asset);
    sources.push(config.proxy);
  }

  // Process composite API3 oracle wrappers with thresholding
  for (const [asset, config] of Object.entries(
    oracleConfig.api3OracleAssets.compositeApi3OracleWrappersWithThresholding,
  )) {
    assets.push(asset);
    sources.push(config.proxy1);
  }

  if (assets.length !== sources.length) {
    throw new Error(
      `Invalid pairs of assets and sources: ${assets.length} !== ${sources.length}`,
    );
  }

  // Get addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID,
  );

  // Deploy AaveOracle
  await hre.deployments.deploy(PRICE_ORACLE_ID, {
    from: deployer,
    args: [
      addressesProviderAddress,
      assets,
      sources,
      oracleAggregatorAddress, // fallback oracle
      ZeroAddress, // USD base currency (represented by zero address per Aave convention)
      hre.ethers.parseUnits("1", oracleConfig.priceDecimals), // BASE_CURRENCY_UNIT (always 1 in base currency decimals)
    ],
    contract: "AaveOracle",
    autoMine: true,
    log: true,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "deploy_oracles";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];

export default func;
