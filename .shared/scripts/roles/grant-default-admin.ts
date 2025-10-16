#!/usr/bin/env ts-node

import { Command } from "commander";
import * as readline from "readline";

import { logger } from "../../lib/logger";
import { scanRolesAndOwnership } from "../../lib/roles/scan";
import { loadRoleManifest, resolveRoleManifest } from "../../lib/roles/manifest";
import { prepareContractPlans, isDeploymentExcluded } from "../../lib/roles/planner";

type ScanResult = Awaited<ReturnType<typeof scanRolesAndOwnership>>;

type ManifestSource = "auto" | "override";

interface GrantTarget {
  readonly deployment: string;
  readonly contractName: string;
  readonly address: string;
  readonly manifestSource: ManifestSource;
  readonly defaultAdminRoleHash: string;
  readonly rolesInfo: ScanResult["rolesContracts"][number];
}

interface ContractRef {
  readonly deployment: string;
  readonly contractName: string;
  readonly address: string;
  readonly manifestSource: ManifestSource;
}

interface Summary {
  readonly granted: GrantTarget[];
  readonly skippedExisting: ContractRef[];
  readonly skippedNoPermission: ContractRef[];
  readonly skippedMissingRole: ContractRef[];
  readonly manifestOptOuts: {
    readonly deployment: string;
    readonly contractName: string;
    readonly address: string;
    readonly reason: string;
  }[];
  readonly failures: {
    readonly target: GrantTarget;
    readonly error: string;
  }[];
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .description("Grant DEFAULT_ADMIN_ROLE from the deployer to the governance multisig based on the shared manifest.")
    .requiredOption("-m, --manifest <path>", "Path to the role manifest JSON")
    .requiredOption("-n, --network <name>", "Hardhat network to target")
    .option("--deployments-dir <path>", "Path to deployments directory (defaults to hardhat configured path)")
    .option("--hardhat-config <path>", "Path to hardhat.config.ts (defaults to ./hardhat.config.ts)")
    .option("--dry-run", "Simulate the grants without sending transactions")
    .option("--yes", "Skip confirmation prompt")
    .option("--json-output <path>", "Write summary report JSON to path (or stdout when set to '-')");

  program.parse(process.argv);
  const options = program.opts();

  process.env.HARDHAT_NETWORK = options.network;

  if (options.hardhatConfig) {
    process.env.HARDHAT_CONFIG = options.hardhatConfig;
    process.env.HARDHAT_USER_CONFIG = options.hardhatConfig;
  }

