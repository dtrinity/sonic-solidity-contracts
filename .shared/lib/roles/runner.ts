import { Interface } from "@ethersproject/abi";

import { logger as sharedLogger } from "../logger";

import { SafeManager } from "./safe-manager";
import { OwnableContractInfo, RolesContractInfo, scanRolesAndOwnership } from "./scan";
import { SafeTransactionData } from "./types";
import {
  ExecutionMode,
  ManifestValidationError,
  ResolvedDefaultAdminAction,
  ResolvedOwnableAction,
  ResolvedRoleManifest,
} from "./manifest";
import { ActionSource, PreparedContractPlan, prepareContractPlans } from "./planner";

type HardhatRuntimeEnvironment = any;

type OperationType =
  | "transferOwnership"
  | "grantDefaultAdmin"
  | "renounceDefaultAdmin"
  | "revokeDefaultAdmin";

type OperationStatus = "executed" | "queued" | "skipped" | "failed" | "planned";

export interface OperationReport {
  readonly type: OperationType;
  readonly mode: ExecutionMode;
  readonly status: OperationStatus;
  readonly details?: string;
  readonly txHash?: string;
}

export interface RemainingRoleInfo {
  readonly role: string;
  readonly hash: string;
  readonly deployerHasRole: boolean;
  readonly governanceHasRole: boolean;
}

export interface ContractReportMetadata {
  readonly ownableSource?: ActionSource;
  readonly defaultAdminSource?: ActionSource;
}

export interface ContractReport {
  readonly deployment: string;
  readonly alias?: string;
  readonly address?: string;
  readonly operations: OperationReport[];
  readonly remainingRoles: RemainingRoleInfo[];
  readonly notes?: string;
  readonly errors: string[];
  readonly metadata?: ContractReportMetadata;
}

export interface SafeBatchSummary {
  readonly description: string;
  readonly transactionCount: number;
  readonly safeTxHash?: string;
  readonly success: boolean;
  readonly error?: string;
}

export interface RunnerStatistics {
  readonly totalContracts: number;
  readonly autoIncludedOwnable: number;
  readonly autoIncludedDefaultAdmin: number;
  readonly overrideOwnable: number;
  readonly overrideDefaultAdmin: number;
}

export interface RunnerResult {
  readonly contracts: ContractReport[];
  readonly totalDirectOperations: number;
  readonly totalSafeOperations: number;
  readonly safeBatch?: SafeBatchSummary;
  readonly statistics?: RunnerStatistics;
}

export interface RunManifestOptions {
  readonly hre: HardhatRuntimeEnvironment;
  readonly manifest: ResolvedRoleManifest;
  readonly logger?: (message: string) => void;
  readonly jsonOutputPath?: string;
  readonly dryRun?: boolean;
}

