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

  // Verify each dPool configuration
  let totalDeployedCount = 0;
  const deployedPools: string[] = [];

  for (const [dPoolId, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Verifying ${dPoolId} ---`);

    const vaultDeploymentName = `DPoolVault_${dPoolId}`;
    const peripheryDeploymentName = `DPoolPeriphery_${dPoolId}`;

    let vaultDeployment;
    let peripheryDeployment;
    let poolAddress;

    try {
      // Get vault deployment
      vaultDeployment = await get(vaultDeploymentName);

      // Get periphery deployment
      peripheryDeployment = await get(peripheryDeploymentName);

      // Get pool address
      try {
        const poolDeployment = await get(dPoolConfig.pool);
        poolAddress = poolDeployment.address;
      } catch {
        // If deployment name fails, assume it's an address (testnet/mainnet)
        if (ethers.isAddress(dPoolConfig.pool)) {
          poolAddress = dPoolConfig.pool;
        } else {
          throw new Error(`Pool not found: ${dPoolConfig.pool}`);
        }
      }

      console.log(`  ✅ ${dPoolId}:`);
      console.log(`    Vault: ${vaultDeployment.address}`);
      console.log(`    Periphery: ${peripheryDeployment.address}`);
      console.log(`    Pool: ${poolAddress}`);
      console.log(`    Base Asset: ${dPoolConfig.baseAsset}`);

      // Verify periphery configuration
      try {
        const periphery = await ethers.getContractAt(
          "DPoolCurvePeriphery",
          peripheryDeployment.address,
          await ethers.getSigner(deployer as string),
        );

        const supportedAssets = await periphery.getSupportedAssets();
        const maxSlippage = await periphery.maxSlippageBps();
        const vaultAddress = await periphery.vault();

        console.log(`    Whitelisted Assets: ${supportedAssets.length}`);
        console.log(`    Max Slippage: ${maxSlippage} BPS`);
        console.log(
          `    Vault Connection: ${vaultAddress === vaultDeployment.address ? "✅" : "❌"}`,
        );

        if (supportedAssets.length === 0) {
          console.log(`    ⚠️  No assets whitelisted in periphery`);
        }

        if (vaultAddress !== vaultDeployment.address) {
          console.log(
            `    ⚠️  Periphery vault mismatch: expected ${vaultDeployment.address}, got ${vaultAddress}`,
          );
        }
      } catch (error) {
        console.log(`    ⚠️  Failed to verify periphery: ${error}`);
      }

      totalDeployedCount++;
      deployedPools.push(dPoolId);
    } catch (error) {
      console.log(`  ❌ ${dPoolId}: Deployment not found or incomplete`);
      console.log(`    Error: ${error}`);
    }
  }

  // Final system health check
  console.log(`\n🏥 System Health Check:`);
  console.log(
    `  ✅ Total dPOOL configurations: ${Object.keys(config.dPool).length}`,
  );
  console.log(`  ✅ Successfully deployed: ${totalDeployedCount}`);
  console.log(
    `  ✅ Deployment success rate: ${Math.round((totalDeployedCount / Object.keys(config.dPool).length) * 100)}%`,
  );

  if (deployedPools.length > 0) {
    console.log(`\n📋 Deployed Pools:`);

    for (const poolId of deployedPools) {
      console.log(`  • ${poolId}`);
    }
  }

  if (totalDeployedCount === Object.keys(config.dPool).length) {
    console.log(`\n🎉 dPOOL System deployment completed successfully!`);
  } else {
    console.log(
      `\n⚠️  System deployment incomplete - please review errors above`,
    );
    const failedCount = Object.keys(config.dPool).length - totalDeployedCount;
    console.log(`  • Failed deployments: ${failedCount}`);
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-verify"];
func.dependencies = ["dpool-periphery-config"];
func.runAtTheEnd = true;

export default func;
