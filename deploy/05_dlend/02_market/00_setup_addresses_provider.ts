import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../../../config/config";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER_ID,
} from "../../../typescript/deploy-ids";

const MARKET_NAME = "dLEND";
const LENDING_CORE_VERSION = "1.0.0";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { lendingDeployer } = await hre.getNamedAccounts();
  const marketID = `${hre.network.name}_dtrinity_market`;
  const config = await getConfig(hre);

  // 1. Deploy PoolAddressesProvider
  // NOTE: We pass 0 as market id to create the same address of PoolAddressesProvider
  // in multiple networks via CREATE2. Later we update the corresponding Market ID.
  const addressesProviderDeployment = await hre.deployments.deploy(
    POOL_ADDRESSES_PROVIDER_ID,
    {
      from: lendingDeployer,
      args: ["0", lendingDeployer],
      contract: "PoolAddressesProvider",
      autoMine: true,
      log: false,
    }
  );

  // Get contract instance
  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderDeployment.address,
    await hre.ethers.getSigner(lendingDeployer)
  );

  // 2. Set the MarketId
  console.log(`------------------------`);
  console.log(`Setting MarketId to: ${marketID}`);
  const setMarketIdResponse =
    await addressesProviderContract.setMarketId(marketID);
  const setMarketIdReceipt = await setMarketIdResponse.wait();
  console.log(`  - TxHash: ${setMarketIdReceipt?.hash}`);
  console.log(`  - GasUsed: ${setMarketIdReceipt?.gasUsed.toString()}`);
  console.log(`------------------------`);

  // 3. Add AddressesProvider to Registry
  const registryContract = await hre.ethers.getContractAt(
    "PoolAddressesProviderRegistry",
    (await hre.deployments.get("PoolAddressesProviderRegistry")).address,
    await hre.ethers.getSigner(lendingDeployer)
  );

  console.log(`------------------------`);
  console.log(`Registering market with ID: ${config.lending.providerID}`);
  const registerResponse = await registryContract.registerAddressesProvider(
    addressesProviderDeployment.address,
    config.lending.providerID
  );
  const registerReceipt = await registerResponse.wait();
  console.log(`  - TxHash: ${registerReceipt?.hash}`);
  console.log(`  - GasUsed: ${registerReceipt?.gasUsed.toString()}`);
  console.log(`------------------------`);

  // 4. Deploy AaveProtocolDataProvider getters contract
  const protocolDataProviderDeployment = await hre.deployments.deploy(
    POOL_DATA_PROVIDER_ID,
    {
      from: lendingDeployer,
      args: [addressesProviderDeployment.address],
      contract: "AaveProtocolDataProvider",
      autoMine: true,
      log: false,
    }
  );

  // Get current protocol data provider address
  const currentProtocolDataProviderAddress =
    await addressesProviderContract.getPoolDataProvider();

  // Set the ProtocolDataProvider if not already set
  if (
    currentProtocolDataProviderAddress.toLowerCase() !==
    protocolDataProviderDeployment.address.toLowerCase()
  ) {
    console.log(`------------------------`);
    console.log(`Setting PoolDataProvider`);
    const setDataProviderResponse =
      await addressesProviderContract.setPoolDataProvider(
        protocolDataProviderDeployment.address
      );
    const setDataProviderReceipt = await setDataProviderResponse.wait();
    console.log(`  - TxHash: ${setDataProviderReceipt?.hash}`);
    console.log(`  - GasUsed: ${setDataProviderReceipt?.gasUsed.toString()}`);
    console.log(`------------------------`);
  }

  // Return true to indicate deployment success
  return true;
};

// This script can only be run successfully once per market (the deployment on each network will be in a dedicated directory), core version
func.id = `PoolAddressesProvider-${MARKET_NAME}:lending-core@${LENDING_CORE_VERSION}`;
func.tags = ["lbp", "lbp-market", "lbp-provider"];
func.dependencies = [
  "before-deploy",
  "lbp-core",
  "lbp-periphery-pre",
  "token-setup",
];

export default func;
