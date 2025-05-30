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
    console.log("No dPool configuration found, skipping periphery configuration");
    return;
  }

  console.log(`\n--- Configuring dPOOL Periphery Contracts ---`);

  // Get factory deployment
  let factoryDeployment;
  try {
    factoryDeployment = await get("DPoolVaultFactory");
  } catch (error) {
    console.log(`⚠️  Failed to get DPoolVaultFactory deployment: ${error}`);
    console.log(`⚠️  Skipping periphery configuration: factory not found`);
    return;
  }

  // Get factory contract instance
  const factory = await ethers.getContractAt(
    "DPoolVaultFactory",
    factoryDeployment.address,
    await ethers.getSigner(deployer as string)
  );

  // Configure periphery for each dPool instance (now one farm per pool)
  for (const [dPoolId, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Configuring Periphery for ${dPoolId} ---`);

    // Get base asset address
    const baseAssetAddress = config.tokenAddresses[
      dPoolConfig.baseAsset as keyof typeof config.tokenAddresses
    ];

    if (!baseAssetAddress) {
      console.log(
        `⚠️  Skipping ${dPoolId}: missing base asset address for ${dPoolConfig.baseAsset}`
      );
      continue;
    }

    // Get Curve pool deployment
    let curvePoolDeployment;
    try {
      curvePoolDeployment = await get(dPoolConfig.poolConfig.name);
    } catch (error) {
      console.log(`⚠️  Failed to get Curve pool deployment ${dPoolConfig.poolConfig.name}: ${error}`);
      console.log(`⚠️  Skipping ${dPoolId}: pool not found`);
      continue;
    }

    // Find the farm for this pool
    const allVaults = await factory.getAllVaults();
    let farmVault = null;
    let farmPeriphery = null;

    for (let i = 0; i < allVaults.length; i++) {
      const vaultInfo = await factory.getVaultInfo(allVaults[i]);
      if (vaultInfo.lpToken === curvePoolDeployment.address) {
        farmVault = vaultInfo.vault;
        farmPeriphery = vaultInfo.periphery;
        break;
      }
    }

    if (!farmVault || !farmPeriphery) {
      console.log(`⚠️  Farm not found for ${dPoolId}, skipping configuration`);
      continue;
    }

    console.log(`  Found farm:`);
    console.log(`    Vault: ${farmVault}`);
    console.log(`    Periphery: ${farmPeriphery}`);

    // Get periphery contract instance
    const periphery = await ethers.getContractAt(
      "DPoolCurvePeriphery",
      farmPeriphery,
      await ethers.getSigner(deployer as string)
    );

    // Get pool assets from the Curve pool
    const curvePool = await ethers.getContractAt(
      "ICurveStableSwapNG",
      curvePoolDeployment.address,
      await ethers.getSigner(deployer as string)
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
        
        if (currentSlippage.toString() !== dPoolConfig.initialSlippageBps.toString()) {
          console.log(`  Setting max slippage to ${dPoolConfig.initialSlippageBps} BPS`);
          const tx = await periphery.setMaxSlippage(dPoolConfig.initialSlippageBps);
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
func.dependencies = ["dpool-farms"];

export default func; 