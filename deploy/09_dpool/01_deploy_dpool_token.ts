import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log("No dPool configuration found, skipping DPoolToken deployment");
    return;
  }

  // Deploy token for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Deploying DPoolToken for ${dPoolName} ---`);

    // Get base asset address
    const baseAssetAddress = config.tokenAddresses[
        dPoolConfig.baseAsset as keyof typeof config.tokenAddresses
      ];

    if (!baseAssetAddress) {
      console.log(
        `⚠️  Skipping ${dPoolName}: missing base asset address for ${dPoolConfig.baseAsset}`,
      );
      continue;
    }
    
    if (!dPoolConfig.initialAdmin || !dPoolConfig.initialFeeManager || !dPoolConfig.maxWithdrawalFeeBps) {
      console.log(
        `⚠️  Skipping ${dPoolName}: missing required configuration values`,
      );
      continue;
    }

    const tokenName = `DPoolToken_${dPoolName}`;

    console.log(`Deploying DPoolToken: ${tokenName}`);
    console.log(`  Name: ${dPoolConfig.name}`);
    console.log(`  Symbol: ${dPoolConfig.symbol}`);
    console.log(`  Base Asset (${dPoolConfig.baseAsset}): ${baseAssetAddress}`);
    console.log(`  Initial Admin: ${dPoolConfig.initialAdmin}`);
    console.log(`  Initial Fee Manager: ${dPoolConfig.initialFeeManager}`);

    const poolToken = await deploy(tokenName, {
      contract: "DPoolToken",
      from: deployer,
      args: [
        dPoolConfig.name, // name
        dPoolConfig.symbol, // symbol
        baseAssetAddress, // base asset
        dPoolConfig.initialAdmin, // initial admin
        dPoolConfig.initialFeeManager, // initial fee manager
        dPoolConfig.initialFeeManager, // max withdrawal fee BPS
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (poolToken.newlyDeployed) {
      console.log(`✅ Deployed ${tokenName} at: ${poolToken.address}`);
    } else {
      console.log(`♻️  Reusing existing ${tokenName} at: ${poolToken.address}`);
    }

    console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  }
};

func.tags = ["dpool", "dpool-token"];
func.dependencies = [];

export default func;
