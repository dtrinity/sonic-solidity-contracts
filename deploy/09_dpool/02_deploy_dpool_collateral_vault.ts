import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    log(
      "No dPool configuration found, skipping DPoolCollateralVault deployment",
    );
    return;
  }

  // Deploy collateral vault for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    log(`\n--- Deploying DPoolCollateralVault for ${dPoolName} ---`);

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

    // Get DPoolToken deployment
    const tokenName = `DPoolToken_${dPoolName}`;

    let poolTokenDeployment;

    try {
      poolTokenDeployment = await get(tokenName);
    } catch (error) {
      console.log(error);
      log(`⚠️  Skipping ${dPoolName}: DPoolToken not found (${tokenName})`);
      continue;
    }

    const collateralVaultName = `DPoolCollateralVault_${dPoolName}`;

    log(`Deploying DPoolCollateralVault: ${collateralVaultName}`);
    log(`  Pool Token: ${poolTokenDeployment.address}`);
    log(`  Base Asset (${dPoolConfig.baseAsset}): ${baseAssetAddress}`);

    const collateralVault = await deploy(collateralVaultName, {
      contract: "DPoolCollateralVault",
      from: deployer,
      args: [
        poolTokenDeployment.address, // Real DPoolToken address
        baseAssetAddress, // Base asset address
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (collateralVault.newlyDeployed) {
      log(`✅ Deployed ${collateralVaultName} at: ${collateralVault.address}`);
    } else {
      log(
        `♻️  Reusing existing ${collateralVaultName} at: ${collateralVault.address}`,
      );
    }
  }
};

func.tags = ["dpool", "dpool-collateral-vault"];
func.dependencies = ["dpool-token"];

export default func;
