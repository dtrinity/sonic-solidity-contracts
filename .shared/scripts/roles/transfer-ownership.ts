#!/usr/bin/env ts-node

import { Command } from "commander";
import * as readline from "readline";

import { logger } from "../../lib/logger";
import { scanRolesAndOwnership } from "../../lib/roles/scan";
import { loadRoleManifest, resolveRoleManifest } from "../../lib/roles/manifest";
import { prepareContractPlans, isDeploymentExcluded } from "../../lib/roles/planner";

type ScanResult = Awaited<ReturnType<typeof scanRolesAndOwnership>>;

type ManifestSource = "auto" | "override";

interface TransferTarget {
  readonly deployment: string;
  readonly contractName: string;
  readonly address: string;
  readonly currentOwner: string;
  readonly newOwner: string;
  readonly manifestSource: ManifestSource;
  readonly abi: ScanResult["ownableContracts"][number]["abi"];
}

interface ContractRef {
  readonly deployment: string;
  readonly contractName: string;
  readonly address: string;
  readonly manifestSource: ManifestSource;
}

interface OptOutRef {
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
    .description("Transfer Ownable contracts from the deployer to governance as defined in the manifest.")
    .requiredOption("-m, --manifest <path>", "Path to the role manifest JSON")
    .requiredOption("-n, --network <name>", "Hardhat network to target")
    .option("--deployments-dir <path>", "Path to deployments directory (defaults to hardhat configured path)")
    .option("--hardhat-config <path>", "Path to hardhat.config.ts (defaults to ./hardhat.config.ts)")
    .option("--dry-run", "Simulate transfers without sending transactions")
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

    const scan = await scanRolesAndOwnership({
      hre,
      deployer: manifest.deployer,
      governanceMultisig: manifest.governance,
      deploymentsPath: options.deploymentsDir,
      logger: (msg: string) => logger.info(msg),
    });

    const rolesByDeployment = new Map(scan.rolesContracts.map((info) => [info.deploymentName, info]));
    const ownableByDeployment = new Map(scan.ownableContracts.map((info) => [info.deploymentName, info]));
    const plans = prepareContractPlans({ manifest, rolesByDeployment, ownableByDeployment });

    const actionable: TransferTarget[] = [];
    const skippedAlreadyOwned: ContractRef[] = [];
    const skippedNotOwner: ContractRef[] = [];
    const missingOwnable: ContractRef[] = [];
    const manifestOptOuts: OptOutRef[] = [];

    for (const plan of plans) {
      if (!plan.ownable) {
        continue;
      }

      const ownableInfo = ownableByDeployment.get(plan.deployment);
      const manifestSource: ManifestSource = (plan.ownableSource ?? "auto") as ManifestSource;

      if (!ownableInfo) {
        missingOwnable.push({
          deployment: plan.deployment,
          contractName: plan.alias ?? plan.deployment,
          address: "unknown",
          manifestSource,
        });
        continue;
      }

      if (ownableInfo.governanceIsOwner) {
        skippedAlreadyOwned.push({
          deployment: plan.deployment,
          contractName: ownableInfo.name,
          address: ownableInfo.address,
          manifestSource,
        });
        continue;
      }

      if (!ownableInfo.deployerIsOwner) {
        skippedNotOwner.push({
          deployment: plan.deployment,
          contractName: ownableInfo.name,
          address: ownableInfo.address,
          manifestSource,
        });
        continue;
      }

      actionable.push({
        deployment: plan.deployment,
        contractName: ownableInfo.name,
        address: ownableInfo.address,
        currentOwner: ownableInfo.owner,
        newOwner: plan.ownable.newOwner,
        manifestSource,
        abi: ownableInfo.abi,
      });
    }

    for (const ownableInfo of scan.ownableContracts) {
      if (!ownableInfo.deployerIsOwner) {
        continue;
      }

      const plan = plans.find((p) => p.deployment === ownableInfo.deploymentName);
      if (plan?.ownable) {
        continue;
      }

      if (isDeploymentExcluded(manifest, ownableInfo.deploymentName, "ownable")) {
        manifestOptOuts.push({
          deployment: ownableInfo.deploymentName,
          contractName: ownableInfo.name,
          address: ownableInfo.address,
          reason: "Manifest exclusion",
        });
        continue;
      }

      const override = manifest.overrides.find((o) => o.deployment === ownableInfo.deploymentName);
      if (override?.ownable?.enabled === false) {
        manifestOptOuts.push({
          deployment: ownableInfo.deploymentName,
          contractName: ownableInfo.name,
          address: ownableInfo.address,
          reason: "Override disabled ownable actions",
        });
        continue;
      }

      if (!manifest.autoInclude.ownable) {
        manifestOptOuts.push({
          deployment: ownableInfo.deploymentName,
          contractName: ownableInfo.name,
          address: ownableInfo.address,
          reason: "Auto-include disabled and no override present",
        });
      }
    }

