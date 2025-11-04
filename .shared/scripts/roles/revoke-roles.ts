#!/usr/bin/env ts-node

import { Interface } from "@ethersproject/abi";
import { Command } from "commander";
import * as readline from "readline";

import { logger } from "../../lib/logger";
import { scanRolesAndOwnership } from "../../lib/roles/scan";
import { loadRoleManifest, resolveRoleManifest } from "../../lib/roles/manifest";
import { isDeploymentExcluded } from "../../lib/roles/planner";
import { SafeManager } from "../../lib/roles/safe-manager";
import { SafeTransactionData } from "../../lib/roles/types";

type ManifestSource = "auto" | "override";

interface RevocationPlanItem {
  readonly deployment: string;
  readonly contractName: string;
  readonly address: string;
  readonly manifestSource: ManifestSource;
  readonly roles: {
    readonly name: string;
    readonly hash: string;
  }[];
}

interface OptOutItem {
  readonly deployment: string;
  readonly contractName: string;
  readonly address: string;
  readonly reason: string;
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
    .description("Generate Safe batch transactions to revoke all deployer-held AccessControl roles.")
    .requiredOption("-m, --manifest <path>", "Path to the role manifest JSON")
    .requiredOption("-n, --network <name>", "Hardhat network to target")
    .option("--deployments-dir <path>", "Path to deployments directory (defaults to hardhat configured path)")
    .option("--hardhat-config <path>", "Path to hardhat.config.ts (defaults to ./hardhat.config.ts)")
    .option("--dry-run", "Simulate the batch without creating Safe transactions")
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

    if (!manifest.safe) {
      throw new Error("Manifest must include a Safe configuration to prepare revocation batches.");
    }

    const rolesScan = await scanRolesAndOwnership({
      hre,
      deployer: manifest.deployer,
      governanceMultisig: manifest.governance,
      deploymentsPath: options.deploymentsDir,
      logger: (msg: string) => logger.info(msg),
    });

    const overridesByDeployment = new Map(manifest.overrides.map((override) => [override.deployment, override]));

    const planItems: RevocationPlanItem[] = [];
    const optOuts: OptOutItem[] = [];

    for (const contractInfo of rolesScan.rolesContracts) {
      if (contractInfo.rolesHeldByDeployer.length === 0) {
        continue;
      }

      const override = overridesByDeployment.get(contractInfo.deploymentName);

      if (isDeploymentExcluded(manifest, contractInfo.deploymentName, "defaultAdmin")) {
        optOuts.push({
          deployment: contractInfo.deploymentName,
          contractName: contractInfo.name,
          address: contractInfo.address,
          reason: "Manifest exclusion",
        });
        continue;
      }

      if (override?.defaultAdmin && override.defaultAdmin.enabled === false) {
        optOuts.push({
          deployment: contractInfo.deploymentName,
          contractName: contractInfo.name,
          address: contractInfo.address,
          reason: "Override disabled default admin actions",
        });
        continue;
      }

      let include = false;
      let manifestSource: ManifestSource = "auto";

      if (override?.defaultAdmin && override.defaultAdmin.enabled !== false) {
        include = true;
        manifestSource = "override";
      } else if (manifest.autoInclude.defaultAdmin) {
        include = true;
        manifestSource = "auto";
      }

      if (!include) {
        optOuts.push({
          deployment: contractInfo.deploymentName,
          contractName: contractInfo.name,
          address: contractInfo.address,
          reason: "Auto-include disabled and no override present",
        });
        continue;
      }

      planItems.push({
        deployment: contractInfo.deploymentName,
        contractName: contractInfo.name,
        address: contractInfo.address,
        manifestSource,
        roles: contractInfo.rolesHeldByDeployer.map((role) => ({
          name: role.name,
          hash: role.hash,
        })),
      });
    }

    if (planItems.length === 0) {
      logger.success("\nNo roles require Safe revocation. Deployer holds no AccessControl roles or all were opted out.");
      await emitJson(options.jsonOutput, {
        status: "no-action",
        safeBatch: null,
        plan: [],
        optOuts,
      });
      return;
    }