  try {
    const hre = require("hardhat");
    const manifest = resolveRoleManifest(loadRoleManifest(options.manifest));
    const dryRun = Boolean(options.dryRun);

    const rolesResult = await scanRolesAndOwnership({
      hre,
      deployer: manifest.deployer,
      governanceMultisig: manifest.governance,
      deploymentsPath: options.deploymentsDir,
      logger: (message: string) => logger.info(message),
    });

    const rolesByDeployment = new Map(rolesResult.rolesContracts.map((info) => [info.deploymentName, info]));
    const plans = prepareContractPlans({
      manifest,
      rolesByDeployment,
      ownableByDeployment: new Map(),
    });

    const actionable: GrantTarget[] = [];
    const skippedExisting: ContractRef[] = [];
    const skippedNoPermission: ContractRef[] = [];
    const skippedMissingRole: ContractRef[] = [];
    const manifestOptOuts: Summary["manifestOptOuts"] = [];
    const failures: Summary["failures"] = [];

    const planByDeployment = new Map(plans.map((plan) => [plan.deployment, plan]));

    for (const plan of plans) {
      if (!plan.defaultAdmin) {
        continue;
      }

      const rolesInfo = rolesByDeployment.get(plan.deployment);
      const manifestSource: ManifestSource = (plan.defaultAdminSource ?? "auto") as ManifestSource;

      if (!rolesInfo || !rolesInfo.defaultAdminRoleHash) {
        skippedMissingRole.push({
          deployment: plan.deployment,
          contractName: plan.alias ?? rolesInfo?.name ?? plan.deployment,
          address: rolesInfo?.address ?? "unknown",
          manifestSource,
        });
        continue;
      }

      const contractName = rolesInfo.name;
      const address = rolesInfo.address;
      const defaultAdminRoleHash = rolesInfo.defaultAdminRoleHash;

      const deployerHasAdmin = rolesInfo.rolesHeldByDeployer.some(
        (role) => role.hash.toLowerCase() === defaultAdminRoleHash.toLowerCase(),
      );
      const governanceHasAdmin = rolesInfo.governanceHasDefaultAdmin;

      const target: GrantTarget = {
        deployment: plan.deployment,
        contractName,
        address,
        manifestSource: (plan.defaultAdminSource ?? "auto") as ManifestSource,
        defaultAdminRoleHash,
        rolesInfo,
      };

      if (governanceHasAdmin) {
        skippedExisting.push({
          deployment: target.deployment,
          contractName,
          address,
          manifestSource,
        });
        continue;
      }

      if (!deployerHasAdmin) {
        skippedNoPermission.push({
          deployment: target.deployment,
          contractName,
          address,
          manifestSource,
        });
        continue;
      }

      actionable.push(target);
    }

    // Identify manifest opt-outs for awareness.
    for (const rolesInfo of rolesResult.rolesContracts) {
      const defaultAdminHeldByDeployer = rolesInfo.rolesHeldByDeployer.some(
        (role) => role.name === "DEFAULT_ADMIN_ROLE",
      );
      if (!defaultAdminHeldByDeployer) {
        continue;
      }

      const plan = planByDeployment.get(rolesInfo.deploymentName);
      if (plan?.defaultAdmin) {
        continue;
      }

      if (
        isDeploymentExcluded(manifest, rolesInfo.deploymentName, "defaultAdmin") ||
        manifest.overrides.some(
          (override) => override.deployment === rolesInfo.deploymentName && override.defaultAdmin?.enabled === false,
        )
      ) {
        manifestOptOuts.push({
          deployment: rolesInfo.deploymentName,
          contractName: rolesInfo.name,
          address: rolesInfo.address,
          reason: "Manifest opt-out (exclusion or disabled override)",
        });
      }
    }

    logger.info("\n=== Grant Plan ===");
    logger.info(`Actionable grants: ${actionable.length}`);
    logger.info(`Already satisfied: ${skippedExisting.length}`);
    logger.info(`Missing deployer permission: ${skippedNoPermission.length}`);
    logger.info(`Missing DEFAULT_ADMIN_ROLE ABI/scan data: ${skippedMissingRole.length}`);
    logger.info(`Manifest opt-outs: ${manifestOptOuts.length}`);

    if (actionable.length > 0) {
      logger.info(`\nGranting DEFAULT_ADMIN_ROLE to governance multisig ${manifest.governance}:`);
      actionable.forEach((target, index) => {
        logger.info(
          `- [${index + 1}/${actionable.length}] ${target.contractName} (${target.address}) :: grant from deployer -> ${manifest.governance} (${target.manifestSource})`,
        );
      });
    }

    if (skippedExisting.length > 0) {
      logger.info("\nAlready satisfied (governance already holds DEFAULT_ADMIN_ROLE):");
      skippedExisting.forEach((entry) => {
        logger.info(`- ${entry.contractName} (${entry.address}) [${entry.manifestSource}]`);
      });
    }

    if (skippedNoPermission.length > 0) {
      logger.warn("\nMissing deployer permission (deployer does not hold DEFAULT_ADMIN_ROLE):");
      skippedNoPermission.forEach((entry) => {
        logger.warn(`- ${entry.contractName} (${entry.address}) [${entry.manifestSource}]`);
      });
    }

    if (skippedMissingRole.length > 0) {
      logger.warn("\nMissing DEFAULT_ADMIN_ROLE ABI or scan data (manual investigation required):");
      skippedMissingRole.forEach((entry) => {
        logger.warn(`- ${entry.contractName} (${entry.address}) [${entry.manifestSource}]`);
      });
    }

    if (manifestOptOuts.length > 0) {
      logger.info("\nManifest opt-outs (not processed by design):");
      manifestOptOuts.forEach((opt) => {
        logger.info(`- ${opt.contractName} (${opt.address}) :: ${opt.reason}`);
      });
    }

    if (actionable.length === 0) {
      logger.success("\nNo grants required. Governance already holds DEFAULT_ADMIN_ROLE (or manifest opts out).");
      await maybeEmitJson(options.jsonOutput, {
        status: "no-action",
        granted: [],
        skippedExisting,
        skippedNoPermission,
        skippedMissingRole,
        manifestOptOuts,
        failures,
      });
      return;
    }

    if (!dryRun && !options.yes) {
      const confirmed = await promptYesNo("\nProceed with granting DEFAULT_ADMIN_ROLE? (yes/no): ");
      if (!confirmed) {
        logger.info("Aborted by user.");
        return;
      }
    }

    const signer = await hre.ethers.getSigner(manifest.deployer);
    const resultsGranted: GrantTarget[] = [];

    for (let index = 0; index < actionable.length; index += 1) {
      const target = actionable[index];
      logger.info(
        `\n[${index + 1}/${actionable.length}] Granting DEFAULT_ADMIN_ROLE on ${target.contractName} (${target.address})`,
      );

      try {
        const contract = await hre.ethers.getContractAt(target.rolesInfo.abi as any, target.address, signer);

        if (dryRun) {
          logger.info("  [dry-run] Would call grantRole(DEFAULT_ADMIN_ROLE, governance)");
          resultsGranted.push(target);
          continue;
        }

        const tx = await contract.grantRole(target.defaultAdminRoleHash, manifest.governance);
        const receipt = await tx.wait();
        const txHash = receipt?.hash ?? tx.hash ?? "unknown";
        logger.info(`  ✅ Transaction hash: ${txHash}`);
        resultsGranted.push(target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`  ❌ Failed to grant DEFAULT_ADMIN_ROLE: ${message}`);
        failures.push({ target, error: message });
      }
    }

    logger.info("\n=== Summary ===");
    logger.info(`Grants executed: ${resultsGranted.length}`);
    logger.info(`Already satisfied: ${skippedExisting.length}`);
    logger.info(`Skipped (missing permission): ${skippedNoPermission.length}`);
    logger.info(`Skipped (no role hash): ${skippedMissingRole.length}`);
    logger.info(`Manifest opt-outs: ${manifestOptOuts.length}`);
    logger.info(`Failures: ${failures.length}`);

    if (manifestOptOuts.length > 0) {
      logger.info("\nManifest opt-outs:");
      for (const opt of manifestOptOuts) {
        logger.info(`- ${opt.contractName} (${opt.address}) :: ${opt.reason}`);
      }
    }

    if (skippedNoPermission.length > 0) {
      logger.warn("\nContracts skipped due to missing deployer permission:");
      for (const item of skippedNoPermission) {
        logger.warn(`- ${item.contractName} (${item.address})`);
      }
    }

    if (failures.length > 0) {
      logger.error("\nFailures:");
      for (const failure of failures) {
        logger.error(`- ${failure.target.contractName} (${failure.target.address}) :: ${failure.error}`);
      }
    }

    await maybeEmitJson(options.jsonOutput, {
      status: dryRun ? "dry-run" : "executed",
      granted: resultsGranted,
      skippedExisting,
      skippedNoPermission,
      skippedMissingRole,
      manifestOptOuts,
      failures,
    });
  } catch (error) {
    logger.error("Failed to grant DEFAULT_ADMIN_ROLE.");
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

async function maybeEmitJson(
  outputPath: string | undefined,
  summary: {
    status: "executed" | "dry-run" | "no-action";
    granted: GrantTarget[];
    skippedExisting: ContractRef[];
    skippedNoPermission: ContractRef[];
    skippedMissingRole: ContractRef[];
    manifestOptOuts: Summary["manifestOptOuts"];
    failures: Summary["failures"];
  },
): Promise<void> {
  if (!outputPath) {
    return;
  }

  const payload = JSON.stringify(summary, null, 2);
  if (outputPath === "-") {
    // eslint-disable-next-line no-console
    console.log(payload);
    return;
  }

  const fs = require("fs");
  const path = require("path");
  const resolved = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);
  fs.writeFileSync(resolved, payload);
  logger.info(`\nSaved JSON report to ${resolved}`);
}

void main();
