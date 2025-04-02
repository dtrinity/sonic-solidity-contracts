import { getAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  POOL_ADDRESSES_PROVIDER_ID,
  PRICE_ORACLE_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const addressesProviderDeployedResult = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID,
  );

  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderDeployedResult.address,
    signer,
  );

  // 1. Set price oracle
  const priceOracleAddress = (await hre.deployments.get(PRICE_ORACLE_ID))
    .address;
  const currentPriceOracle = await addressesProviderContract.getPriceOracle();

  if (getAddress(priceOracleAddress) === getAddress(currentPriceOracle)) {
    console.log("[addresses-provider] Price oracle already set. Skipping tx.");
  } else {
    const setPriceOracleResponse =
      await addressesProviderContract.setPriceOracle(priceOracleAddress);
    await setPriceOracleResponse.wait();
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:init_oracles";
func.tags = ["dlend", "dlend-market"];
func.dependencies = ["dlend-core", "dlend-periphery-pre", "deploy-oracles"];

export default func;
