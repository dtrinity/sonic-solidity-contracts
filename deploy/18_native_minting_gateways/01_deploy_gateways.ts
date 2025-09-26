import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const config = await getConfig(hre);

  // Skip if no native minting gateway configuration
  if (!config.nativeMintingGateways) {
    console.log("No native minting gateway configuration found for this network. Skipping deployment.");
    return true;
  }

  console.log(`\n🌉 ${__filename.split("/").slice(-2).join("/")}: Deploying native minting gateways...`);

  let deployedCount = 0;
  const totalGateways = Object.keys(config.nativeMintingGateways).length;

  // Deploy each configured gateway
  for (const [gatewayId, gatewayConfig] of Object.entries(config.nativeMintingGateways)) {
    console.log(`\n🔄 Deploying ${gatewayId}...`);
    console.log(`  Name: ${gatewayConfig.name}`);
    console.log(`  Wrapped Native Token: ${gatewayConfig.wNativeToken}`);
    console.log(`  dStable Issuer: ${gatewayConfig.dStableIssuer}`);
    console.log(`  dStable Redeemer: ${gatewayConfig.dStableRedeemer}`);
    console.log(`  dStable Token: ${gatewayConfig.dStableToken}`);
    console.log(`  Initial Owner: ${gatewayConfig.initialOwner}`);

    // Validate configuration
    if (!gatewayConfig.wNativeToken) {
      console.log(`⚠️  Skipping ${gatewayId}: missing wNativeToken address`);
      continue;
    }

    if (!gatewayConfig.dStableIssuer) {
      console.log(`⚠️  Skipping ${gatewayId}: missing dStableIssuer address`);
      continue;
    }

    if (!gatewayConfig.dStableRedeemer) {
      console.log(`⚠️  Skipping ${gatewayId}: missing dStableRedeemer address`);
      continue;
    }

    if (!gatewayConfig.dStableToken) {
      console.log(`⚠️  Skipping ${gatewayId}: missing dStableToken address`);
      continue;
    }

    if (!gatewayConfig.initialOwner) {
      console.log(`⚠️  Skipping ${gatewayId}: missing initialOwner address`);
      continue;
    }

    // Verify addresses are valid
    if (!hre.ethers.isAddress(gatewayConfig.wNativeToken)) {
      console.log(`⚠️  Skipping ${gatewayId}: invalid wNativeToken address ${gatewayConfig.wNativeToken}`);
      continue;
    }

    if (!hre.ethers.isAddress(gatewayConfig.dStableIssuer)) {
      console.log(`⚠️  Skipping ${gatewayId}: invalid dStableIssuer address ${gatewayConfig.dStableIssuer}`);
      continue;
    }

    if (!hre.ethers.isAddress(gatewayConfig.dStableRedeemer)) {
      console.log(`⚠️  Skipping ${gatewayId}: invalid dStableRedeemer address ${gatewayConfig.dStableRedeemer}`);
      continue;
    }

    if (!hre.ethers.isAddress(gatewayConfig.dStableToken)) {
      console.log(`⚠️  Skipping ${gatewayId}: invalid dStableToken address ${gatewayConfig.dStableToken}`);
      continue;
    }

    if (!hre.ethers.isAddress(gatewayConfig.initialOwner)) {
      console.log(`⚠️  Skipping ${gatewayId}: invalid initialOwner address ${gatewayConfig.initialOwner}`);
      continue;
    }

    try {
      // Deploy the NativeMintingGateway
      const gatewayDeployment = await deploy(gatewayId, {
        from: deployer,
        contract: "NativeMintingGateway",
        args: [gatewayConfig.wNativeToken, gatewayConfig.dStableIssuer, gatewayConfig.dStableRedeemer, gatewayConfig.dStableToken, gatewayConfig.initialOwner],
        log: true,
        autoMine: true,
        skipIfAlreadyDeployed: true,
      });

      if (gatewayDeployment.newlyDeployed) {
        console.log(`  ✅ Deployed ${gatewayConfig.name}: ${gatewayDeployment.address}`);
        deployedCount++;
      } else {
        console.log(`  ♻️  Reusing existing ${gatewayConfig.name}: ${gatewayDeployment.address}`);
        deployedCount++;
      }

      // Verify deployment by checking the contract state
      try {
        const gateway = await hre.ethers.getContractAt("NativeMintingGateway", gatewayDeployment.address);
        const contractWNative = await gateway.W_NATIVE_TOKEN();
        const contractIssuer = await gateway.DSTABLE_ISSUER();
        const contractRedeemer = await gateway.DSTABLE_REDEEMER();
        const contractToken = await gateway.DSTABLE_TOKEN();
        const contractOwner = await gateway.owner();

        console.log(`  🔍 Verification:`);
        console.log(`    W_NATIVE_TOKEN: ${contractWNative === gatewayConfig.wNativeToken ? "✅" : "❌"} ${contractWNative}`);
        console.log(`    DSTABLE_ISSUER: ${contractIssuer === gatewayConfig.dStableIssuer ? "✅" : "❌"} ${contractIssuer}`);
        console.log(`    DSTABLE_REDEEMER: ${contractRedeemer === gatewayConfig.dStableRedeemer ? "✅" : "❌"} ${contractRedeemer}`);
        console.log(`    DSTABLE_TOKEN: ${contractToken === gatewayConfig.dStableToken ? "✅" : "❌"} ${contractToken}`);
        console.log(`    OWNER: ${contractOwner === gatewayConfig.initialOwner ? "✅" : "❌"} ${contractOwner}`);

        // Verify all parameters match
        if (
          contractWNative === gatewayConfig.wNativeToken &&
          contractIssuer === gatewayConfig.dStableIssuer &&
          contractRedeemer === gatewayConfig.dStableRedeemer &&
          contractToken === gatewayConfig.dStableToken &&
          contractOwner === gatewayConfig.initialOwner
        ) {
          console.log(`  ✅ ${gatewayId} verification passed`);
        } else {
          console.log(`  ❌ ${gatewayId} verification failed - configuration mismatch`);
          throw new Error(`Deployment verification failed for ${gatewayId}`);
        }
      } catch (verifyError) {
        console.log(`  ⚠️  Could not verify ${gatewayId} deployment: ${verifyError}`);
      }
    } catch (error) {
      console.log(`  ❌ Failed to deploy ${gatewayId}: ${error}`);
      continue;
    }
  }

  // Summary
  console.log(`\n📊 Native Minting Gateway Deployment Summary:`);
  console.log(`  Total configured: ${totalGateways}`);
  console.log(`  Successfully deployed: ${deployedCount}`);
  console.log(`  Success rate: ${totalGateways > 0 ? Math.round((deployedCount / totalGateways) * 100) : 0}%`);

  if (deployedCount === totalGateways && totalGateways > 0) {
    console.log(`\n🎉 All native minting gateways deployed successfully!`);
  } else if (deployedCount > 0) {
    console.log(`\n⚠️  Partial deployment completed - ${totalGateways - deployedCount} gateways skipped`);
  } else {
    console.log(`\n❌ No gateways were deployed`);
  }

  console.log(`\n🌉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "deploy_native_minting_gateways";
func.tags = ["native-minting-gateways", "gateways"];
func.dependencies = ["ds", "setup-issuerv2", "setup-redeemerv2"]; // Depends on dStable tokens, IssuerV2, and RedeemerV2 being deployed

export default func;