    logger.info("\n=== Revocation Plan ===");
    let totalRoles = 0;
    planItems.forEach((item, index) => {
      totalRoles += item.roles.length;
      logger.info(
        `- [${index + 1}/${planItems.length}] ${item.contractName} (${item.address}) :: ${item.roles.length} roles (${item.manifestSource})`,
      );
      for (const role of item.roles) {
        logger.info(`    • ${role.name} (${role.hash})`);
      }
    });

    if (optOuts.length > 0) {
      logger.info("\nManifest opt-outs:");
      for (const entry of optOuts) {
        logger.info(`- ${entry.contractName} (${entry.address}) :: ${entry.reason}`);
      }
    }

    const safeTransactions: SafeTransactionData[] = [];

    for (const item of planItems) {
      const contractInfo = rolesScan.rolesContracts.find((c) => c.deploymentName === item.deployment);
      if (!contractInfo) {
        continue;
      }
      const iface = new Interface(contractInfo.abi as any);

      for (const role of item.roles) {
        const data = iface.encodeFunctionData("revokeRole", [role.hash, manifest.deployer]);
        safeTransactions.push({
          to: contractInfo.address,
          value: "0",
          data,
        });
      }
    }

    logger.info(`\nTotal roles to revoke: ${totalRoles}`);
    logger.info(`Safe operations to queue: ${safeTransactions.length}`);

    if (safeTransactions.length === 0) {
      logger.success("\nNo Safe transactions generated after filtering. Nothing to do.");
      await emitJson(options.jsonOutput, {
        status: "no-action",
        safeBatch: null,
        plan: planItems,
        optOuts,
      });
      return;
    }

    if (!dryRun && !options.yes) {
      const confirmed = await promptYesNo("\nQueue Safe revoke transactions now? (yes/no): ");
      if (!confirmed) {
        logger.info("Aborted by user.");
        return;
      }
    }

    let safeBatchResult: Awaited<ReturnType<SafeManager["createBatchTransaction"]>> | null = null;

    if (!dryRun) {
      const signer = await hre.ethers.getSigner(manifest.deployer);
      const safeManager = new SafeManager(hre, signer, {
        safeConfig: manifest.safe,
      });

      await safeManager.initialize();

      safeBatchResult = await safeManager.createBatchTransaction({
        transactions: safeTransactions,
        description: `Role revocations (${safeTransactions.length} operations)`,
      });

      if (safeBatchResult.success) {
        logger.success(`\nSafe batch prepared. SafeTxHash: ${safeBatchResult.safeTxHash ?? "unknown"}`);
      } else {
        logger.error(`\nFailed to prepare Safe batch: ${safeBatchResult.error ?? "unknown error"}`);
      }
    } else {
      logger.info("\nDry-run mode: Safe batch not created.");
    }

    await emitJson(options.jsonOutput, {
      status: dryRun ? "dry-run" : "executed",
      safeBatch: safeTransactions.length === 0 ? null : safeBatchResult,
      plan: planItems,
      optOuts,
    });
  } catch (error) {
    logger.error("Failed to prepare Safe revocation batch.");
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

async function emitJson(
  outputPath: string | undefined,
  payload: {
    status: "executed" | "dry-run" | "no-action";
    safeBatch:
      | ({
          success: boolean;
          safeTxHash?: string;
          error?: string;
          requiresAdditionalSignatures?: boolean;
        } | null);
    plan: RevocationPlanItem[];
    optOuts: OptOutItem[];
  },
): Promise<void> {
  if (!outputPath) {
    return;
  }

  const serialized = JSON.stringify(payload, null, 2);
  if (outputPath === "-") {
    // eslint-disable-next-line no-console
    console.log(serialized);
    return;
  }

  const fs = require("fs");
  const path = require("path");
  const resolved = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);
  fs.writeFileSync(resolved, serialized);
  logger.info(`\nSaved JSON report to ${resolved}`);
}

void main();
