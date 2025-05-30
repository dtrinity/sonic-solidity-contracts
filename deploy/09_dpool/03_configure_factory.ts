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
    console.log("No dPool configuration found, skipping factory configuration");
    return;
  }

  console.log(`\n--- Configuring DPoolVaultFactory ---`);

  // Get deployments
  let factoryDeployment, curveVaultImpl, curvePeripheryImpl;

  try {
    factoryDeployment = await get("DPoolVaultFactory");
    curveVaultImpl = await get("DPoolVaultCurveLP_Implementation");
    curvePeripheryImpl = await get("DPoolCurvePeriphery_Implementation");
  } catch (error) {
    console.log(`⚠️  Failed to get required deployments: ${error}`);
    console.log(`⚠️  Skipping factory configuration: deployments not found`);
    return;
  }

  // Get factory contract instance
  const factory = await ethers.getContractAt(
    "DPoolVaultFactory",
    factoryDeployment.address,
    await ethers.getSigner(deployer)
  );

  console.log(`Configuring factory at: ${factoryDeployment.address}`);
  console.log(`  Curve Vault Implementation: ${curveVaultImpl.address}`);
  console.log(`  Curve Periphery Implementation: ${curvePeripheryImpl.address}`);

  // Set Curve implementations in factory
  const CURVE_DEX_TYPE = ethers.keccak256(ethers.toUtf8Bytes("CURVE"));

  // Set vault implementation
  try {
    const currentVaultImpl = await factory.vaultImplementations(CURVE_DEX_TYPE);
    
    if (currentVaultImpl === ethers.ZeroAddress) {
      console.log(`Setting Curve vault implementation...`);
      const tx1 = await factory.setVaultImplementation(CURVE_DEX_TYPE, curveVaultImpl.address);
      await tx1.wait();
      console.log(`✅ Curve vault implementation set`);
    } else {
      console.log(`♻️  Curve vault implementation already set: ${currentVaultImpl}`);
    }
  } catch (error) {
    console.log(`⚠️  Failed to set vault implementation: ${error}`);
    return;
  }

  // Set periphery implementation
  try {
    const currentPeripheryImpl = await factory.peripheryImplementations(CURVE_DEX_TYPE);
    
    if (currentPeripheryImpl === ethers.ZeroAddress) {
      console.log(`Setting Curve periphery implementation...`);
      const tx2 = await factory.setPeripheryImplementation(CURVE_DEX_TYPE, curvePeripheryImpl.address);
      await tx2.wait();
      console.log(`✅ Curve periphery implementation set`);
    } else {
      console.log(`♻️  Curve periphery implementation already set: ${currentPeripheryImpl}`);
    }
  } catch (error) {
    console.log(`⚠️  Failed to set periphery implementation: ${error}`);
    return;
  }

  console.log(`✅ Factory configuration complete!`);
  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-factory-config"];
func.dependencies = ["dpool-implementations"];

export default func; 