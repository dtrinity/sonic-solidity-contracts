#!/usr/bin/env ts-node

import { Command } from 'commander';
import { scanRolesAndOwnership } from '../../lib/roles/scan';
import { logger } from '../../lib/logger';

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Scan deployed contracts for role assignments and ownership.')
    .requiredOption('-n, --network <name>', 'Network to scan (must have deployments)')
    .requiredOption('-d, --deployer <address>', 'Deployer address to check for role ownership')
    .requiredOption('-g, --governance <address>', 'Governance multisig address to check')
    .option('--deployments-dir <path>', 'Path to deployments directory (defaults to ./deployments)')
    .option('--hardhat-config <path>', 'Path to hardhat.config.ts (defaults to ./hardhat.config.ts)');

  program.parse(process.argv);
  const options = program.opts();

  try {
    // Dynamically load hardhat runtime environment
    // Note: configPath option is available but hardhat will auto-detect config
    process.env.HARDHAT_NETWORK = options.network;

    const hre = require('hardhat');

    logger.info(`Scanning roles/ownership on ${options.network}`);

    const result = await scanRolesAndOwnership({
      hre,
      deployer: options.deployer as string,
      governanceMultisig: options.governance as string,
      deploymentsPath: options.deploymentsDir,
      logger: (m: string) => logger.info(m),
    });

    logger.info(`\nRoles contracts: ${result.rolesContracts.length}`);
    for (const c of result.rolesContracts) {
      logger.info(`- ${c.name} (${c.address})`);
      if (c.rolesHeldByDeployer.length > 0) {
        logger.info(`  deployer roles: ${c.rolesHeldByDeployer.map((r) => r.name).join(", ")}`);
      }
      if (c.rolesHeldByGovernance.length > 0) {
        logger.info(`  governance roles: ${c.rolesHeldByGovernance.map((r) => r.name).join(", ")}`);
      }
      logger.info(`  governanceHasDefaultAdmin: ${c.governanceHasDefaultAdmin}`);
    }

    logger.info(`\nOwnable contracts: ${result.ownableContracts.length}`);
    for (const c of result.ownableContracts) {
      logger.info(
        `- ${c.name} (${c.address}) owner=${c.owner} deployerIsOwner=${c.deployerIsOwner} governanceIsOwner=${c.governanceIsOwner}`,
      );
    }

    // Final exposure summary
    const exposureRoles = result.rolesContracts.filter((c) => c.rolesHeldByDeployer.length > 0);
    const exposureOwnable = result.ownableContracts.filter((c) => c.deployerIsOwner);
    const governanceOwnableMismatches = result.ownableContracts.filter((c) => !c.governanceIsOwner);

    logger.info("\n--- Deployer Exposure Summary ---");
    if (exposureRoles.length > 0) {
      logger.info(`Contracts with roles held by deployer: ${exposureRoles.length}`);
      for (const c of exposureRoles) {
        logger.info(`- ${c.name} (${c.address})`);
        for (const role of c.rolesHeldByDeployer) {
          logger.info(`  - ${role.name} (hash: ${role.hash})`);
        }
      }
    } else {
      logger.success("Deployer holds no AccessControl roles.");
    }

    if (exposureOwnable.length > 0) {
      logger.info(`\nOwnable contracts owned by deployer: ${exposureOwnable.length}`);
      for (const c of exposureOwnable) {
        logger.info(`- ${c.name} (${c.address})`);
      }
    } else {
      logger.success("\nDeployer owns no Ownable contracts.");
    }

    if (governanceOwnableMismatches.length > 0) {
      logger.warn(`\nOwnable contracts NOT owned by governance multisig: ${governanceOwnableMismatches.length}`);
      for (const c of governanceOwnableMismatches) {
        logger.warn(`- ${c.name} (${c.address}) owner=${c.owner}`);
      }
    } else {
      logger.success("\nAll Ownable contracts are governed by the multisig.");
    }
  } catch (error) {
    logger.error('Failed to scan roles and ownership.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
