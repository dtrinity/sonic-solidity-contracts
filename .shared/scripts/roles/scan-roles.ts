#!/usr/bin/env ts-node

import { Command } from 'commander';
import { scanRolesAndOwnership } from '../../lib/roles/scan';
import { logger } from '../../lib/logger';
import { loadRoleManifest, resolveRoleManifest, ResolvedDefaultAdminAction } from '../../lib/roles/manifest';
import { prepareContractPlans, isDeploymentExcluded } from '../../lib/roles/planner';

interface DriftIssue {
  readonly type: 'ownable' | 'defaultAdmin';
  readonly deployment: string;
  readonly address: string;
  readonly contract: string;
  readonly detail: string;
}

type ScanResult = Awaited<ReturnType<typeof scanRolesAndOwnership>>;
type RolesExposure = ScanResult['rolesContracts'][number];
type OwnableExposure = ScanResult['ownableContracts'][number];

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Scan deployed contracts for role assignments and ownership.')
    .requiredOption('-n, --network <name>', 'Network to scan (must have deployments)')
    .option('-d, --deployer <address>', 'Deployer address to check for role ownership (defaults to network.config.roles.deployer)')
    .option('-g, --governance <address>', 'Governance multisig address to check (defaults to network.config.roles.governance)')
    .option('--manifest <path>', 'Path to a role manifest to evaluate coverage')
    .option('--drift-check', 'Exit non-zero when deployer-held roles are not covered by the manifest')
    .option('--json-output <path>', 'Write scan report JSON to path (or stdout when set to "-")')
    .option('--deployments-dir <path>', 'Path to deployments directory (defaults to ./deployments)')
    .option('--hardhat-config <path>', 'Path to hardhat.config.ts (defaults to ./hardhat.config.ts)');

  program.parse(process.argv);
  const options = program.opts();

  if (options.hardhatConfig) {
    process.env.HARDHAT_CONFIG = options.hardhatConfig;
    process.env.HARDHAT_USER_CONFIG = options.hardhatConfig;
  }

  try {
    process.env.HARDHAT_NETWORK = options.network;
    const hre = require('hardhat');

    const networkConfig = (hre.network?.config ?? {}) as { roles?: { deployer?: string; governance?: string } };
    const configRoles = networkConfig.roles ?? {};
    const deployer: string | undefined = options.deployer as string | undefined ?? configRoles.deployer;
    const governance: string | undefined = options.governance as string | undefined ?? configRoles.governance;

    if (!deployer || !governance) {
      throw new Error('Missing deployer/governance addresses. Provide --deployer/--governance or set roles.deployer / roles.governance in the Hardhat network config.');
    }

    logger.info(`Scanning roles/ownership on ${options.network}`);

    const result = await scanRolesAndOwnership({
      hre,
      deployer,
      governanceMultisig: governance,
      deploymentsPath: options.deploymentsDir,
      logger: (m: string) => logger.info(m),
    });

    logger.info(`\nRoles contracts: ${result.rolesContracts.length}`);
    for (const c of result.rolesContracts) {
      logger.info(`- ${c.name} (${c.address})`);
      if (c.rolesHeldByDeployer.length > 0) {
        logger.info(`  deployer roles: ${c.rolesHeldByDeployer.map((r) => r.name).join(', ')}`);
      }
      if (c.rolesHeldByGovernance.length > 0) {
        logger.info(`  governance roles: ${c.rolesHeldByGovernance.map((r) => r.name).join(', ')}`);
      }
      logger.info(`  governanceHasDefaultAdmin: ${c.governanceHasDefaultAdmin}`);
    }

    logger.info(`\nOwnable contracts: ${result.ownableContracts.length}`);
    for (const c of result.ownableContracts) {
      logger.info(
        `- ${c.name} (${c.address}) owner=${c.owner} deployerIsOwner=${c.deployerIsOwner} governanceIsOwner=${c.governanceIsOwner}`,
      );
    }

    const exposureRoles = result.rolesContracts.filter((c) => c.rolesHeldByDeployer.length > 0);
    const exposureOwnable = result.ownableContracts.filter((c) => c.deployerIsOwner);
    const governanceOwnableMismatches = result.ownableContracts.filter((c) => !c.governanceIsOwner);

    logger.info('\n--- Deployer Exposure Summary ---');
    if (exposureRoles.length > 0) {
      logger.info(`Contracts with roles held by deployer: ${exposureRoles.length}`);
      for (const c of exposureRoles) {
        logger.info(`- ${c.name} (${c.address})`);
        for (const role of c.rolesHeldByDeployer) {
          logger.info(`  - ${role.name} (hash: ${role.hash})`);
        }
      }
    } else {
      logger.success('Deployer holds no AccessControl roles.');
    }

    if (exposureOwnable.length > 0) {
      logger.info(`\nOwnable contracts owned by deployer: ${exposureOwnable.length}`);
      for (const c of exposureOwnable) {
        logger.info(`- ${c.name} (${c.address})`);
      }
    } else {
      logger.success('\nDeployer owns no Ownable contracts.');
    }

    if (governanceOwnableMismatches.length > 0) {
      logger.warn(`\nOwnable contracts NOT owned by governance multisig: ${governanceOwnableMismatches.length}`);
      for (const c of governanceOwnableMismatches) {
        logger.warn(`- ${c.name} (${c.address}) owner=${c.owner}`);
      }
    } else {
      logger.success('\nAll Ownable contracts are governed by the multisig.');
    }

    let driftIssues: DriftIssue[] = [];
    let manifest;

    if (options.manifest) {
      manifest = resolveRoleManifest(loadRoleManifest(options.manifest));
      const rolesByDeployment = new Map(result.rolesContracts.map((info) => [info.deploymentName, info]));
      const ownableByDeployment = new Map(result.ownableContracts.map((info) => [info.deploymentName, info]));
      const plans = prepareContractPlans({ manifest, rolesByDeployment, ownableByDeployment });

      const plannedOwnable = new Set(plans.filter((plan) => Boolean(plan.ownable)).map((plan) => plan.deployment));
      const plannedDefaultAdmin = new Map<string, ResolvedDefaultAdminAction>();
      for (const plan of plans) {
        if (plan.defaultAdmin) {
          plannedDefaultAdmin.set(plan.deployment, plan.defaultAdmin);
        }
      }

      driftIssues = [...findOwnableDrift({ manifest, plannedOwnable, exposureOwnable })];
      driftIssues.push(...findDefaultAdminDrift({ manifest, plannedDefaultAdmin, exposureRoles }));

      if (options.driftCheck) {
        if (driftIssues.length > 0) {
          logger.error('\nDrift detected: deployer retains control outside manifest coverage.');
          for (const issue of driftIssues) {
            logger.error(`- [${issue.type}] ${issue.contract} (${issue.address}) :: ${issue.detail}`);
          }
          process.exitCode = 1;
        } else {
          logger.success('\nNo drift detected. Manifest covers all deployer-held ownership/admin roles.');
        }
      }
    } else if (options.driftCheck) {
      throw new Error('--drift-check requires --manifest to evaluate coverage.');
    }

    if (options.jsonOutput) {
      const report = {
        network: options.network,
        deployer,
        governance,
        summary: {
          rolesContracts: result.rolesContracts.length,
          ownableContracts: result.ownableContracts.length,
        },
        exposures: {
          ownable: exposureOwnable.map((c) => ({
            deployment: c.deploymentName,
            address: c.address,
            contract: c.name,
            owner: c.owner,
          })),
          defaultAdmin: exposureRoles.map((c) => ({
            deployment: c.deploymentName,
            address: c.address,
            contract: c.name,
            roles: c.rolesHeldByDeployer.map((r) => ({ name: r.name, hash: r.hash })),
          })),
        },
        drift: {
          manifest: options.manifest ?? null,
          issues: driftIssues,
        },
      };

      const payload = JSON.stringify(report, null, 2);
      if (options.jsonOutput === '-') {
        // eslint-disable-next-line no-console
        console.log(payload);
      } else {
        const fs = require('fs');
        const path = require('path');
        const resolvedPath = path.isAbsolute(options.jsonOutput)
          ? options.jsonOutput
          : path.join(process.cwd(), options.jsonOutput);
        fs.writeFileSync(resolvedPath, payload);
        logger.info(`\nSaved JSON report to ${resolvedPath}`);
      }
    }
  } catch (error) {
    logger.error('Failed to scan roles and ownership.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

function findOwnableDrift({
  manifest,
  plannedOwnable,
  exposureOwnable,
}: {
  manifest: ReturnType<typeof resolveRoleManifest>;
  plannedOwnable: Set<string>;
  exposureOwnable: OwnableExposure[];
}): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const exposure of exposureOwnable) {
    if (plannedOwnable.has(exposure.deploymentName)) {
      continue;
    }

    if (isDeploymentExcluded(manifest, exposure.deploymentName, 'ownable')) {
      continue;
    }

    issues.push({
      type: 'ownable',
      deployment: exposure.deploymentName,
      address: exposure.address,
      contract: exposure.name,
      detail: 'Manifest does not include an Ownable transfer for this deployment.',
    });
  }

  return issues;
}

function findDefaultAdminDrift({
  manifest,
  plannedDefaultAdmin,
  exposureRoles,
}: {
  manifest: ReturnType<typeof resolveRoleManifest>;
  plannedDefaultAdmin: Map<string, ResolvedDefaultAdminAction>;
  exposureRoles: RolesExposure[];
}): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const exposure of exposureRoles) {
    const defaultAdminRole = exposure.rolesHeldByDeployer.find((role) => role.name === 'DEFAULT_ADMIN_ROLE');
    if (!defaultAdminRole) {
      continue;
    }

    const plannedAction = plannedDefaultAdmin.get(exposure.deploymentName);

    if (plannedAction) {
      if (!plannedAction.removal) {
        // Manifest explicitly keeps deployer as admin; no drift.
        continue;
      }
      // Removal planned – coverage exists.
      continue;
    }

    if (isDeploymentExcluded(manifest, exposure.deploymentName, 'defaultAdmin')) {
      continue;
    }

    issues.push({
      type: 'defaultAdmin',
      deployment: exposure.deploymentName,
      address: exposure.address,
      contract: exposure.name,
      detail: 'Manifest does not include a DEFAULT_ADMIN_ROLE migration for this deployment.',
    });
  }

  return issues;
}

void main();
