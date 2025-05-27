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
    log("No dPool configuration found, skipping CurveLPAdapter deployment");
    return;
  }

  // Deploy adapters for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    log(`\n--- Deploying CurveLPAdapters for ${dPoolName} ---`);

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

    // Get collateral vault deployment
    const collateralVaultName = `DPoolCollateralVault_${dPoolName}`;

    let collateralVaultDeployment;

    try {
      collateralVaultDeployment = await get(collateralVaultName);
    } catch (error) {
      console.log(error);
      log(
        `⚠️  Skipping ${dPoolName}: DPoolCollateralVault not found (${collateralVaultName})`,
      );
      continue;
    }

    // Deploy adapter for each Curve pool
    for (const poolConfig of dPoolConfig.curvePools) {
      const poolName = poolConfig.name;

      // Get Curve pool deployment
      let curvePoolDeployment;

      try {
        curvePoolDeployment = await get(poolName);
      } catch (error) {
        console.log(error);
        log(`⚠️  Skipping adapter for ${poolName}: Curve pool not found`);
        continue;
      }

      const adapterName = `CurveLPAdapter_${dPoolName}_${poolConfig.name}`;

      log(`Deploying CurveLPAdapter: ${adapterName}`);
      log(`  Curve Pool: ${curvePoolDeployment.address}`);
      log(`  Base Asset (${dPoolConfig.baseAsset}): ${baseAssetAddress}`);
      log(`  Collateral Vault: ${collateralVaultDeployment.address}`);

      const adapter = await deploy(adapterName, {
        contract: "CurveLPAdapter",
        from: deployer,
        args: [
          curvePoolDeployment.address, // Curve pool address
          baseAssetAddress, // Base asset address
          collateralVaultDeployment.address, // Collateral vault address
        ],
        log: true,
        skipIfAlreadyDeployed: true,
      });

      if (adapter.newlyDeployed) {
        log(`✅ Deployed ${adapterName} at: ${adapter.address}`);
      } else {
        log(`♻️  Reusing existing ${adapterName} at: ${adapter.address}`);
      }
    }
  }
};

func.tags = ["dpool", "dpool-adapters"];
func.dependencies = ["dpool-curve-pools", "dpool-router"];

export default func;
