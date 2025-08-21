import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { REWARD_COMPOUNDER_ODOS_ID } from "../../config/deploy-ids";
import { assertNotEmpty } from "../../typescript/common/assert";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  console.log("🤖 Deploying DLoop Reward Compounder Periphery on Sonic Testnet...");

  const config = await getConfig(hre);

  // Validate required addresses
  if (!config.coreAddress || config.coreAddress === ethers.ZeroAddress) {
    throw new Error("CORE address is not configured");
  }
  if (!config.dusdAddress || config.dusdAddress === ethers.ZeroAddress) {
    throw new Error("DUSD address is not configured");
  }
  if (!config.collateralAddress || config.collateralAddress === ethers.ZeroAddress) {
    throw new Error("COLLATERAL address is not configured");
  }
  if (!config.flashLenderAddress || config.flashLenderAddress === ethers.ZeroAddress) {
    throw new Error("FLASH_LENDER address is not configured");
  }
  if (!config.odosRouterAddress || config.odosRouterAddress === ethers.ZeroAddress) {
    throw new Error("ODOS_ROUTER address is not configured");
  }

  console.log("📋 Deployment Configuration:");
  console.log(`   Deployer: ${deployer}`);
  console.log(`   CORE: ${config.coreAddress}`);
  console.log(`   DUSD: ${config.dusdAddress}`);
  console.log(`   COLLATERAL: ${config.collateralAddress}`);
  console.log(`   FLASH_LENDER: ${config.flashLenderAddress}`);
  console.log(`   ODOS_ROUTER: ${config.odosRouterAddress}`);

  // Deploy RewardCompounderDLendOdos
  await hre.deployments.deploy(REWARD_COMPOUNDER_ODOS_ID, {
    from: deployer,
    args: [
      assertNotEmpty(config.dusdAddress),
      assertNotEmpty(config.collateralAddress),
      assertNotEmpty(config.flashLenderAddress),
      assertNotEmpty(config.coreAddress),
      assertNotEmpty(config.odosRouterAddress),
    ],
    contract: "RewardCompounderDLendOdos",
    autoMine: true,
    log: true,
  });

  // Get deployment result
  const deploymentResult = await hre.deployments.get(REWARD_COMPOUNDER_ODOS_ID);

  console.log(`✅ Deployed RewardCompounderDLendOdos at ${deploymentResult.address}`);

  // Verify deployment by checking if contract is functional
  const compounderContract = await hre.ethers.getContractAt(
    "RewardCompounderDLendOdos",
    deploymentResult.address,
    await hre.ethers.getSigner(deployer)
  );

  // Test basic functionality
  try {
    const coreAddress = await compounderContract.CORE();
    const dusdAddress = await compounderContract.DUSD();
    const collateralAddress = await compounderContract.COLLATERAL();

    console.log("🔍 Contract verification:");
    console.log(`   CORE matches: ${coreAddress === config.coreAddress}`);
    console.log(`   DUSD matches: ${dusdAddress === config.dusdAddress}`);
    console.log(`   COLLATERAL matches: ${collateralAddress === config.collateralAddress}`);

    if (
      coreAddress !== config.coreAddress ||
      dusdAddress !== config.dusdAddress ||
      collateralAddress !== config.collateralAddress
    ) {
      throw new Error("Contract verification failed - addresses don't match");
    }

    console.log("✅ Contract verification successful");
  } catch (error) {
    console.error("❌ Contract verification failed:", error);
    throw error;
  }

  return true;
};

func.tags = ["reward-compounder", "periphery", "testnet"];
func.dependencies = [];
func.id = REWARD_COMPOUNDER_ODOS_ID;

export default func;