export async function runRoleManifest(options: RunManifestOptions): Promise<RunnerResult> {
  const { hre, manifest } = options;
  const log = options.logger ?? ((message: string) => sharedLogger.info(message));

  const { ethers, deployments } = hre;

  let deployerSigner;
  try {
    deployerSigner = await ethers.getSigner(manifest.deployer);
  } catch (error) {
    throw new ManifestValidationError(
      `Unable to obtain signer for deployer ${manifest.deployer}. Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let signerAddress: string;
  try {
    signerAddress = await deployerSigner.getAddress();
  } catch {
    signerAddress = manifest.deployer;
  }

  const signerAddressLower = signerAddress.toLowerCase();
  const dryRun = options.dryRun ?? false;

  log(`Scanning deployments for network ${hre.network.name}...`);
  const scan = await scanRolesAndOwnership({
    hre,
    deployer: manifest.deployer,
    governanceMultisig: manifest.governance,
  });

  const rolesByDeployment = new Map(scan.rolesContracts.map((info) => [info.deploymentName, info]));
  const ownableByDeployment = new Map(scan.ownableContracts.map((info) => [info.deploymentName, info]));

  const plans = prepareContractPlans({ manifest, rolesByDeployment, ownableByDeployment });

  const safeTransactions: SafeTransactionData[] = [];
  const contractReports: ContractReport[] = [];
  let totalDirectOperations = 0;
  let autoIncludedOwnable = 0;
  let autoIncludedDefaultAdmin = 0;
  let overrideOwnable = 0;
  let overrideDefaultAdmin = 0;

  for (const plan of plans) {
    const reportOperations: OperationReport[] = [];
    const reportErrors: string[] = [];
    const remainingRoles: RemainingRoleInfo[] = [];

    const deployment = await deployments.getOrNull(plan.deployment);

    if (!deployment) {
      reportErrors.push(`Deployment ${plan.deployment} not found.`);
      contractReports.push({
        deployment: plan.deployment,
        alias: plan.alias,
        operations: reportOperations,
        remainingRoles,
        notes: plan.notes,
        errors: reportErrors,
        metadata: buildMetadata(plan),
      });
      continue;
    }

    const contractName = plan.alias || deployment.contractName || plan.deployment;
    const address = deployment.address;

    log(`\nProcessing ${contractName} (${address})`);

    const rolesInfo = rolesByDeployment.get(plan.deployment);
    const ownableInfo = ownableByDeployment.get(plan.deployment);

    if (plan.ownable) {
      if (plan.ownableSource === "auto") {
        autoIncludedOwnable += 1;
      } else if (plan.ownableSource === "override") {
        overrideOwnable += 1;
      }

      const result = await handleOwnableAction({
        hre,
        deployment,
        action: plan.ownable,
        ownableInfo,
        deployerSigner,
        signerAddress,
        signerAddressLower,
        contractName,
        dryRun,
        log,
      });

      reportOperations.push(result);
      if (result.status === "executed") {
        totalDirectOperations += 1;
      }
    }

    if (plan.defaultAdmin) {
      if (plan.defaultAdminSource === "auto") {
        autoIncludedDefaultAdmin += 1;
      } else if (plan.defaultAdminSource === "override") {
        overrideDefaultAdmin += 1;
      }

      const { operations, errors } = await handleDefaultAdminAction({
        hre,
        deployment,
        action: plan.defaultAdmin,
        deployerSigner,
        signerAddressLower,
        contractName,
        rolesInfo,
        safeTransactions,
        dryRun,
        log,
      });

      reportOperations.push(...operations);

      for (const op of operations) {
        if (op.status === "executed") {
          totalDirectOperations += 1;
        }
      }

      reportErrors.push(...errors);
    }

    if (rolesInfo) {
      for (const role of rolesInfo.roles) {
        if (role.name === "DEFAULT_ADMIN_ROLE") continue;

        const deployerHasRole = rolesInfo.rolesHeldByDeployer.some((r) => r.hash === role.hash);
        const governanceHasRole = rolesInfo.rolesHeldByGovernance.some((r) => r.hash === role.hash);

        remainingRoles.push({
          role: role.name,
          hash: role.hash,
          deployerHasRole,
          governanceHasRole,
        });
      }
    }

    contractReports.push({
      deployment: plan.deployment,
      alias: plan.alias,
      address,
      operations: reportOperations,
      remainingRoles,
      notes: plan.notes,
      errors: reportErrors,
      metadata: buildMetadata(plan),
    });
  }

  let safeBatchSummary: SafeBatchSummary | undefined;

  if (!dryRun && safeTransactions.length > 0) {
    if (!manifest.safe) {
      throw new ManifestValidationError(
        `Safe transactions were requested but manifest.safe is not configured.`,
      );
    }

    const description = manifest.safe.description || `Role revocations (${safeTransactions.length} operations)`;

    const safeManager = new SafeManager(hre, deployerSigner, {
      safeConfig: manifest.safe,
      signingMode: "none",
    });

    await safeManager.initialize();

    const result = await safeManager.createBatchTransaction({
      transactions: safeTransactions,
      description,
    });

    safeBatchSummary = {
      description,
      transactionCount: safeTransactions.length,
      safeTxHash: result.safeTxHash,
      success: result.success,
      error: result.error,
    };
  }

  const runnerResult: RunnerResult = {
    contracts: contractReports,
    totalDirectOperations,
    totalSafeOperations: safeTransactions.length,
    safeBatch: safeBatchSummary,
    statistics: {
      totalContracts: plans.length,
      autoIncludedOwnable,
      autoIncludedDefaultAdmin,
      overrideOwnable,
      overrideDefaultAdmin,
    },
  };

  const outputPath = options.jsonOutputPath || manifest.output?.json;

  if (outputPath) {
    const fs = require("fs");
    const path = require("path");
    const resolvedPath = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);
    fs.writeFileSync(resolvedPath, JSON.stringify(runnerResult, null, 2));
    log(`Saved JSON report to ${resolvedPath}`);
  }

  return runnerResult;
}

function buildMetadata(plan: PreparedContractPlan): ContractReportMetadata | undefined {
  const metadata: ContractReportMetadata = {
    ...(plan.ownableSource ? { ownableSource: plan.ownableSource } : {}),
    ...(plan.defaultAdminSource ? { defaultAdminSource: plan.defaultAdminSource } : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

interface OwnableActionContext {
  readonly hre: HardhatRuntimeEnvironment;
  readonly deployment: any;
  readonly action: ResolvedOwnableAction;
  readonly ownableInfo?: OwnableContractInfo;
  readonly deployerSigner: any;
  readonly signerAddress: string;
  readonly signerAddressLower: string;
  readonly contractName: string;
  readonly dryRun: boolean;
  readonly log: (message: string) => void;
}

async function handleOwnableAction(context: OwnableActionContext): Promise<OperationReport> {
  const { hre, deployment, action, ownableInfo, deployerSigner, signerAddress, signerAddressLower, contractName, dryRun, log } = context;

  const mode = action.execution;

  if (!ownableInfo) {
    return {
      type: "transferOwnership",
      mode,
      status: "skipped",
      details: "Contract does not expose Ownable owner().",
    };
  }

  if (mode !== "direct") {
    return {
      type: "transferOwnership",
      mode,
      status: "skipped",
      details: "Ownable transfers must be executed directly by the current owner.",
    };
  }

  const contract = await hre.ethers.getContractAt(deployment.abi as any, deployment.address, deployerSigner);

  try {
    const currentOwner: string = await contract.owner();
    if (currentOwner.toLowerCase() === action.newOwner.toLowerCase()) {
      log(`  Ownership already transferred to ${action.newOwner}; skipping.`);
      return {
        type: "transferOwnership",
        mode,
        status: "skipped",
        details: "Target already owns the contract.",
      };
    }

    if (currentOwner.toLowerCase() !== signerAddressLower) {
      log(`  Current owner is ${currentOwner}; deployer signer ${signerAddress} is required.`);
      return {
        type: "transferOwnership",
        mode,
        status: "skipped",
        details: `Current owner ${currentOwner} differs from signer ${signerAddress}.`,
      };
    }

    if (dryRun) {
      log(`  [dry-run] Would transfer ownership of ${contractName} to ${action.newOwner}`);
      return {
        type: "transferOwnership",
        mode,
        status: "planned",
        details: `Would call transferOwnership(${action.newOwner})`,
      };
    }

    log(`  Transferring ownership of ${contractName} to ${action.newOwner}`);
    const tx = await contract.transferOwnership(action.newOwner);
    const receipt = await tx.wait();
    return {
      type: "transferOwnership",
      mode,
      status: "executed",
      txHash: receipt?.transactionHash,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`  Failed to transfer ownership: ${message}`);
    return {
      type: "transferOwnership",
      mode,
      status: "failed",
      details: message,
    };
  }
}

interface DefaultAdminActionContext {
  readonly hre: HardhatRuntimeEnvironment;
  readonly deployment: any;
  readonly action: ResolvedDefaultAdminAction;
  readonly deployerSigner: any;
  readonly signerAddressLower: string;
  readonly contractName: string;
  readonly rolesInfo: RolesContractInfo | undefined;
  readonly safeTransactions: SafeTransactionData[];
  readonly dryRun: boolean;
  readonly log: (message: string) => void;
}

async function handleDefaultAdminAction(context: DefaultAdminActionContext): Promise<{
  operations: OperationReport[];
  errors: string[];
}> {
  const { hre, deployment, action, deployerSigner, signerAddressLower, contractName, rolesInfo, safeTransactions, dryRun, log } = context;
  const operations: OperationReport[] = [];
  const errors: string[] = [];

  if (!rolesInfo || !rolesInfo.defaultAdminRoleHash) {
    errors.push(`No DEFAULT_ADMIN_ROLE detected for ${contractName}.`);
    return { operations, errors };
  }

  const roleHash = rolesInfo.defaultAdminRoleHash;
  const contract = await hre.ethers.getContractAt(deployment.abi as any, deployment.address, deployerSigner);

  if (action.grantExecution === "direct") {
    try {
      const hasRole = await contract.hasRole(roleHash, action.newAdmin);
      if (!hasRole) {
        if (dryRun) {
          log(`  [dry-run] Would grant DEFAULT_ADMIN_ROLE to ${action.newAdmin}`);
          operations.push({
            type: "grantDefaultAdmin",
            mode: "direct",
            status: "planned",
            details: `Would call grantRole(DEFAULT_ADMIN_ROLE, ${action.newAdmin})`,
          });
        } else {
          log(`  Granting DEFAULT_ADMIN_ROLE to ${action.newAdmin}`);
          const tx = await contract.grantRole(roleHash, action.newAdmin);
          const receipt = await tx.wait();
          operations.push({
            type: "grantDefaultAdmin",
            mode: "direct",
            status: "executed",
            txHash: receipt?.transactionHash,
          });
        }
      } else {
        log(`  ${action.newAdmin} already has DEFAULT_ADMIN_ROLE; skipping grant.`);
        operations.push({
          type: "grantDefaultAdmin",
          mode: "direct",
          status: "skipped",
          details: "New admin already holds the role.",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`  Failed to grant DEFAULT_ADMIN_ROLE: ${message}`);
      operations.push({
        type: "grantDefaultAdmin",
        mode: "direct",
        status: "failed",
        details: message,
      });
    }
  }

  const removal = action.removal;
  if (!removal) {
    log("  Removal step disabled; deployer will retain DEFAULT_ADMIN_ROLE until handled separately.");
    return { operations, errors };
  }

  const iface = new Interface(deployment.abi as any);
  const targetAddress = removal.address;

  if (removal.execution === "direct") {
    try {
      if (removal.strategy === "renounce") {
        if (targetAddress.toLowerCase() !== signerAddressLower) {
          const detail = `Renounce requires signer ${targetAddress}. Update manifest or use Safe revoke.`;
          log(`  ${detail}`);
          operations.push({
            type: "renounceDefaultAdmin",
            mode: "direct",
            status: "skipped",
            details: detail,
          });
        } else {
          const hasRole = await contract.hasRole(roleHash, targetAddress);
          if (!hasRole) {
            log(`  ${targetAddress} does not hold DEFAULT_ADMIN_ROLE; skipping renounce.`);
            operations.push({
              type: "renounceDefaultAdmin",
              mode: "direct",
              status: "skipped",
              details: "Role already removed from deployer.",
            });
          } else {
            if (dryRun) {
              log(`  [dry-run] Would renounce DEFAULT_ADMIN_ROLE from ${targetAddress}`);
              operations.push({
                type: "renounceDefaultAdmin",
                mode: "direct",
                status: "planned",
                details: `Would call renounceRole(DEFAULT_ADMIN_ROLE, ${targetAddress})`,
              });
            } else {
              log(`  Renouncing DEFAULT_ADMIN_ROLE from ${targetAddress}`);
              const tx = await contract.renounceRole(roleHash, targetAddress);
              const receipt = await tx.wait();
              operations.push({
                type: "renounceDefaultAdmin",
                mode: "direct",
                status: "executed",
                txHash: receipt?.transactionHash,
              });
            }
          }
        }
      } else {
        const hasRole = await contract.hasRole(roleHash, targetAddress);
        if (!hasRole) {
          log(`  ${targetAddress} does not hold DEFAULT_ADMIN_ROLE; skipping revoke.`);
          operations.push({
            type: "revokeDefaultAdmin",
            mode: "direct",
            status: "skipped",
            details: "Role already removed.",
          });
        } else {
          if (dryRun) {
            log(`  [dry-run] Would revoke DEFAULT_ADMIN_ROLE from ${targetAddress}`);
            operations.push({
              type: "revokeDefaultAdmin",
              mode: "direct",
              status: "planned",
              details: `Would call revokeRole(DEFAULT_ADMIN_ROLE, ${targetAddress})`,
            });
          } else {
            log(`  Revoking DEFAULT_ADMIN_ROLE from ${targetAddress}`);
            const tx = await contract.revokeRole(roleHash, targetAddress);
            const receipt = await tx.wait();
            operations.push({
              type: "revokeDefaultAdmin",
              mode: "direct",
              status: "executed",
              txHash: receipt?.transactionHash,
            });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`  Failed to remove DEFAULT_ADMIN_ROLE: ${message}`);
      operations.push({
        type: removal.strategy === "renounce" ? "renounceDefaultAdmin" : "revokeDefaultAdmin",
        mode: "direct",
        status: "failed",
        details: message,
      });
    }
  } else {
    if (removal.strategy !== "revoke") {
      const detail = "Safe execution requires the revoke strategy.";
      log(`  ${detail}`);
      operations.push({
        type: "revokeDefaultAdmin",
        mode: "safe",
        status: "skipped",
        details: detail,
      });
    } else {
      const hasRole = await contract.hasRole(roleHash, targetAddress);
      if (!hasRole) {
        log(`  ${targetAddress} does not hold DEFAULT_ADMIN_ROLE; skipping Safe revoke.`);
        operations.push({
          type: "revokeDefaultAdmin",
          mode: "safe",
          status: "skipped",
          details: "Role already removed.",
        });
      } else {
        if (dryRun) {
          log(`  [dry-run] Would queue Safe revokeRole for ${targetAddress}`);
          operations.push({
            type: "revokeDefaultAdmin",
            mode: "safe",
            status: "planned",
            details: `Would queue revokeRole for ${targetAddress}`,
          });
        } else {
          log(`  Queueing Safe revokeRole for ${targetAddress}`);
          safeTransactions.push({
            to: deployment.address,
            value: "0",
            data: iface.encodeFunctionData("revokeRole", [roleHash, targetAddress]),
          });
          operations.push({
            type: "revokeDefaultAdmin",
            mode: "safe",
            status: "queued",
            details: `Queued revokeRole for ${targetAddress}`,
          });
        }
      }
    }
  }

  return { operations, errors };
}
