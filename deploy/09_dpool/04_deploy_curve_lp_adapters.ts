import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log("No dPool configuration found, skipping CurveLPAdapter deployment");
    return;
  }

  // Deploy adapters for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Deploying CurveLPAdapters for ${dPoolName} ---`);

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

    // Get collateral vault deployment
    const collateralVaultName = `DPoolCollateralVault_${dPoolName}`;

    let collateralVaultDeployment;

    try {
      collateralVaultDeployment = await get(collateralVaultName);
    } catch (error) {
      console.log(`⚠️  Failed to get DPoolCollateralVault deployment ${collateralVaultName}: ${error}`);
      console.log(
        `⚠️  Skipping ${dPoolName}: DPoolCollateralVault not found (${collateralVaultName})`,
      );
      continue;
    }

    // Deploy adapter for each Curve pool
    for (const poolConfig of dPoolConfig.curvePools) {
      const poolName = poolConfig.name;

      // Get Curve pool address - try configuration first, then deployment record (for local mocks)
      let curvePoolAddress = poolConfig.address;

      if (!curvePoolAddress) {
        // Try to get from deployment record (for local mock pools)
        try {
          const curvePoolDeployment = await get(poolName);
          curvePoolAddress = curvePoolDeployment.address;
          console.log(`📋 Using deployed mock pool ${poolName}: ${curvePoolAddress}`);
        } catch (error) {
          console.log(`⚠️  Skipping adapter for ${poolName}: Pool address not configured and deployment not found`);
          continue;
        }
      } else {
        console.log(`🔗 Using configured external pool ${poolName}: ${curvePoolAddress}`);
      }

      const adapterName = `CurveLPAdapter_${poolConfig.name}`;

      console.log(`Deploying CurveLPAdapter: ${adapterName}`);
      console.log(`  Curve Pool: ${curvePoolAddress}`);
      console.log(`  Base Asset (${dPoolConfig.baseAsset}): ${baseAssetAddress}`);
      console.log(`  Collateral Vault: ${collateralVaultDeployment.address}`);

      const adapter = await deploy(adapterName, {
        contract: "CurveLPAdapter",
        from: deployer,
        args: [
          curvePoolAddress, // Curve pool address
          baseAssetAddress, // Base asset address
          collateralVaultDeployment.address, // Collateral vault address
        ],
        log: true,
        skipIfAlreadyDeployed: true,
      });

      if (adapter.newlyDeployed) {
        console.log(`✅ Deployed ${adapterName} at: ${adapter.address}`);
      } else {
        console.log(`♻️  Reusing existing ${adapterName} at: ${adapter.address}`);
      }
    }
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-adapters"];
func.dependencies = ["dpool-token", "dpool-collateral-vault", "dpool-router"];

export default func;
