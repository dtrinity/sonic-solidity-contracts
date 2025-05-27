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
    log("No dPool configuration found, skipping DPoolRouter deployment");
    return;
  }

  // Deploy router for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    log(`\n--- Deploying DPoolRouter for ${dPoolName} ---`);

    // Get DPoolToken deployment
    const tokenName = `DPoolToken_${dPoolName}`;

    let poolTokenDeployment;

    try {
      poolTokenDeployment = await get(tokenName);
    } catch (error) {
      log(`⚠️  Skipping ${dPoolName}: DPoolToken not found (${tokenName})`);
      continue;
    }

    // Get collateral vault deployment
    const collateralVaultName = `DPoolCollateralVault_${dPoolName}`;

    let collateralVaultDeployment;

    try {
      collateralVaultDeployment = await get(collateralVaultName);
    } catch (error) {
      log(
        `⚠️  Skipping ${dPoolName}: DPoolCollateralVault not found (${collateralVaultName})`,
      );
      continue;
    }

    const routerName = `DPoolRouter_${dPoolName}`;

    log(`Deploying DPoolRouter: ${routerName}`);
    log(`  Pool Token: ${poolTokenDeployment.address}`);
    log(`  Collateral Vault: ${collateralVaultDeployment.address}`);

    const router = await deploy(routerName, {
      contract: "DPoolRouter",
      from: deployer,
      args: [
        poolTokenDeployment.address, // Real DPoolToken address
        collateralVaultDeployment.address, // Collateral vault address
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (router.newlyDeployed) {
      log(`✅ Deployed ${routerName} at: ${router.address}`);
    } else {
      log(`♻️  Reusing existing ${routerName} at: ${router.address}`);
    }
  }
};

func.tags = ["dpool", "dpool-router"];
func.dependencies = ["dpool-collateral-vault"];

export default func;
