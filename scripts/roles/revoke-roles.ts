import { getConfig } from "../../config/config";
import { scanRolesAndOwnership } from "./lib/scan";
import { SafeManager } from "../../typescript/safe/SafeManager";
import { SafeTransactionData } from "../../typescript/safe/types";

async function main() {
  const hre = require("hardhat");
  const { ethers, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const governance = config.walletAddresses.governanceMultisig;

  console.log(`\nScanning roles for revoke on ${hre.network.name}...`);
  const scan = await scanRolesAndOwnership(
    hre,
    deployer,
    governance,
    (m: string) => console.log(m)
  );

  // Build revocation transactions ONLY if governance already has DEFAULT_ADMIN_ROLE on the contract
  const txs: SafeTransactionData[] = [];
  let consideredContracts = 0;
  let addedOperations = 0;
  const revocationSummary: {
    contract: string;
    address: string;
    roles: { name: string; hash: string }[];
  }[] = [];

  for (const c of scan.rolesContracts) {
    if (!c.governanceHasDefaultAdmin) continue;
    consideredContracts++;
    console.log(`\nProcessing ${c.name} at ${c.address}`);

    const iface = new ethers.Interface(c.abi as any);
    // Only revoke if the DEPLOYER currently has the role (avoid spamming unnecessary txs)
    const rolesToRevoke: { name: string; hash: string }[] = [];
    for (const role of c.rolesHeldByDeployer) {
      console.log(`  - Queuing revokeRole(${role.name}) from deployer`);
      txs.push({
        to: c.address,
        value: "0",
        data: iface.encodeFunctionData("revokeRole", [role.hash, deployer]),
      });
      addedOperations++;
      rolesToRevoke.push({ name: role.name, hash: role.hash });
    }

    if (rolesToRevoke.length > 0) {
      revocationSummary.push({
        contract: c.name,
        address: c.address,
        roles: rolesToRevoke,
      });
    }
  }

  if (txs.length === 0) {
    console.log(
      "\nNo roles to revoke where governance has DEFAULT_ADMIN_ROLE."
    );
    return;
  }

  console.log(
    `\nCreating Safe batch with ${addedOperations} operations from ${consideredContracts} contracts...`
  );

  if (!config.safeConfig) {
    throw new Error("Missing safeConfig in current network config");
  }

  const safeManager = new SafeManager(hre, deployerSigner, {
    safeConfig: config.safeConfig,
    // offline-only mode enforced in SafeManager; no API kit or service
    signingMode: "none",
  });
  await safeManager.initialize();

  const res = await safeManager.createBatchTransaction({
    transactions: txs,
    description: `Revoke ${addedOperations} roles (governance has DEFAULT_ADMIN_ROLE)`,
  });

  if (!res.success) {
    console.error("Failed to create Safe batch:", res.error);
  } else {
    console.log(`\nBatch prepared. SafeTxHash: ${res.safeTxHash}`);
  }

  // Final summary of what will be revoked
  console.log("\n--- Revocations Summary ---");
  if (revocationSummary.length === 0) {
    console.log("No revocations planned.");
  } else {
    let totalRoles = 0;
    for (const item of revocationSummary) {
      console.log(`- ${item.contract} (${item.address})`);
      for (const r of item.roles) {
        console.log(
          `  - revokeRole(${r.name}) from deployer (hash: ${r.hash})`
        );
        totalRoles++;
      }
    }
    console.log(`Total roles to revoke: ${totalRoles}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
