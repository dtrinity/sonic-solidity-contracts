import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getConfig } from "../../config/config";
import { SafeManager } from "../../typescript/safe/SafeManager";
import { SafeTransactionData } from "../../typescript/safe/types";

/**
 * Utility script to propose governance transactions to Safe
 * 
 * Usage examples:
 * 
 * Single transaction:
 * npx hardhat run scripts/safe/propose-governance-transaction.ts --network sonic_mainnet
 * 
 * Multiple transactions (batch):
 * npx hardhat run scripts/safe/propose-governance-transaction.ts --network sonic_mainnet
 */

async function main() {
  console.log("🚀 Safe Governance Transaction Proposal Utility");
  console.log("===============================================");

  const hre: HardhatRuntimeEnvironment = require("hardhat");
  const { ethers } = hre;
  const config = await getConfig(hre);

  if (!config.safeConfig) {
    throw new Error("Safe configuration not found in network config");
  }

  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);

  // Initialize Safe Manager
  const safeManager = new SafeManager(hre, deployerSigner, {
    safeConfig: config.safeConfig,
    enableApiKit: true,
    enableTransactionService: true
  });

  await safeManager.initialize();

  // Example transactions - Replace with actual operations
  const exampleTransactions: SafeTransactionData[] = [
    {
      to: "0x1234567890123456789012345678901234567890", // Replace with actual contract address
      value: "0",
      data: "0x095ea7b3000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001" // Replace with actual encoded function call
    }
  ];

  console.log("\n📋 Transaction Details:");
  console.log(`   Safe Address: ${safeManager.getSafeAddress()}`);
  console.log(`   Threshold: ${await safeManager.getThreshold()}`);
  console.log(`   Number of transactions: ${exampleTransactions.length}`);

  // Create single transaction or batch
  let result;
  if (exampleTransactions.length === 1) {
    console.log("\n🔄 Creating single Safe transaction...");
    result = await safeManager.createTransaction(
      exampleTransactions[0],
      "Example governance transaction"
    );
  } else {
    console.log("\n🔄 Creating batch Safe transaction...");
    result = await safeManager.createBatchTransaction({
      transactions: exampleTransactions,
      description: "Example governance batch transaction"
    });
  }

  // Handle result
  if (result.success) {
    console.log("\n✅ Transaction created successfully!");
    
    if (result.transactionHash) {
      console.log(`   Executed immediately with hash: ${result.transactionHash}`);
    } else if (result.safeTxHash) {
      console.log(`   Safe transaction hash: ${result.safeTxHash}`);
      
      if (result.requiresAdditionalSignatures) {
        console.log("\n⏳ Transaction is pending additional signatures.");
        console.log("   Other Safe owners need to review and sign this transaction.");
        console.log(`   Track progress at: ${config.safeConfig.txServiceUrl || "Safe Transaction Service (if available)"}`);
      }
    }
  } else {
    console.log("\n❌ Transaction creation failed:");
    console.log(`   Error: ${result.error}`);
  }

  console.log("\n📊 Current Safe Status:");
  const owners = await safeManager.getOwners();
  console.log(`   Owners: ${owners.length}`);
  owners.forEach((owner, index) => {
    console.log(`     ${index + 1}. ${owner}`);
  });

  console.log("\n✅ Governance transaction proposal completed.");
}

/**
 * Helper function to create role grant transaction
 */
export function createGrantRoleTransaction(
  contractAddress: string,
  roleHash: string,
  account: string,
  contractInterface: any
): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("grantRole", [roleHash, account])
  };
}

/**
 * Helper function to create role revoke transaction
 */
export function createRevokeRoleTransaction(
  contractAddress: string,
  roleHash: string,
  account: string,
  contractInterface: any
): SafeTransactionData {
  return {
    to: contractAddress,
    value: "0",
    data: contractInterface.encodeFunctionData("revokeRole", [roleHash, account])
  };
}

/**
 * Helper function to create minter role grant transaction
 */
export function createGrantMinterRoleTransaction(
  tokenAddress: string,
  minter: string,
  tokenInterface: any
): SafeTransactionData {
  // MINTER_ROLE is typically keccak256("MINTER_ROLE")
  const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
  
  return createGrantRoleTransaction(tokenAddress, MINTER_ROLE, minter, tokenInterface);
}

/**
 * Helper function to create asset minting pause transaction
 */
export function createSetAssetMintingPauseTransaction(
  issuerAddress: string,
  assetAddress: string,
  paused: boolean,
  issuerInterface: any
): SafeTransactionData {
  return {
    to: issuerAddress,
    value: "0",
    data: issuerInterface.encodeFunctionData("setAssetMintingPause", [assetAddress, paused])
  };
}

// Run the script if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}