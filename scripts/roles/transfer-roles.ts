import { getConfig } from "../../config/config";
import { scanRolesAndOwnership } from "./lib/scan";
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

  let addedOperations = 0;
  const summary: { contract: string; address: string; ops: string[] }[] = [];

  // Roles: grant to governance first, then revoke from deployer (non-admin first, admin last)
  for (const c of scan.rolesContracts) {
    const opsForContract: string[] = [];

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
        `  - Grant ${role.name} to governance, then renounce from deployer`
      );
      addedOperations += 2;
      opsForContract.push(
        `grantRole(${role.name})->${governance}`,
        `renounceRole(${role.name})->${deployer}`
      );
    }

    // Admin role last
    if (adminRole) {
      console.log(
        `  - Transfer DEFAULT_ADMIN_ROLE to governance and renounce from deployer`
      );
      addedOperations += 2;
      opsForContract.push(
        `grantRole(DEFAULT_ADMIN_ROLE)->${governance}`,
        `renounceRole(DEFAULT_ADMIN_ROLE)->${deployer}`
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
    addedOperations += 1;
    summary.push({
      contract: c.name,
      address: c.address,
      ops: ["transferOwnership->governance"],
    });
  }

  if (addedOperations === 0) {
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
      rl.question(
        "\nProceed to execute on-chain migrations? (yes/no): ",
        resolve
      )
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Aborted by user.");
      return;
    }
  }

  console.log(`\nExecuting on-chain migrations with deployer signer...`);

  // Execute AccessControl migrations: non-admin roles first, then admin role
  for (const c of scan.rolesContracts) {
    const contract = await ethers.getContractAt(
      c.abi as any,
      c.address,
      deployerSigner
    );

    // Non-admin roles
    const nonAdminRolesHeldByDeployer = c.rolesHeldByDeployer.filter(
      (r) => r.name !== "DEFAULT_ADMIN_ROLE"
    );
    for (const role of nonAdminRolesHeldByDeployer) {
      try {
        const governanceHasRole: boolean = await contract.hasRole(
          role.hash,
          governance
        );
        if (!governanceHasRole) {
          console.log(
            `Granting ${role.name} to governance on ${c.name} (${c.address})...`
          );
          const tx = await contract.grantRole(role.hash, governance);
          await tx.wait();
        } else {
          console.log(
            `Governance already has ${role.name} on ${c.name}; skipping grant.`
          );
        }

        const deployerHasRole: boolean = await contract.hasRole(
          role.hash,
          deployer
        );
        if (deployerHasRole) {
          console.log(
            `Renouncing ${role.name} from deployer on ${c.name} (${c.address})...`
          );
          const tx2 = await contract.renounceRole(role.hash, deployer);
          await tx2.wait();
        } else {
          console.log(
            `Deployer does not hold ${role.name} on ${c.name}; skipping renounce.`
          );
        }
      } catch (e) {
        console.error(
          `Error migrating role ${role.name} on ${c.name} (${c.address}):`,
          e
        );
      }
    }

    // Admin role last
    const adminRole = c.rolesHeldByDeployer.find(
      (r) => r.name === "DEFAULT_ADMIN_ROLE"
    );
    if (adminRole) {
      try {
        const governanceHasAdmin: boolean = await contract.hasRole(
          adminRole.hash,
          governance
        );
        if (!governanceHasAdmin) {
          console.log(
            `Granting DEFAULT_ADMIN_ROLE to governance on ${c.name} (${c.address})...`
          );
          const tx = await contract.grantRole(adminRole.hash, governance);
          await tx.wait();
        } else {
          console.log(
            `Governance already has DEFAULT_ADMIN_ROLE on ${c.name}; skipping grant.`
          );
        }

        const deployerHasAdmin: boolean = await contract.hasRole(
          adminRole.hash,
          deployer
        );
        if (deployerHasAdmin) {
          console.log(
            `Renouncing DEFAULT_ADMIN_ROLE from deployer on ${c.name} (${c.address})...`
          );
          const tx2 = await contract.renounceRole(adminRole.hash, deployer);
          await tx2.wait();
        } else {
          console.log(
            `Deployer does not hold DEFAULT_ADMIN_ROLE on ${c.name}; skipping renounce.`
          );
        }
      } catch (e) {
        console.error(
          `Error migrating DEFAULT_ADMIN_ROLE on ${c.name} (${c.address}):`,
          e
        );
      }
    }
  }

  // Execute Ownable migrations: transfer ownership to governance
  for (const c of scan.ownableContracts) {
    if (!c.deployerIsOwner) continue;
    try {
      const contract = await ethers.getContractAt(
        c.abi as any,
        c.address,
        deployerSigner
      );
      const currentOwner: string = await contract.owner();
      if (currentOwner.toLowerCase() === governance.toLowerCase()) {
        console.log(
          `Governance already owns ${c.name} (${c.address}); skipping.`
        );
        continue;
      }
      console.log(
        `Transferring ownership of ${c.name} (${c.address}) to governance...`
      );
      const tx = await contract.transferOwnership(governance);
      await tx.wait();
    } catch (e) {
      console.error(
        `Error transferring ownership for ${c.name} (${c.address}):`,
        e
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