    logger.info("\n=== Ownership Transfer Plan ===");
    logger.info(`Pending transfers: ${actionable.length}`);
    logger.info(`Already owned by governance: ${skippedAlreadyOwned.length}`);
    logger.info(`Skipped (deployer not owner): ${skippedNotOwner.length}`);
    logger.info(`Missing Ownable metadata: ${missingOwnable.length}`);
    logger.info(`Manifest opt-outs: ${manifestOptOuts.length}`);

    if (actionable.length === 0) {
      logger.success("\nNo ownership transfers required.");
      await emitJson(options.jsonOutput, {
        status: "no-action",
        executed: [],
        skippedAlreadyOwned,
        skippedNotOwner,
        missingOwnable,
        manifestOptOuts,
        failures: [],
      });
      return;
    }

    logger.warn("\n⚠️ Ownership transfers are irreversible. Verify each target carefully before proceeding.");
    actionable.forEach((item, index) => {
      logger.info(
        `- [${index + 1}/${actionable.length}] ${item.contractName} (${item.address}) :: owner=${item.currentOwner} -> ${item.newOwner} (${item.manifestSource})`,
      );
    });

    if (!dryRun && !options.yes) {
      const confirmed = await promptYesNo("\nProceed with ownership transfers? (yes/no): ");
      if (!confirmed) {
        logger.info("Aborted by user.");
        return;
      }
    }

    const signer = await hre.ethers.getSigner(manifest.deployer);
    const executed: TransferTarget[] = [];
    const failures: { target: TransferTarget; error: string }[] = [];

    for (let index = 0; index < actionable.length; index += 1) {
      const target = actionable[index];
      logger.info(`\n[${index + 1}/${actionable.length}] Transferring ownership of ${target.contractName} (${target.address})`);

      try {
        const contract = await hre.ethers.getContractAt(target.abi as any, target.address, signer);

        if (dryRun) {
          logger.info("  [dry-run] Would call transferOwnership(newOwner)");
          executed.push(target);
          continue;
        }

        const tx = await contract.transferOwnership(target.newOwner);
        const receipt = await tx.wait();
        const txHash = receipt?.hash ?? tx.hash ?? "unknown";
        logger.info(`  ✅ Transaction hash: ${txHash}`);
        executed.push(target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`  ❌ Failed to transfer ownership: ${message}`);
        failures.push({ target, error: message });
      }
    }

    logger.info("\n=== Summary ===");
    logger.info(`Transfers executed: ${executed.length}`);
    logger.info(`Already owned by governance: ${skippedAlreadyOwned.length}`);
    logger.info(`Skipped (deployer not owner): ${skippedNotOwner.length}`);
    logger.info(`Manifest opt-outs: ${manifestOptOuts.length}`);
    logger.info(`Failures: ${failures.length}`);

    if (manifestOptOuts.length > 0) {
      logger.info("\nManifest opt-outs:");
      for (const opt of manifestOptOuts) {
        logger.info(`- ${opt.contractName} (${opt.address}) :: ${opt.reason}`);
      }
    }

    if (failures.length > 0) {
      logger.error("\nFailures:");
      for (const failure of failures) {
        logger.error(`- ${failure.target.contractName} (${failure.target.address}) :: ${failure.error}`);
      }
    }

    await emitJson(options.jsonOutput, {
      status: dryRun ? "dry-run" : "executed",
      executed,
      skippedAlreadyOwned,
      skippedNotOwner,
      missingOwnable,
      manifestOptOuts,
      failures,
    });
  } catch (error) {
    logger.error("Failed to transfer ownership.");
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

async function emitJson(
  outputPath: string | undefined,
  payload: {
    status: "executed" | "dry-run" | "no-action";
    executed: TransferTarget[];
    skippedAlreadyOwned: ContractRef[];
    skippedNotOwner: ContractRef[];
    missingOwnable: ContractRef[];
    manifestOptOuts: OptOutRef[];
    failures: { target: TransferTarget; error: string }[];
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
