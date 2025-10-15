#!/usr/bin/env ts-node

import { Command } from 'commander';
import * as readline from 'readline';
import { scanRolesAndOwnership } from '../../lib/roles/scan';
import { logger } from '../../lib/logger';

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Transfer roles and ownership from deployer to governance multisig.')
    .requiredOption('-n, --network <name>', 'Network to operate on')
    .requiredOption('-d, --deployer <address>', 'Deployer address (current role holder)')
    .requiredOption('-g, --governance <address>', 'Governance multisig address (new role holder)')
    .option('--deployments-dir <path>', 'Path to deployments directory (defaults to ./deployments)')
    .option('--yes', 'Skip confirmation prompt and execute immediately')
    .option('--hardhat-config <path>', 'Path to hardhat.config.ts (defaults to ./hardhat.config.ts)');

  program.parse(process.argv);
  const options = program.opts();

  try {
    // Dynamically load hardhat runtime environment
    process.env.HARDHAT_NETWORK = options.network;
    const hre = require('hardhat');
    const { ethers } = hre;

    const deployer: string = options.deployer;
    const governance: string = options.governance;
    const deployerSigner = await ethers.getSigner(deployer);

    logger.info(`\nScanning roles/ownership for transfer on ${options.network}...`);
    const scan = await scanRolesAndOwnership({
      hre,
      deployer,
      governanceMultisig: governance,
      deploymentsPath: options.deploymentsDir,
      logger: (m: string) => logger.info(m),
    });

    let addedOperations = 0;
    const summary: { contract: string; address: string; ops: string[] }[] = [];

    // Roles: grant to governance first, then revoke/renounce from deployer (non-admin first, admin last)
    for (const c of scan.rolesContracts) {
      const opsForContract: string[] = [];

      const nonAdminRolesHeldByDeployer = c.rolesHeldByDeployer.filter((r) => r.name !== "DEFAULT_ADMIN_ROLE");
      const adminRole = c.rolesHeldByDeployer.find((r) => r.name === "DEFAULT_ADMIN_ROLE");

      if (nonAdminRolesHeldByDeployer.length > 0 || adminRole) {
        logger.info(`\nProcessing ${c.name} at ${c.address}`);
      }

      // Non-admin roles
      for (const role of nonAdminRolesHeldByDeployer) {
        logger.info(`  - Grant ${role.name} to governance, then renounce from deployer`);
        addedOperations += 2;
        opsForContract.push(`grantRole(${role.name})->${governance}`, `renounceRole(${role.name})->${deployer}`);
      }

      // Admin role last
      if (adminRole) {
        logger.info(`  - Transfer DEFAULT_ADMIN_ROLE to governance and renounce from deployer`);
        addedOperations += 2;
        opsForContract.push(`grantRole(DEFAULT_ADMIN_ROLE)->${governance}`, `renounceRole(DEFAULT_ADMIN_ROLE)->${deployer}`);
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
      logger.info(`\nTransferring ownership of ${c.name} at ${c.address} to governance`);
      addedOperations += 1;
      summary.push({
        contract: c.name,
        address: c.address,
        ops: ["transferOwnership->governance"],
      });
    }

    if (addedOperations === 0) {
      logger.info("\nNothing to transfer.");
      return;
    }

    // Print final change summary
    logger.info("\n--- Planned Changes Summary ---");
    for (const s of summary) {
      logger.info(`- ${s.contract} (${s.address})`);
      for (const op of s.ops) logger.info(`  • ${op}`);
    }
    logger.info(`Total operations: ${addedOperations}`);

    // Confirmation prompt (skip with --yes)
    if (!options.yes) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer: string = await new Promise((resolve) => rl.question("\nProceed to execute on-chain migrations? (yes/no): ", resolve));
      rl.close();
      if (answer.trim().toLowerCase() !== "yes") {
        logger.info("Aborted by user.");
        return;
      }
    }

    logger.info(`\nExecuting on-chain migrations with deployer signer...`);

    // Execute AccessControl migrations: non-admin roles first, then admin role
    for (const c of scan.rolesContracts) {
      const contract = await ethers.getContractAt(c.abi as any, c.address, deployerSigner);

      // Non-admin roles
      const nonAdminRolesHeldByDeployer = c.rolesHeldByDeployer.filter((r) => r.name !== "DEFAULT_ADMIN_ROLE");
      for (const role of nonAdminRolesHeldByDeployer) {
        try {
          const governanceHasRole: boolean = await (contract as any).hasRole(role.hash, governance);
          if (!governanceHasRole) {
            logger.info(`Granting ${role.name} to governance on ${c.name} (${c.address})...`);
            const tx = await (contract as any).grantRole(role.hash, governance);
            await tx.wait();
          } else {
            logger.info(`Governance already has ${role.name} on ${c.name}; skipping grant.`);
          }

          const deployerHasRole: boolean = await (contract as any).hasRole(role.hash, deployer);
          if (deployerHasRole) {
            logger.info(`Renouncing ${role.name} from deployer on ${c.name} (${c.address})...`);
            const tx2 = await (contract as any).renounceRole(role.hash, deployer);
            await tx2.wait();
          } else {
            logger.info(`Deployer does not hold ${role.name} on ${c.name}; skipping renounce.`);
          }
        } catch (e) {
          logger.error(`Error migrating role ${role.name} on ${c.name} (${c.address}):`, e);
        }
      }

      // Admin role last
      const adminRole = c.rolesHeldByDeployer.find((r) => r.name === "DEFAULT_ADMIN_ROLE");
      if (adminRole) {
        try {
          const governanceHasAdmin: boolean = await (contract as any).hasRole(adminRole.hash, governance);
          if (!governanceHasAdmin) {
            logger.info(`Granting DEFAULT_ADMIN_ROLE to governance on ${c.name} (${c.address})...`);
            const tx = await (contract as any).grantRole(adminRole.hash, governance);
            await tx.wait();
          } else {
            logger.info(`Governance already has DEFAULT_ADMIN_ROLE on ${c.name}; skipping grant.`);
          }

          const deployerHasAdmin: boolean = await (contract as any).hasRole(adminRole.hash, deployer);
          if (deployerHasAdmin) {
            logger.info(`Renouncing DEFAULT_ADMIN_ROLE from deployer on ${c.name} (${c.address})...`);
            const tx2 = await (contract as any).renounceRole(adminRole.hash, deployer);
            await tx2.wait();
          } else {
            logger.info(`Deployer does not hold DEFAULT_ADMIN_ROLE on ${c.name}; skipping renounce.`);
          }
        } catch (e) {
          logger.error(`Error migrating DEFAULT_ADMIN_ROLE on ${c.name} (${c.address}):`, e);
        }
      }
    }

    // Execute Ownable migrations: transfer ownership to governance
    for (const c of scan.ownableContracts) {
      if (!c.deployerIsOwner) continue;
      try {
        const contract = await ethers.getContractAt(c.abi as any, c.address, deployerSigner);
        const currentOwner: string = await (contract as any).owner();
        if (currentOwner.toLowerCase() === governance.toLowerCase()) {
          logger.info(`Governance already owns ${c.name} (${c.address}); skipping.`);
          continue;
        }
        logger.info(`Transferring ownership of ${c.name} (${c.address}) to governance...`);
        const tx = await (contract as any).transferOwnership(governance);
        await tx.wait();
      } catch (e) {
        logger.error(`Error transferring ownership for ${c.name} (${c.address}):`, e);
      }
    }

    logger.success("\nRole and ownership transfer completed.");
  } catch (error) {
    logger.error('Failed to transfer roles and ownership.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
