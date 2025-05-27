import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    log("No dPool configuration found, skipping DPoolToken deployment");
    return;
  }

  // Deploy token for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    log(`\n--- Deploying DPoolToken for ${dPoolName} ---`);

    // Get base asset address
    const baseAssetAddress =
      config.MOCK_ONLY?.tokens[dPoolConfig.baseAsset]?.address ||
      config.tokenAddresses[
        dPoolConfig.baseAsset as keyof typeof config.tokenAddresses
      ];

    if (!baseAssetAddress) {
      log(
        `⚠️  Skipping ${dPoolName}: missing base asset address for ${dPoolConfig.baseAsset}`,
      );
      continue;
    }

    const tokenName = `DPoolToken_${dPoolName}`;

    log(`Deploying DPoolToken: ${tokenName}`);
    log(`  Name: ${dPoolConfig.name}`);
    log(`  Symbol: ${dPoolConfig.symbol}`);
    log(`  Base Asset (${dPoolConfig.baseAsset}): ${baseAssetAddress}`);
    log(`  Initial Admin: ${dPoolConfig.initialAdmin}`);
    log(`  Initial Fee Manager: ${dPoolConfig.initialFeeManager}`);

    const poolToken = await deploy(tokenName, {
      contract: "DPoolToken",
      from: deployer,
      args: [
        dPoolConfig.name, // name
        dPoolConfig.symbol, // symbol
        baseAssetAddress, // base asset
        dPoolConfig.initialAdmin, // initial admin
        dPoolConfig.initialFeeManager, // initial fee manager
        dPoolConfig.maxWithdrawalFeeBps, // max withdrawal fee BPS
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (poolToken.newlyDeployed) {
      log(`✅ Deployed ${tokenName} at: ${poolToken.address}`);
    } else {
      log(`♻️  Reusing existing ${tokenName} at: ${poolToken.address}`);
    }
  }
};

func.tags = ["dpool", "dpool-token"];
func.dependencies = [];

export default func;
