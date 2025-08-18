import { getConfig } from "../../config/config";
import { scanRolesAndOwnership } from "./lib/scan";
import { SafeManager } from "../../typescript/safe/SafeManager";
import { SafeTransactionData } from "../../typescript/safe/types";
import * as readline from "readline";

async function main() {
  const hre = require("hardhat");
  const { ethers, getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);
  const governance = config.walletAddresses.governanceMultisig;

  console.log(
    `\nScanning roles/ownership for transfer on ${hre.network.name}...`
  );
  const scan = await scanRolesAndOwnership(
    hre,
    deployer,
    governance,
    (m: string) => console.log(m)
  );

  const txs: SafeTransactionData[] = [];
  let addedOperations = 0;
  const summary: { contract: string; address: string; ops: string[] }[] = [];

  // Roles: grant to governance first, then revoke from deployer (non-admin first, admin last)
  for (const c of scan.rolesContracts) {
    const opsForContract: string[] = [];
    const iface = new ethers.Interface(c.abi as any);

    const nonAdminRolesHeldByDeployer = c.rolesHeldByDeployer.filter(
      (r) => r.name !== "DEFAULT_ADMIN_ROLE"
    );
    const adminRole = c.rolesHeldByDeployer.find(
      (r) => r.name === "DEFAULT_ADMIN_ROLE"
    );

    if (nonAdminRolesHeldByDeployer.length > 0 || adminRole) {
      console.log(`\nProcessing ${c.name} at ${c.address}`);
    }

    // Non-admin roles
    for (const role of nonAdminRolesHeldByDeployer) {
      console.log(
        `  - Grant ${role.name} to governance, then revoke from deployer`
      );
      txs.push({
        to: c.address,
        value: "0",
        data: iface.encodeFunctionData("grantRole", [role.hash, governance]),
      });
      txs.push({
        to: c.address,
        value: "0",
        data: iface.encodeFunctionData("revokeRole", [role.hash, deployer]),
      });
      addedOperations += 2;
      opsForContract.push(
        `grantRole(${role.name})->${governance}`,
        `revokeRole(${role.name})->${deployer}`
      );
    }

    // Admin role last
    if (adminRole) {
      console.log(
        `  - Transfer DEFAULT_ADMIN_ROLE to governance and revoke from deployer`
      );
      txs.push({
        to: c.address,
        value: "0",
        data: iface.encodeFunctionData("grantRole", [
          adminRole.hash,
          governance,
        ]),
      });
      txs.push({
        to: c.address,
        value: "0",
        data: iface.encodeFunctionData("revokeRole", [
          adminRole.hash,
          deployer,
        ]),
      });
      addedOperations += 2;
      opsForContract.push(
        `grantRole(DEFAULT_ADMIN_ROLE)->${governance}`,
        `revokeRole(DEFAULT_ADMIN_ROLE)->${deployer}`
      );
    }

    if (opsForContract.length > 0) {
      summary.push({
        contract: c.name,
        address: c.address,
        ops: opsForContract,
      });
    }
  }

  // Ownable: transferOwnership to governance when deployer is owner
  for (const c of scan.ownableContracts) {
    if (!c.deployerIsOwner) continue;
    console.log(
      `\nTransferring ownership of ${c.name} at ${c.address} to governance`
    );
    const iface = new ethers.Interface(c.abi as any);
    txs.push({
      to: c.address,
      value: "0",
      data: iface.encodeFunctionData("transferOwnership", [governance]),
    });
    addedOperations += 1;
    summary.push({
      contract: c.name,
      address: c.address,
      ops: ["transferOwnership->governance"],
    });
  }

  if (txs.length === 0) {
    console.log("\nNothing to transfer.");
    return;
  }

  // Print final change summary
  console.log("\n--- Planned Changes Summary ---");
  for (const s of summary) {
    console.log(`- ${s.contract} (${s.address})`);
    for (const op of s.ops) console.log(`  • ${op}`);
  }
  console.log(`Total operations: ${addedOperations}`);

  // Confirmation prompt (skip with --yes)
  if (!process.argv.includes("--yes")) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer: string = await new Promise((resolve) =>
      rl.question("\nProceed to create Safe batch? (yes/no): ", resolve)
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Aborted by user.");
      return;
    }
  }

  console.log(`\nCreating Safe batch with ${addedOperations} operations...`);

  if (!config.safeConfig) {
    throw new Error("Missing safeConfig in current network config");
  }

  // Create Safe batch in no-sign mode
  const safeManager = new SafeManager(hre, deployerSigner, {
    safeConfig: config.safeConfig,
    enableApiKit: true,
    enableTransactionService: true,
    signingMode: "none",
  });
  await safeManager.initialize();

  const res = await safeManager.createBatchTransaction({
    transactions: txs,
    description: `Transfer roles/ownership from deployer to governance (${txs.length} ops)`,
  });

  if (!res.success) {
    console.error("Failed to create Safe batch:", res.error);
  } else {
    console.log(`\nBatch prepared. SafeTxHash: ${res.safeTxHash}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
