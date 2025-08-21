import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { REWARD_HELPER_ID } from "../../config/deploy-ids";
import { assertNotEmpty } from "../../typescript/common/assert";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  console.log("🤖 Deploying RewardHelper on Sonic Testnet...");

  const config = await getConfig(hre);

  // Validate required addresses
  if (!config.poolAddress || config.poolAddress === ethers.ZeroAddress) {
    throw new Error("POOL address is not configured");
  }
  if (!config.rewardControllerAddress || config.rewardControllerAddress === ethers.ZeroAddress) {
    throw new Error("REWARD_CONTROLLER address is not configured");
  }
  if (!config.addressProviderAddress || config.addressProviderAddress === ethers.ZeroAddress) {
    throw new Error("ADDRESS_PROVIDER address is not configured");
  }

  console.log("📋 Deployment Configuration:");
  console.log(`   Deployer: ${deployer}`);
  console.log(`   POOL: ${config.poolAddress}`);
  console.log(`   REWARD_CONTROLLER: ${config.rewardControllerAddress}`);
  console.log(`   ADDRESS_PROVIDER: ${config.addressProviderAddress}`);

  // Deploy RewardHelper
  await hre.deployments.deploy(REWARD_HELPER_ID, {
    from: deployer,
    args: [
      assertNotEmpty(config.poolAddress),
      assertNotEmpty(config.rewardControllerAddress),
      assertNotEmpty(config.addressProviderAddress),
    ],
    contract: "RewardHelper",
    autoMine: true,
    log: true,
  });

  // Get deployment result
  const deploymentResult = await hre.deployments.get(REWARD_HELPER_ID);

  console.log(`✅ Deployed RewardHelper at ${deploymentResult.address}`);

  // Verify deployment by checking if contract is functional
  const helperContract = await hre.ethers.getContractAt(
    "RewardHelper",
    deploymentResult.address,
    await hre.ethers.getSigner(deployer)
  );

  // Test basic functionality
  try {
    const poolAddress = await helperContract.POOL();
    const rewardControllerAddress = await helperContract.REWARDS_CONTROLLER();
    const addressProviderAddress = await helperContract.ADDRESS_PROVIDER();

    console.log("🔍 Contract verification:");
    console.log(`   POOL matches: ${poolAddress === config.poolAddress}`);
    console.log(`   REWARD_CONTROLLER matches: ${rewardControllerAddress === config.rewardControllerAddress}`);
    console.log(`   ADDRESS_PROVIDER matches: ${addressProviderAddress === config.addressProviderAddress}`);

    if (
      poolAddress !== config.poolAddress ||
      rewardControllerAddress !== config.rewardControllerAddress ||
      addressProviderAddress !== config.addressProviderAddress
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

func.tags = ["reward-compounder", "helper", "testnet"];
func.dependencies = [];
func.id = REWARD_HELPER_ID;

export default func;
