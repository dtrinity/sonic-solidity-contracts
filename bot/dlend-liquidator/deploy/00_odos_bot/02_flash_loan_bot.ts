import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { FLASH_LOAN_LIQUIDATOR_ODOS_ID } from "../../config/deploy-ids";
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

  // In this case, the flash loan lender is the liquidating pool itself
  const flashLoanLender = poolAddress;

  // Deploy the flash loan liquidator bot
  await hre.deployments.deploy(FLASH_LOAN_LIQUIDATOR_ODOS_ID, {
    from: deployer,
    args: [
      assertNotEmpty(flashLoanLender),
      assertNotEmpty(lendingPoolAddressesProviderAddress),
      assertNotEmpty(poolAddress),
      config.liquidatorBotOdos.slippageTolerance,
      assertNotEmpty(routerAddress),
    ],
    contract: "FlashLoanLiquidatorAaveBorrowRepayOdos",
    autoMine: true,
    log: true,
  });

  // Configure the deployed contract
  const flashLoanLiquidatorBotDeployedResult = await hre.deployments.get(
    FLASH_LOAN_LIQUIDATOR_ODOS_ID,
  );
  const flashLoanLiquidatorBotContract = await hre.ethers.getContractAt(
    "FlashLoanLiquidatorAaveBorrowRepayOdos",
    flashLoanLiquidatorBotDeployedResult.address,
    await hre.ethers.getSigner(deployer),
  );

  // Set proxy contracts if they exist in config
  if (config.tokenProxyContractMap) {
    for (const [token, proxyContract] of Object.entries(
      config.tokenProxyContractMap,
    )) {
      await flashLoanLiquidatorBotContract.setProxyContract(
        token,
        proxyContract,
      );
    }
  }

  console.log(
    `🤖 Deployed Flash Loan Liquidator Bot at ${flashLoanLiquidatorBotDeployedResult.address}`,
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
func.id = FLASH_LOAN_LIQUIDATOR_ODOS_ID;

export default func;
