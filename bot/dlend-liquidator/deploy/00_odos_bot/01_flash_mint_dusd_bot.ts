import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { FLASH_MINT_DUSD_LIQUIDATOR_ODOS_ID } from "../../config/deploy-ids";
import { getPoolAddressesProviderAddressFromParent } from "../../typescript/dlend_helpers/pool";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  const routerAddress = config.liquidatorBotOdos.odosRouter;

  if (!routerAddress) {
    throw new Error("Odos router address is not found");
  }

  // Get the PoolAddressesProvider address from the parent deployment
  const lendingPoolAddressesProviderAddress =
    await getPoolAddressesProviderAddressFromParent(hre);

  // Initialize the PoolAddressesProvider contract
  const addressProviderContract = await hre.ethers.getContractAt(
    [
      "function getPool() public view returns (address)",
      "function getPoolDataProvider() public view returns (address)",
    ],
    lendingPoolAddressesProviderAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get the Pool address from the provider
  const poolAddress = await addressProviderContract.getPool();

  // Get the Pool Data Provider
  const poolDataProviderAddress =
    await addressProviderContract.getPoolDataProvider();
  const poolDataProviderContract = await hre.ethers.getContractAt(
    [
      "function getReserveTokensAddresses(address) public view returns (address, address, address)",
    ],
    poolDataProviderAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get the AToken of the flash minter (quote token)
  // All returns: { aTokenAddress, variableDebtTokenAddress, stableDebtTokenAddress }
  const [aTokenAddress, _variableDebtTokenAddress, _stableDebtTokenAddress] =
    await poolDataProviderContract.getReserveTokensAddresses(
      config.liquidatorBotOdos.flashMinter,
    );

  // Deploy the flash mint liquidator bot
  console.log("Deploying flash mint liquidator bot");
  await hre.deployments.deploy(FLASH_MINT_DUSD_LIQUIDATOR_ODOS_ID, {
    from: deployer,
    args: [
      assertNotEmpty(config.liquidatorBotOdos.flashMinter),
      assertNotEmpty(lendingPoolAddressesProviderAddress),
      assertNotEmpty(poolAddress),
      assertNotEmpty(aTokenAddress),
      BigInt(config.liquidatorBotOdos.slippageTolerance),
      assertNotEmpty(routerAddress),
    ],
    libraries: undefined,
    contract: "FlashMintLiquidatorAaveBorrowRepayOdos",
    autoMine: true,
    log: false,
  });

  // Configure the deployed contract
  console.log("Configuring deployed contract");
  const flashMintLiquidatorBotDeployedResult = await hre.deployments.get(
    FLASH_MINT_DUSD_LIQUIDATOR_ODOS_ID,
  );
  const flashMintLiquidatorBotContract = await hre.ethers.getContractAt(
    "FlashMintLiquidatorAaveBorrowRepayOdos",
    flashMintLiquidatorBotDeployedResult.address,
    await hre.ethers.getSigner(deployer),
  );

  // Set proxy contracts if they exist in config
  if (config.tokenProxyContractMap) {
    for (const [token, proxyContract] of Object.entries(
      config.tokenProxyContractMap,
    )) {
      await flashMintLiquidatorBotContract.setProxyContract(
        token,
        proxyContract,
      );
    }
  }

  console.log(
    `🤖 Deployed Flash Mint Liquidator Bot at ${flashMintLiquidatorBotDeployedResult.address}`,
  );

  // Return true to indicate the success of the script
  return true;
};

/**
 * Assert that the value is not empty
 *
 * @param value - The value to assert
 * @returns The input value if it is not empty
 */
function assertNotEmpty(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("Value is undefined");
  }

  if (value.trim() === "") {
    throw new Error("Trimmed value is empty");
  }

  if (value.length === 0) {
    throw new Error("Value is empty");
  }
  return value;
}

func.tags = ["liquidator-bot"];
func.dependencies = [];
func.id = FLASH_MINT_DUSD_LIQUIDATOR_ODOS_ID;

export default func;
