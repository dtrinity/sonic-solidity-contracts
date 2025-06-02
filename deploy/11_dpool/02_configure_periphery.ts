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
      "No dPool configuration found, skipping periphery configuration",
    );
    return;
  }

  console.log(`\n--- Configuring dPOOL Periphery Contracts ---`);

  // Configure periphery for each dPool instance
  for (const [dPoolId, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Configuring Periphery for ${dPoolId} ---`);

    // Get periphery deployment
    const peripheryDeploymentName = `DPoolPeriphery_${dPoolId}`;
    let peripheryDeployment;

    try {
      peripheryDeployment = await get(peripheryDeploymentName);
    } catch (error) {
      console.log(
        `⚠️  Periphery deployment ${peripheryDeploymentName} not found: ${error}`,
      );
      console.log(`⚠️  Skipping ${dPoolId}: periphery not deployed`);
      continue;
    }

    console.log(`  Found periphery: ${peripheryDeployment.address}`);

    // Determine the correct signer for admin operations (same pattern as dStake)
    const initialAdmin = dPoolConfig.initialAdmin;
    const adminSigner = initialAdmin === deployer ? deployer : initialAdmin;

    // Get periphery contract instance with the appropriate signer
    const periphery = await ethers.getContractAt(
      "DPoolCurvePeriphery",
      peripheryDeployment.address,
      await ethers.getSigner(adminSigner),
    );

    // Get Curve pool deployment
    let curvePoolDeployment;

    try {
      // Try to get by deployment name first (localhost)
      curvePoolDeployment = await get(dPoolConfig.pool);
    } catch (error) {
      // If deployment name fails, assume it's an address (testnet/mainnet)
      if (ethers.isAddress(dPoolConfig.pool)) {
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

    // Get pool assets from the Curve pool
    const curvePool = await ethers.getContractAt(
      "ICurveStableSwapNG",
      curvePoolDeployment.address,
      await ethers.getSigner(deployer), // Use deployer for read-only calls
    );

    const asset0 = await curvePool.coins(0);
    const asset1 = await curvePool.coins(1);

    console.log(`  Pool assets:`);
    console.log(`    Asset 0: ${asset0}`);
    console.log(`    Asset 1: ${asset1}`);

    // Whitelist both pool assets
    for (const asset of [asset0, asset1]) {
      try {
        const isWhitelisted = await periphery.isAssetWhitelisted(asset);

        if (!isWhitelisted) {
          console.log(`  Whitelisting asset: ${asset}`);
          const tx = await periphery.addWhitelistedAsset(asset);
          await tx.wait();
          console.log(`  ✅ Asset whitelisted: ${asset}`);
        } else {
          console.log(`  ♻️  Asset already whitelisted: ${asset}`);
        }
      } catch (error) {
        console.log(`  ⚠️  Failed to whitelist asset ${asset}: ${error}`);
      }
    }

    // Set maximum slippage if specified in config
    if (dPoolConfig.initialSlippageBps) {
      try {
        const currentSlippage = await periphery.maxSlippageBps();

        if (
          currentSlippage.toString() !==
          dPoolConfig.initialSlippageBps.toString()
        ) {
          console.log(
            `  Setting max slippage to ${dPoolConfig.initialSlippageBps} BPS`,
          );
          const tx = await periphery.setMaxSlippage(
            dPoolConfig.initialSlippageBps,
          );
          await tx.wait();
          console.log(`  ✅ Max slippage set`);
        } else {
          console.log(`  ♻️  Max slippage already set: ${currentSlippage} BPS`);
        }
      } catch (error) {
        console.log(`  ⚠️  Failed to set max slippage: ${error}`);
      }
    }

    console.log(`  ✅ Periphery configuration complete for ${dPoolId}`);
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-periphery-config"];
func.dependencies = ["dpool-vaults", "dpool-peripheries"];

export default func;
