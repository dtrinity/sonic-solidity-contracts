import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getAddress } from "ethers";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  PRICE_ORACLE_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { lendingDeployer } = await hre.getNamedAccounts();
  const deployer = await hre.ethers.getSigner(lendingDeployer);

  const addressesProviderDeployedResult = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderDeployedResult.address,
    deployer
  );

  // 1. Set price oracle
  const priceOracleAddress = (await hre.deployments.get(PRICE_ORACLE_ID))
    .address;
  const currentPriceOracle = await addressesProviderContract.getPriceOracle();

  console.log(`---------------`);
  console.log(`Set PriceOracle`);
  console.log(`  - PriceOracle     : ${priceOracleAddress}`);
  console.log(
    `  - AddressProvider : ${addressesProviderDeployedResult.address}`
  );

  if (getAddress(priceOracleAddress) === getAddress(currentPriceOracle)) {
    console.log("[addresses-provider] Price oracle already set. Skipping tx.");
  } else {
    const setPriceOracleResponse =
      await addressesProviderContract.setPriceOracle(priceOracleAddress);
    const setPriceOracleReceipt = await setPriceOracleResponse.wait();
    console.log(`  - TxHash  : ${setPriceOracleReceipt?.hash}`);
    console.log(`  - From    : ${setPriceOracleReceipt?.from}`);
    console.log(`  - GasUsed : ${setPriceOracleReceipt?.gasUsed.toString()}`);
    console.log(
      `[Deployment] Added PriceOracle ${priceOracleAddress} to PoolAddressesProvider`
    );
  }
  console.log(`---------------`);

  return true;
};

func.id = "init_oracles";
func.tags = ["market", "oracle"];
func.dependencies = ["addresses-provider", "deploy-oracles"];

export default func;
