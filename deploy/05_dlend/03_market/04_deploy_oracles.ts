import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  POOL_ADDRESSES_PROVIDER_ID,
  PRICE_ORACLE_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get oracle aggregator address
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  // Get addresses provider address
  const { address: addressesProviderAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID,
  );

  // Deploy AaveOracle with simplified constructor args
  await hre.deployments.deploy(PRICE_ORACLE_ID, {
    from: deployer,
    args: [addressesProviderAddress, oracleAggregatorAddress],
    contract: "AaveOracle",
    autoMine: true,
    log: true,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:deploy_oracles";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre"];

export default func;
