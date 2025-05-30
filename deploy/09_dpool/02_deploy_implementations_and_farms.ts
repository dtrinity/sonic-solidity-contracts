import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log("No dPool configuration found, skipping dPOOL deployment");
    return;
  }

  console.log(`\n--- Deploying dPOOL Implementations & Farms ---`);

  // Get factory deployment
  let factoryDeployment;
  try {
    factoryDeployment = await get("DPoolVaultFactory");
  } catch (error) {
    console.log(`⚠️  Failed to get DPoolVaultFactory deployment: ${error}`);
    console.log(`⚠️  Skipping dPOOL deployment: factory not found`);
    return;
  }

  // Get factory contract instance
  const factory = await ethers.getContractAt(
    "DPoolVaultFactory",
    factoryDeployment.address,
    await ethers.getSigner(deployer as string)
  );

  // --- Step 1: Deploy Implementations ---
  console.log(`\n--- Deploying Implementations ---`);

  // Deploy Curve vault implementation with dummy values (it's just a template)
  console.log(`Deploying Curve Vault Implementation...`);
  const curveVaultImpl = await deploy("DPoolVaultCurveLP_Implementation", {
    contract: "DPoolVaultCurveLP",
    from: deployer,
    args: [
      deployer, // baseAsset (dummy - implementations use dummy values)
      deployer, // lpToken (dummy - implementations use dummy values)
      deployer, // pool (dummy - implementations use dummy values)
      "dPOOL Implementation", // name (dummy)
      "dPOOL_IMPL", // symbol (dummy)
      deployer, // admin (dummy)
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (curveVaultImpl.newlyDeployed) {
    console.log(`✅ Deployed Curve Vault Implementation at: ${curveVaultImpl.address}`);
  } else {
    console.log(`♻️  Reusing existing Curve Vault Implementation at: ${curveVaultImpl.address}`);
  }

  // Deploy Curve periphery implementation with dummy values (it's just a template)
  console.log(`Deploying Curve Periphery Implementation...`);
  const curvePeripheryImpl = await deploy("DPoolCurvePeriphery_Implementation", {
    contract: "DPoolCurvePeriphery",
    from: deployer,
    args: [
      deployer, // vault (dummy - implementations use dummy values)
      deployer, // pool (dummy - implementations use dummy values)
      deployer, // admin (dummy)
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  if (curvePeripheryImpl.newlyDeployed) {
    console.log(`✅ Deployed Curve Periphery Implementation at: ${curvePeripheryImpl.address}`);
  } else {
    console.log(`♻️  Reusing existing Curve Periphery Implementation at: ${curvePeripheryImpl.address}`);
  }

  // --- Step 2: Configure Factory with Implementations ---
  console.log(`\n--- Configuring Factory ---`);

  const CURVE_DEX_TYPE = ethers.keccak256(ethers.toUtf8Bytes("CURVE"));
  
  // Check if implementations are already set
  const currentVaultImpl = await factory.vaultImplementations(CURVE_DEX_TYPE);
  const currentPeripheryImpl = await factory.peripheryImplementations(CURVE_DEX_TYPE);

  if (currentVaultImpl === ethers.ZeroAddress || currentPeripheryImpl === ethers.ZeroAddress) {
    console.log(`Setting Curve implementations in factory...`);
    
    // Set vault implementation
    if (currentVaultImpl === ethers.ZeroAddress) {
      const vaultTx = await factory.setVaultImplementation(
        CURVE_DEX_TYPE,
        curveVaultImpl.address
      );
      await vaultTx.wait();
      console.log(`✅ Vault implementation set`);
    }
    
    // Set periphery implementation  
    if (currentPeripheryImpl === ethers.ZeroAddress) {
      const peripheryTx = await factory.setPeripheryImplementation(
        CURVE_DEX_TYPE,
        curvePeripheryImpl.address
      );
      await peripheryTx.wait();
      console.log(`✅ Periphery implementation set`);
    }
    
    console.log(`✅ Factory configured with Curve implementations`);
  } else {
    console.log(`♻️  Factory already configured with Curve implementations`);
  }

  // --- Step 3: Deploy Farms ---
  console.log(`\n--- Deploying Farms ---`);

  // Deploy farms for each dPool instance
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
      // Try to get by deployment name first (localhost)
      curvePoolDeployment = await get(dPoolConfig.pool);
    } catch (error) {
      // If deployment name fails, assume it's an address (testnet/mainnet)
      if (ethers.isAddress(dPoolConfig.pool)) {
        curvePoolDeployment = { address: dPoolConfig.pool };
        console.log(`Using external pool address: ${dPoolConfig.pool}`);
      } else {
        console.log(`⚠️  Failed to get Curve pool deployment ${dPoolConfig.pool}: ${error}`);
        console.log(`⚠️  Skipping ${dPoolId}: pool not found`);
        continue;
      }
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

    // Encode pricing configuration for Curve
    const pricingConfig = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address"],
      [
        baseAssetAddress, // baseAsset
        curvePoolDeployment.address, // pool
        dPoolConfig.initialAdmin || deployer, // admin
      ]
    );

    console.log(`  Deploying farm:`);
    console.log(`    Name: ${vaultName}`);
    console.log(`    Symbol: ${vaultSymbol}`);
    console.log(`    LP Token: ${curvePoolDeployment.address}`);
    console.log(`    Base Asset: ${baseAssetAddress}`);
    console.log(`    Pool: ${curvePoolDeployment.address}`);

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

  console.log(`\n✅ All implementations and farms deployed successfully!`);
  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-implementations", "dpool-farms"];
func.dependencies = ["dpool-factory"];

export default func; 