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
    console.log("No dPool configuration found, skipping dPOOL deployment");
    return;
  }

  console.log(`\n--- Deploying dPOOL Vaults & Peripheries ---`);

  // Deploy vault and periphery for each dPool instance
  for (const [dPoolId, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Deploying dPOOL for ${dPoolId} ---`);

    // Get base asset address
    const baseAssetAddress =
      config.tokenAddresses[
        dPoolConfig.baseAsset as keyof typeof config.tokenAddresses
      ];

    if (!baseAssetAddress) {
      console.log(
        `⚠️  Skipping ${dPoolId}: missing base asset address for ${dPoolConfig.baseAsset}`,
      );
      continue;
    }

    // Get Curve pool deployment
    let curvePoolDeployment;

    try {
      // Try to get by deployment name first (localhost)
      curvePoolDeployment = await get(dPoolConfig.pool);
    } catch (error) {
      // If deployment name fails, assume it's an address (testnet/mainnet)
      if (hre.ethers.isAddress(dPoolConfig.pool)) {
        curvePoolDeployment = { address: dPoolConfig.pool };
        console.log(`Using external pool address: ${dPoolConfig.pool}`);
      } else {
        console.log(
          `⚠️  Failed to get Curve pool deployment ${dPoolConfig.pool}: ${error}`,
        );
        console.log(`⚠️  Skipping ${dPoolId}: pool not found`);
        continue;
      }
    }

    console.log(`  Pool: ${curvePoolDeployment.address}`);
    console.log(`  Base Asset (${dPoolConfig.baseAsset}): ${baseAssetAddress}`);
    console.log(`  Name: ${dPoolConfig.name}`);
    console.log(`  Symbol: ${dPoolConfig.symbol}`);

    // Deploy Vault
    const vaultDeploymentName = `DPoolVault_${dPoolId}`;
    const vault = await deploy(vaultDeploymentName, {
      contract: "DPoolVaultCurveLP",
      from: deployer,
      args: [
        baseAssetAddress, // baseAsset (for external valuation only)
        curvePoolDeployment.address, // lpToken (curve pool serves as LP token)
        curvePoolDeployment.address, // pool (same as LP token for Curve)
        dPoolConfig.name, // name
        dPoolConfig.symbol, // symbol
        dPoolConfig.initialAdmin || deployer, // admin
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (vault.newlyDeployed) {
      console.log(`  ✅ Deployed Vault: ${vault.address}`);
    } else {
      console.log(`  ♻️  Reusing Vault: ${vault.address}`);
    }

    // Deploy Periphery
    const peripheryDeploymentName = `DPoolPeriphery_${dPoolId}`;
    const periphery = await deploy(peripheryDeploymentName, {
      contract: "DPoolCurvePeriphery",
      from: deployer,
      args: [
        vault.address, // vault
        curvePoolDeployment.address, // pool
        dPoolConfig.initialAdmin || deployer, // admin
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (periphery.newlyDeployed) {
      console.log(`  ✅ Deployed Periphery: ${periphery.address}`);
    } else {
      console.log(`  ♻️  Reusing Periphery: ${periphery.address}`);
    }

    console.log(`  ✅ ${dPoolId} deployment complete`);
  }

  console.log(`\n✅ All dPOOL deployments complete!`);
  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-vaults", "dpool-peripheries"];
func.dependencies = ["curve"];

export default func;
