import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log(
      "No dPool configuration found, skipping dPOOL system verification",
    );
    return;
  }

  if (!deployer) {
    console.log(
      "No deployer address found, skipping dPOOL system verification",
    );
    return;
  }

  console.log(`\n--- dPOOL System Verification & Summary ---`);

  // Get factory deployment
  let factoryDeployment;

  try {
    factoryDeployment = await get("DPoolVaultFactory");
  } catch (error) {
    console.log(`⚠️  Failed to get DPoolVaultFactory deployment: ${error}`);
    console.log(`⚠️  Skipping system verification: factory not found`);
    return;
  }

  // Get factory contract instance
  const factory = await ethers.getContractAt(
    "DPoolVaultFactory",
    factoryDeployment.address,
    await ethers.getSigner(deployer as string),
  );

  console.log(`✅ DPoolVaultFactory deployed at: ${factoryDeployment.address}`);

  // Verify implementations
  const CURVE_DEX_TYPE = ethers.keccak256(ethers.toUtf8Bytes("CURVE"));
  const vaultImpl = await factory.vaultImplementations(CURVE_DEX_TYPE);
  const peripheryImpl = await factory.peripheryImplementations(CURVE_DEX_TYPE);

  console.log(`✅ Curve Vault Implementation: ${vaultImpl}`);
  console.log(`✅ Curve Periphery Implementation: ${peripheryImpl}`);

  // Get all deployed farms
  const farmCount = await factory.getFarmCount();
  const allVaults = await factory.getAllVaults();
  const allPeripheries = await factory.getAllPeripheries();

  console.log(`\n📊 System Summary:`);
  console.log(`  Total Farms Deployed: ${farmCount}`);
  console.log(`  Total Vaults: ${allVaults.length}`);
  console.log(`  Total Peripheries: ${allPeripheries.length}`);

  // Verify each dPool configuration
  let totalFarmCount = 0;

  for (const [dPoolId, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Verifying ${dPoolId} ---`);

    try {
      // Try to get by deployment name first (localhost)
      const curvePoolDeployment = await get(dPoolConfig.pool);

      // Find the farm for this pool
      let farmFound = false;
      let farmVault = null;
      let farmPeriphery = null;

      for (let i = 0; i < allVaults.length; i++) {
        const vaultInfo = await factory.getVaultInfo(allVaults[i]);

        if (vaultInfo.lpToken === curvePoolDeployment.address) {
          farmFound = true;
          farmVault = vaultInfo.vault;
          farmPeriphery = vaultInfo.periphery;
          totalFarmCount++;
          break;
        }
      }

      if (farmFound) {
        console.log(`  ✅ ${dPoolId}:`);
        console.log(`    Vault: ${farmVault}`);
        console.log(`    Periphery: ${farmPeriphery}`);
        console.log(`    LP Token: ${curvePoolDeployment.address}`);

        // Verify periphery configuration
        try {
          const periphery = await ethers.getContractAt(
            "DPoolCurvePeriphery",
            farmPeriphery!,
            await ethers.getSigner(deployer as string),
          );

          const supportedAssets = await periphery.getSupportedAssets();
          const maxSlippage = await periphery.maxSlippageBps();

          console.log(`    Whitelisted Assets: ${supportedAssets.length}`);
          console.log(`    Max Slippage: ${maxSlippage} BPS`);

          if (supportedAssets.length === 0) {
            console.log(`    ⚠️  No assets whitelisted in periphery`);
          }
        } catch (error) {
          console.log(`    ⚠️  Failed to verify periphery: ${error}`);
        }
      } else {
        console.log(`  ❌ ${dPoolId}: Farm not found`);
      }
    } catch (error) {
      // If deployment name fails, try as address (testnet/mainnet)
      if (ethers.isAddress(dPoolConfig.pool)) {
        console.log(
          `  ℹ️  ${dPoolId}: Using external pool address ${dPoolConfig.pool} with error: ${error}`,
        );

        // Find farm by pool address for external pools
        let farmFound = false;
        let farmVault = null;
        let farmPeriphery = null;

        for (let i = 0; i < allVaults.length; i++) {
          const vaultInfo = await factory.getVaultInfo(allVaults[i]);

          if (vaultInfo.lpToken === dPoolConfig.pool) {
            farmFound = true;
            farmVault = vaultInfo.vault;
            farmPeriphery = vaultInfo.periphery;
            totalFarmCount++;
            break;
          }
        }

        if (farmFound) {
          console.log(`  ✅ ${dPoolId}:`);
          console.log(`    Vault: ${farmVault}`);
          console.log(`    Periphery: ${farmPeriphery}`);
          console.log(`    LP Token: ${dPoolConfig.pool}`);
        } else {
          console.log(`  ❌ ${dPoolId}: Farm not found for external pool`);
        }
      } else {
        console.log(
          `  ❌ ${dPoolId}: Pool deployment not found and not a valid address`,
        );
      }
    }
  }

  // Final system health check
  console.log(`\n🏥 System Health Check:`);

  const implementationCount =
    vaultImpl !== ethers.ZeroAddress && peripheryImpl !== ethers.ZeroAddress
      ? 1
      : 0;
  console.log(`  ✅ Implementations configured: ${implementationCount}/1`);
  console.log(`  ✅ Total operational farms: ${totalFarmCount}`);

  if (implementationCount === 1 && totalFarmCount > 0) {
    console.log(`\n🎉 dPOOL System deployment completed successfully!`);
    console.log(`\n📋 Usage Summary:`);
    console.log(
      `  • Advanced users can interact directly with vault contracts (LP tokens)`,
    );
    console.log(`  • Regular users can use periphery contracts (pool assets)`);
    console.log(`  • Each farm represents one LP token on one DEX`);
    console.log(`  • Factory pattern allows easy expansion to new DEXes`);
  } else {
    console.log(
      `\n⚠️  System deployment incomplete - please review errors above`,
    );
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-verify"];
func.dependencies = ["dpool-periphery-config"];
func.runAtTheEnd = true; // Ensure this runs after all other deployments

export default func;
