#!/usr/bin/env ts-node

import { Command } from 'commander';
import { scanRolesAndOwnership } from '../../lib/roles/scan';
import { SafeManager } from '../../lib/roles/safe-manager';
import { SafeTransactionData, SafeConfig } from '../../lib/roles/types';
import { logger } from '../../lib/logger';

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Revoke deployer roles via Safe multisig batch transaction (where governance has DEFAULT_ADMIN_ROLE).')
    .requiredOption('-n, --network <name>', 'Network to operate on')
    .requiredOption('-d, --deployer <address>', 'Deployer address (roles to revoke)')
    .requiredOption('-g, --governance <address>', 'Governance multisig address')
    .requiredOption('-s, --safe-address <address>', 'Safe multisig address')
    .requiredOption('-c, --chain-id <number>', 'Chain ID for Safe')
    .option('--safe-owners <addresses>', 'Comma-separated list of Safe owner addresses')
    .option('--safe-threshold <number>', 'Safe signature threshold (default: 1)', '1')
    .option('--tx-service-url <url>', 'Safe transaction service URL (optional)')
    .option('--deployments-dir <path>', 'Path to deployments directory (defaults to ./deployments)')
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

    logger.info(`\nScanning roles for revoke on ${options.network}...`);
    const scan = await scanRolesAndOwnership({
      hre,
      deployer,
      governanceMultisig: governance,
      deploymentsPath: options.deploymentsDir,
      logger: (m: string) => logger.info(m),
    });

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
      logger.info(`\nProcessing ${c.name} at ${c.address}`);

      const iface = new ethers.Interface(c.abi as any);
      // Only revoke if the DEPLOYER currently has the role (avoid spamming unnecessary txs)
      const rolesToRevoke: { name: string; hash: string }[] = [];
      for (const role of c.rolesHeldByDeployer) {
        logger.info(`  - Queuing revokeRole(${role.name}) from deployer`);
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
      logger.info("\nNo roles to revoke where governance has DEFAULT_ADMIN_ROLE.");
      return;
    }

    logger.info(`\nCreating Safe batch with ${addedOperations} operations from ${consideredContracts} contracts...`);

    // Build Safe configuration
    const safeConfig: SafeConfig = {
      safeAddress: options.safeAddress,
      owners: options.safeOwners ? options.safeOwners.split(',').map((a: string) => a.trim()) : [governance],
      threshold: parseInt(options.safeThreshold, 10),
      chainId: parseInt(options.chainId, 10),
      txServiceUrl: options.txServiceUrl,
    };

    const safeManager = new SafeManager(hre, deployerSigner, {
      safeConfig,
      // offline-only mode enforced in SafeManager; no API kit or service
      signingMode: "none",
    });
    await safeManager.initialize();

    const res = await safeManager.createBatchTransaction({
      transactions: txs,
      description: `Revoke ${addedOperations} roles (governance has DEFAULT_ADMIN_ROLE)`,
    });

    if (!res.success) {
      logger.error("Failed to create Safe batch:", res.error);
    } else {
      logger.success(`\nBatch prepared. SafeTxHash: ${res.safeTxHash}`);
    }

    // Final summary of what will be revoked
    logger.info("\n--- Revocations Summary ---");
    if (revocationSummary.length === 0) {
      logger.info("No revocations planned.");
    } else {
      let totalRoles = 0;
      for (const item of revocationSummary) {
        logger.info(`- ${item.contract} (${item.address})`);
        for (const r of item.roles) {
          logger.info(`  - revokeRole(${r.name}) from deployer (hash: ${r.hash})`);
          totalRoles++;
        }
      }
      logger.info(`Total roles to revoke: ${totalRoles}`);
    }
  } catch (error) {
    logger.error('Failed to revoke roles.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
