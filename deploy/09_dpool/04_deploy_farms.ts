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
    console.log("No dPool configuration found, skipping farm deployments");
    return;
  }

  console.log(`\n--- Deploying dPOOL Farms ---`);

  // Get factory deployment
  let factoryDeployment;
  try {
    factoryDeployment = await get("DPoolVaultFactory");
  } catch (error) {
    console.log(`⚠️  Failed to get DPoolVaultFactory deployment: ${error}`);
    console.log(`⚠️  Skipping farm deployments: factory not found`);
    return;
  }

  // Get factory contract instance
  const factory = await ethers.getContractAt(
    "DPoolVaultFactory",
    factoryDeployment.address,
    await ethers.getSigner(deployer as string)
  );

  // Deploy farms for each dPool instance (now one farm per pool)
  for (const [dPoolId, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Deploying Farm for ${dPoolId} ---`);

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

    // Check if farm already exists
    const allVaults = await factory.getAllVaults();
    
    let farmExists = false;
    for (let i = 0; i < allVaults.length; i++) {
      const vaultInfo = await factory.getVaultInfo(allVaults[i]);
      if (vaultInfo.lpToken === curvePoolDeployment.address) {
        console.log(`♻️  Farm already exists for ${dPoolId}`);
        console.log(`    Vault: ${vaultInfo.vault}`);
        console.log(`    Periphery: ${vaultInfo.periphery}`);
        farmExists = true;
        break;
      }
    }

    if (farmExists) {
      continue;
    }

    // Prepare farm configuration
    const vaultName = dPoolConfig.name;
    const vaultSymbol = dPoolConfig.symbol;
    const CURVE_DEX_TYPE = ethers.keccak256(ethers.toUtf8Bytes("CURVE"));

    // Get base asset index from pool config (default to 0 if not specified)
    const baseAssetIndex = dPoolConfig.poolConfig.baseAssetIndex || 0;

    // Encode pricing configuration for Curve
    const pricingConfig = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "int128", "address"],
      [
        baseAssetAddress, // baseAsset
        curvePoolDeployment.address, // pool
        baseAssetIndex, // baseAssetIndex  
        dPoolConfig.initialAdmin || deployer, // admin
      ]
    );

    console.log(`  Deploying farm:`);
    console.log(`    Name: ${vaultName}`);
    console.log(`    Symbol: ${vaultSymbol}`);
    console.log(`    LP Token: ${curvePoolDeployment.address}`);
    console.log(`    Base Asset: ${baseAssetAddress}`);
    console.log(`    Base Asset Index: ${baseAssetIndex}`);

    try {
      const tx = await factory.deployFarm(
        CURVE_DEX_TYPE,
        vaultName,
        vaultSymbol,
        curvePoolDeployment.address,
        pricingConfig
      );

      const receipt = await tx.wait();
      
      if (!receipt) {
        console.log(`  ⚠️  Transaction receipt is null for ${dPoolId}`);
        continue;
      }
      
      // Get the deployed addresses from the event
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed && parsed.name === "FarmDeployed";
        } catch {
          return false;
        }
      });

      if (event) {
        const parsed = factory.interface.parseLog(event);
        const { vault, periphery } = parsed!.args;
        
        console.log(`  ✅ Farm deployed successfully:`);
        console.log(`    Vault: ${vault}`);
        console.log(`    Periphery: ${periphery}`);
      } else {
        console.log(`  ✅ Farm deployed successfully (addresses not found in events)`);
      }
    } catch (error) {
      console.log(`  ⚠️  Failed to deploy farm for ${dPoolId}: ${error}`);
      continue;
    }
  }

  console.log(`