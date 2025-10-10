#!/usr/bin/env ts-node

import { Command } from "commander";
import * as readline from "readline";

import { logger } from "../../lib/logger";
import { loadRoleManifest, resolveRoleManifest } from "../../lib/roles/manifest";
import { OperationReport, RunnerResult, runRoleManifest } from "../../lib/roles/runner";

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

function describeOperation(op: OperationReport): string {
  const base = `${op.type} [${op.mode}]`;
  if (op.status === "planned") return `${base} (planned)`;
  if (op.status === "executed") return `${base} (tx: ${op.txHash ?? "unknown"})`;
  if (op.status === "queued") return `${base} (queued)`;
  if (op.status === "skipped") return `${base} (skipped${op.details ? `: ${op.details}` : ""})`;
  return `${base} (failed${op.details ? `: ${op.details}` : ""})`;
}

function printPlannedSafeOperations(result: RunnerResult): number {
  let planned = 0;

  logger.info("\n--- Planned Safe Revocations ---");
  for (const contract of result.contracts) {
    const plannedOps = contract.operations.filter((op) => op.status === "planned" && op.mode === "safe");
    if (plannedOps.length === 0) continue;

    logger.info(`- ${contract.alias ?? contract.deployment}${contract.address ? ` (${contract.address})` : ""}`);
    for (const op of plannedOps) {
      logger.info(`  • ${describeOperation(op)}`);
    }
    planned += plannedOps.length;
  }

  if (planned === 0) {
    logger.info("No Safe revocations required.");
  }

  return planned;
}

function printRemainingRoles(result: RunnerResult): void {
  logger.info("\n--- Remaining Roles (non-default admin) ---");
  let reported = false;
  for (const contract of result.contracts) {
    if (contract.remainingRoles.length === 0) continue;
    reported = true;
    logger.info(`- ${contract.alias ?? contract.deployment}${contract.address ? ` (${contract.address})` : ""}`);
    for (const role of contract.remainingRoles) {
      const deployerFlag = role.deployerHasRole ? "deployer" : "";
      const governanceFlag = role.governanceHasRole ? "governance" : "";
      const holders = [deployerFlag, governanceFlag].filter(Boolean).join(", ") || "other";
      logger.info(`  • ${role.role} (${holders}) hash=${role.hash}`);
    }
  }

  if (!reported) {
    logger.info("No additional AccessControl roles detected.");
  }
}

function summarizeResult(result: RunnerResult): void {
  logger.info("\n--- Safe Batch Summary ---");

  let queued = 0;
  for (const contract of result.contracts) {
    for (const op of contract.operations) {
      if (op.status === "queued" && op.mode === "safe") {
        queued += 1;
      }
    }
  }

  logger.info(`Safe operations queued: ${queued}`);
  if (result.safeBatch) {
    logger.info(`Batch description: ${result.safeBatch.description}`);
    if (result.safeBatch.safeTxHash) {
      logger.info(`SafeTxHash: ${result.safeBatch.safeTxHash}`);
    }
    if (!result.safeBatch.success && result.safeBatch.error) {
      logger.error(`Safe batch error: ${result.safeBatch.error}`);
    }
  }
}

function logStatistics(result: RunnerResult, phase: string): void {
  if (!result.statistics) return;

  logger.info(`\n--- ${phase} Breakdown ---`);
  logger.info(`Contracts considered: ${result.statistics.totalContracts}`);
  logger.info(`Auto-included Ownable actions: ${result.statistics.autoIncludedOwnable}`);
  logger.info(`Auto-included DEFAULT_ADMIN_ROLE actions: ${result.statistics.autoIncludedDefaultAdmin}`);
  logger.info(`Override Ownable actions: ${result.statistics.overrideOwnable}`);
  logger.info(`Override DEFAULT_ADMIN_ROLE actions: ${result.statistics.overrideDefaultAdmin}`);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .description("Prepare Safe revocations for DEFAULT_ADMIN_ROLE using the shared manifest.")
    .requiredOption("-m, --manifest <path>", "Path to the role manifest JSON")
    .option("-n, --network <name>", "Hardhat network to target")
    .option("--json-output <path>", "Write execution report JSON to path (overrides manifest output)")
    .option("--dry-run-only", "Run planning step without queueing Safe transactions")
    .option("--hardhat-config <path>", "Path to hardhat.config.ts (defaults to ./hardhat.config.ts)")
    .option("--yes", "Skip confirmation prompt");

  program.parse(process.argv);
  const options = program.opts();

  if (options.network) {
    process.env.HARDHAT_NETWORK = options.network;
  }
  if (options.hardhatConfig) {
    process.env.HARDHAT_CONFIG = options.hardhatConfig;
    process.env.HARDHAT_USER_CONFIG = options.hardhatConfig;
  }

  try {
    const hre = require("hardhat");
    const manifest = resolveRoleManifest(loadRoleManifest(options.manifest));

    if (!manifest.safe) {
      throw new Error("Manifest must include a Safe configuration for revoke operations.");
    }

    const safeOverrides = manifest.overrides
      .filter((override) => override.defaultAdmin?.action?.removal?.execution === "safe")
      .map((override) => ({
        deployment: override.deployment,
        alias: override.alias,
        notes: override.notes,
        defaultAdmin: override.defaultAdmin,
      }));

    const revokeManifest = {
      ...manifest,
      autoInclude: {
        ownable: false,
        defaultAdmin: false,
      },
      overrides: safeOverrides,
    } as typeof manifest;

    logger.info(`Loaded manifest for Safe ${manifest.safe.safeAddress} (threshold ${manifest.safe.threshold})`);
    logger.info(`Safe-ready default admin overrides: ${safeOverrides.length}`);

    const planResult = await runRoleManifest({
      hre,
      manifest: revokeManifest,
      dryRun: true,
      logger: (msg: string) => logger.info(msg),
    });

    const plannedSafe = printPlannedSafeOperations(planResult);
    printRemainingRoles(planResult);
    logStatistics(planResult, "Planning");

    if (plannedSafe === 0) {
      logger.success("\nNo Safe revocations required.");
      return;
    }

    if (options.dryRunOnly) {
      logger.info("\nDry-run only flag supplied; exiting without Safe batch creation.");
      return;
    }

    if (!options.yes) {
      const confirmed = await promptYesNo("\nQueue Safe revoke transactions now? (yes/no): ");
      if (!confirmed) {
        logger.info("Aborted by user.");
        return;
      }
    }

    const executionResult = await runRoleManifest({
      hre,
      manifest: revokeManifest,
      logger: (msg: string) => logger.info(msg),
      jsonOutputPath: options.jsonOutput,
      dryRun: false,
    });

    summarizeResult(executionResult);
    printRemainingRoles(executionResult);
    logStatistics(executionResult, "Execution");
    logger.success("\nSafe revocation batch prepared.");
  } catch (error) {
    logger.error("Failed to prepare Safe revocations.");
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
