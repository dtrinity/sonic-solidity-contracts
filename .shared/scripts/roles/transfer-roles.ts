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

function printPlannedOperations(result: RunnerResult): number {
  let planned = 0;

  logger.info("\n--- Planned Operations ---");
  for (const contract of result.contracts) {
    const plannedOps = contract.operations.filter((op) => op.status === "planned");
    if (plannedOps.length === 0) continue;

    logger.info(`- ${contract.alias ?? contract.deployment}${contract.address ? ` (${contract.address})` : ""}`);
    for (const op of plannedOps) {
      logger.info(`  • ${describeOperation(op)}`);
    }
    planned += plannedOps.length;
  }

  if (planned === 0) {
    logger.info("No operations required.");
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

function describeOperation(op: OperationReport): string {
  const base = `${op.type} [${op.mode}]`;
  if (op.status === "planned") return `${base} (planned)`;
  if (op.status === "executed") return `${base} (tx: ${op.txHash ?? "unknown"})`;
  if (op.status === "queued") return `${base} (queued)`;
  if (op.status === "skipped") return `${base} (skipped${op.details ? `: ${op.details}` : ""})`;
  return `${base} (failed${op.details ? `: ${op.details}` : ""})`;
}

function summarizeResult(result: RunnerResult): void {
  logger.info("\n--- Execution Summary ---");
  let executed = 0;
  let queued = 0;

  for (const contract of result.contracts) {
    for (const op of contract.operations) {
      if (op.status === "executed") executed += 1;
      if (op.status === "queued") queued += 1;
    }
  }

  logger.info(`Direct operations executed: ${executed}`);
  logger.info(`Safe operations queued: ${queued}`);

  if (result.safeBatch) {
    logger.info(`Safe batch description: ${result.safeBatch.description}`);
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
    .description("Transfer ownership and DEFAULT_ADMIN_ROLE using a manifest-driven workflow.")
    .requiredOption("-m, --manifest <path>", "Path to the role manifest JSON")
    .option("-n, --network <name>", "Hardhat network to target")
    .option("--json-output <path>", "Write execution report JSON to path (overrides manifest output)")
    .option("--dry-run-only", "Run planning step without executing on-chain actions")
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

    logger.info(`Loaded manifest for deployer ${manifest.deployer} → governance ${manifest.governance}`);
    logger.info(`Auto-included Ownable transfers: ${manifest.autoInclude.ownable ? "enabled" : "disabled"}`);
    logger.info(`Auto-included DEFAULT_ADMIN_ROLE transfers: ${manifest.autoInclude.defaultAdmin ? "enabled" : "disabled"}`);
    logger.info(`Overrides declared: ${manifest.overrides.length}`);

    const planResult = await runRoleManifest({
      hre,
      manifest,
      dryRun: true,
      logger: (msg: string) => logger.info(msg),
    });

    const plannedCount = printPlannedOperations(planResult);
    printRemainingRoles(planResult);
    logStatistics(planResult, "Planning");

    if (plannedCount === 0) {
      logger.success("\nNothing to execute. Governance and ownership already aligned.");
      return;
    }

    if (options.dryRunOnly) {
      logger.info("\nDry-run only flag supplied; exiting without execution.");
      return;
    }

    if (!options.yes) {
      const confirmed = await promptYesNo("\nProceed to execute these operations on-chain? (yes/no): ");
      if (!confirmed) {
        logger.info("Aborted by user.");
        return;
      }
    }

    const executionResult = await runRoleManifest({
      hre,
      manifest,
      logger: (msg: string) => logger.info(msg),
      jsonOutputPath: options.jsonOutput,
      dryRun: false,
    });

    summarizeResult(executionResult);
    printRemainingRoles(executionResult);
    logStatistics(executionResult, "Execution");
    logger.success("\nRole migration completed.");
  } catch (error) {
    logger.error("Failed to execute role migration.");
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
