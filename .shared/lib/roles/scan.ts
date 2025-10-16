import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AbiItem } from "web3-utils";
import { Interface } from "@ethersproject/abi";
import * as fs from "fs";
import * as path from "path";

import {
  DEFAULT_MULTICALL3_ADDRESS,
  executeMulticallBatches,
  MulticallRequest,
  MulticallResult,
} from "./multicall";

type FunctionAbiItem = AbiItem & {
  readonly type: "function";
  readonly name: string;
  readonly stateMutability?: string;
  readonly inputs?: { readonly type: string }[];
  readonly outputs?: { readonly type: string }[];
};

function isAbiFunctionFragment(item: AbiItem): item is FunctionAbiItem {
  const fragment = item as { type?: string; name?: unknown };
  return fragment.type === "function" && typeof fragment.name === "string";
}

interface DeploymentSummary {
  readonly deploymentName: string;
  readonly contractName: string;
  readonly address: string;
  readonly abi: AbiItem[];
}

interface RoleContractContext extends DeploymentSummary {
  readonly iface: Interface;
  readonly hasRoleFragment: FunctionAbiItem;
  readonly roleConstantFragments: FunctionAbiItem[];
  readonly roleHashes: Map<string, string>;
}

interface RoleConstantTask {
  readonly context: RoleContractContext;
  readonly functionName: string;
  readonly request: MulticallRequest;
}

interface HasRoleTask {
  readonly context: RoleContractContext;
  readonly role: RoleInfo;
  readonly holder: "deployer" | "governance";
  readonly request: MulticallRequest;
}

export interface RoleInfo {
  readonly name: string;
  readonly hash: string;
}

export interface RolesContractInfo {
  readonly deploymentName: string;
  readonly name: string;
  readonly address: string;
  readonly abi: AbiItem[];
  readonly roles: RoleInfo[];
  readonly rolesHeldByDeployer: RoleInfo[];
  readonly rolesHeldByGovernance: RoleInfo[];
  readonly defaultAdminRoleHash?: string;
  governanceHasDefaultAdmin: boolean;
}

export interface OwnableContractInfo {
  readonly deploymentName: string;
  readonly name: string;
  readonly address: string;
  readonly abi: AbiItem[];
  readonly owner: string;
  readonly deployerIsOwner: boolean;
  readonly governanceIsOwner: boolean;
}

export interface ScanTelemetry {
  startedAt: number;
  completedAt: number;
  durationMs: number;
  deploymentsEvaluated: number;
  rolesContractsEvaluated: number;
  ownableContractsEvaluated: number;
  multicall: {
    supported: boolean;
    batchesExecuted: number;
    requestsAttempted: number;
    fallbacks: number;
  };
  directCalls: {
    roleConstants: number;
    hasRole: number;
    owner: number;
  };
}

export interface ScanResult {
  readonly rolesContracts: RolesContractInfo[];
  readonly ownableContracts: OwnableContractInfo[];
  readonly stats: ScanTelemetry;
}

export interface ScanOptions {
  readonly hre: HardhatRuntimeEnvironment;
  readonly deployer: string;
  readonly governanceMultisig: string;
  readonly deploymentsPath?: string;
  readonly logger?: (message: string) => void;
  readonly multicallAddress?: string;
}

function detectHasRoleFragment(abi: AbiItem[]): FunctionAbiItem | undefined {
  return abi.find(
    (item): item is FunctionAbiItem =>
      isAbiFunctionFragment(item) &&
      item.name === "hasRole" &&
      (item.inputs?.length ?? 0) === 2 &&
      item.inputs?.[0].type === "bytes32" &&
      item.inputs?.[1].type === "address" &&
      (item.outputs?.length ?? 0) === 1 &&
      item.outputs?.[0].type === "bool",
  );
}

function detectOwnableFragment(abi: AbiItem[]): FunctionAbiItem | undefined {
  return abi.find(
    (item): item is FunctionAbiItem =>
      isAbiFunctionFragment(item) &&
      item.name === "owner" &&
      (item.inputs?.length ?? 0) === 0 &&
      (item.outputs?.length ?? 0) === 1 &&
      item.outputs?.[0].type === "address",
  );
}

function detectRoleConstantFragments(abi: AbiItem[]): FunctionAbiItem[] {
  return abi
    .filter(isAbiFunctionFragment)
    .filter(
      (item) =>
        (item.stateMutability === "view" || item.stateMutability === "pure") &&
        (item.name === "DEFAULT_ADMIN_ROLE" || item.name.endsWith("_ROLE")) &&
        (item.inputs?.length ?? 0) === 0 &&
        (item.outputs?.length ?? 0) === 1 &&
        item.outputs?.[0].type === "bytes32",
    )
    .map((item) => item as FunctionAbiItem);
}

async function decodeViaProvider(
  hre: HardhatRuntimeEnvironment,
  context: RoleContractContext,
  functionName: string,
  args: readonly unknown[],
): Promise<MulticallResult | null> {
  const iface = context.iface;
  const data = iface.encodeFunctionData(functionName, args);
  try {
    const returnData = await (hre as any).ethers.provider.call({
      to: context.address,
      data,
    });
    return { success: true, returnData };
  } catch {
    return null;
  }
}

export async function scanRolesAndOwnership(options: ScanOptions): Promise<ScanResult> {
  const { hre, deployer, governanceMultisig, logger } = options;
  const ethers = (hre as any).ethers;
  const network = (hre as any).network;
  const log = logger ?? (() => {});
  const multicallAddress = options.multicallAddress ?? DEFAULT_MULTICALL3_ADDRESS;

  const startedAt = Date.now();
  const telemetry: ScanTelemetry = {
    startedAt,
    completedAt: startedAt,
    durationMs: 0,
    deploymentsEvaluated: 0,
    rolesContractsEvaluated: 0,
    ownableContractsEvaluated: 0,
    multicall: {
      supported: true,
      batchesExecuted: 0,
      requestsAttempted: 0,
      fallbacks: 0,
    },
    directCalls: {
      roleConstants: 0,
      hasRole: 0,
      owner: 0,
    },
  };

  const deploymentsPath = options.deploymentsPath || path.join((hre as any).config.paths.deployments, network.name);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Deployments directory not found for network ${network.name}: ${deploymentsPath}`);
  }

  const deploymentFiles = fs
    .readdirSync(deploymentsPath)
    .filter((f) => f.endsWith(".json") && f !== ".migrations.json" && f !== "solcInputs");

  const deployments: DeploymentSummary[] = [];
  for (const filename of deploymentFiles) {
    try {
      const artifactPath = path.join(deploymentsPath, filename);
      const deployment = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      deployments.push({
        deploymentName: filename.replace(".json", ""),
        contractName: deployment.contractName ?? filename.replace(".json", ""),
        address: deployment.address,
        abi: deployment.abi as AbiItem[],
      });
    } catch {
      // ignore malformed deployment files
    }
  }

  telemetry.deploymentsEvaluated = deployments.length;

  const roleContexts: RoleContractContext[] = [];
  const ownableCandidates: { summary: DeploymentSummary; fragment: FunctionAbiItem }[] = [];

  for (const summary of deployments) {
    const hasRoleFragment = detectHasRoleFragment(summary.abi);
    const ownableFragment = detectOwnableFragment(summary.abi);

    if (hasRoleFragment) {
      const roleConstantFragments = detectRoleConstantFragments(summary.abi);
      roleContexts.push({
        ...summary,
        iface: new Interface(summary.abi as any),
        hasRoleFragment,
        roleConstantFragments,
        roleHashes: new Map<string, string>(),
      });
    }

    if (ownableFragment) {
      ownableCandidates.push({ summary, fragment: ownableFragment });
    }
  }

  telemetry.rolesContractsEvaluated = roleContexts.length;
  telemetry.ownableContractsEvaluated = ownableCandidates.length;

  const constantTasks: RoleConstantTask[] = [];
  for (const context of roleContexts) {
    for (const fragment of context.roleConstantFragments) {
      const functionName = fragment.name;
      const request: MulticallRequest = {
        target: context.address,
        allowFailure: true,
        callData: context.iface.encodeFunctionData(functionName, []),
      };
      constantTasks.push({ context, functionName, request });
    }
  }

  const recordRoleHash = (context: RoleContractContext, roleName: string, hash: string) => {
    if (!context.roleHashes.has(roleName)) {
      context.roleHashes.set(roleName, hash);
    }
  };

  if (constantTasks.length > 0) {
    log(
      `Fetching ${constantTasks.length} role hash constants across ${roleContexts.length} AccessControl contracts via multicall.`,
    );
    const constantBatch = await executeMulticallBatches(hre as any, constantTasks.map((task) => task.request), {
      address: multicallAddress,
      logger: log,
      onBatchComplete: ({ index, total }) => {
        log(`  - role hash batch ${index}/${total} complete`);
      },
    });

    const fallbackTasks: RoleConstantTask[] = [];

    if (constantBatch === null) {
      telemetry.multicall.supported = false;
      telemetry.multicall.fallbacks += constantTasks.length;
      fallbackTasks.push(...constantTasks);
    } else {
      telemetry.multicall.requestsAttempted += constantTasks.length;
      telemetry.multicall.batchesExecuted += constantBatch.batchesExecuted;

      for (let index = 0; index < constantTasks.length; index += 1) {
        const task = constantTasks[index];
        const result = constantBatch.results[index];

        if (!result || !result.success) {
          fallbackTasks.push(task);
          continue;
        }

        try {
          const decoded = task.context.iface.decodeFunctionResult(task.functionName, result.returnData);
          recordRoleHash(task.context, task.functionName, String(decoded[0]));
        } catch {
          fallbackTasks.push(task);
        }
      }

      telemetry.multicall.fallbacks += fallbackTasks.length;
    }

    if (fallbackTasks.length > 0) {
      telemetry.directCalls.roleConstants += fallbackTasks.length;

      await Promise.all(
        fallbackTasks.map(async (task) => {
          const individualResult = await decodeViaProvider(hre, task.context, task.functionName, []);
          if (!individualResult || !individualResult.success) {
            return;
          }

          try {
            const decoded = task.context.iface.decodeFunctionResult(task.functionName, individualResult.returnData);
            recordRoleHash(task.context, task.functionName, String(decoded[0]));
          } catch {
            // ignore failures in fallback decoding
          }
        }),
      );
    }
  }

  const roleContracts: RolesContractInfo[] = [];

  const hasRoleTasks: HasRoleTask[] = [];
  for (const context of roleContexts) {
    const roles: RoleInfo[] = Array.from(context.roleHashes.entries()).map(([name, hash]) => ({
      name,
      hash,
    }));

    const defaultAdmin = roles.find((role) => role.name === "DEFAULT_ADMIN_ROLE");
    const contractRecord: RolesContractInfo = {
      deploymentName: context.deploymentName,
      name: context.contractName,
      address: context.address,
      abi: context.abi,
      roles,
      rolesHeldByDeployer: [],
      rolesHeldByGovernance: [],
      defaultAdminRoleHash: defaultAdmin?.hash,
      governanceHasDefaultAdmin: false,
    };

    roleContracts.push(contractRecord);

    for (const role of roles) {
      hasRoleTasks.push({
        context,
        role,
        holder: "deployer",
        request: {
          target: context.address,
          allowFailure: true,
          callData: context.iface.encodeFunctionData("hasRole", [role.hash, deployer]),
        },
      });

      hasRoleTasks.push({
        context,
        role,
        holder: "governance",
        request: {
          target: context.address,
          allowFailure: true,
          callData: context.iface.encodeFunctionData("hasRole", [role.hash, governanceMultisig]),
        },
      });
    }
  }

  const rolesByContract = new Map<string, RolesContractInfo>();
  for (const contract of roleContracts) {
    rolesByContract.set(contract.address.toLowerCase(), contract);
  }

  const holderSet = {
    deployer: new Map<string, Set<string>>(),
    governance: new Map<string, Set<string>>(),
  };

  const addHeldRole = (contract: RolesContractInfo, holder: "deployer" | "governance", role: RoleInfo) => {
    const registry = holderSet[holder];
    const key = contract.address.toLowerCase();
    const set = registry.get(key) ?? new Set<string>();
    if (!registry.has(key)) {
      registry.set(key, set);
    }
    if (set.has(role.hash)) {
      return;
    }
    set.add(role.hash);
    if (holder === "deployer") {
      contract.rolesHeldByDeployer.push(role);
    } else {
      contract.rolesHeldByGovernance.push(role);
    }
  };

  if (hasRoleTasks.length > 0) {
    let useMulticall = telemetry.multicall.supported;
    const fallbackTasks: HasRoleTask[] = [];
    let attemptedWithMulticall = false;

    if (useMulticall) {
      log(`Checking role holders via multicall (${hasRoleTasks.length} hasRole calls across ${roleContracts.length} contracts).`);
      const hasRoleBatch = await executeMulticallBatches(hre as any, hasRoleTasks.map((task) => task.request), {
        address: multicallAddress,
        logger: log,
        onBatchComplete: ({ index, total }) => {
          log(`  - hasRole batch ${index}/${total} complete`);
        },
      });

      if (hasRoleBatch === null) {
        telemetry.multicall.supported = false;
        useMulticall = false;
        telemetry.multicall.fallbacks += hasRoleTasks.length;
        fallbackTasks.push(...hasRoleTasks);
      } else {
        attemptedWithMulticall = true;
        telemetry.multicall.requestsAttempted += hasRoleTasks.length;
        telemetry.multicall.batchesExecuted += hasRoleBatch.batchesExecuted;

        for (let index = 0; index < hasRoleTasks.length; index += 1) {
          const task = hasRoleTasks[index];
          const result = hasRoleBatch.results[index];

          if (!result || !result.success) {
            fallbackTasks.push(task);
            continue;
          }

          try {
            const decoded = task.context.iface.decodeFunctionResult("hasRole", result.returnData);
            if (Boolean(decoded[0])) {
              const contract = rolesByContract.get(task.context.address.toLowerCase());
              if (contract) {
                addHeldRole(contract, task.holder, task.role);
              }
            }
          } catch {
            fallbackTasks.push(task);
          }
        }

        telemetry.multicall.fallbacks += fallbackTasks.length;
      }
    }

    if (!useMulticall) {
      fallbackTasks.splice(0, fallbackTasks.length, ...hasRoleTasks);
    }

    if (fallbackTasks.length > 0) {
      if (attemptedWithMulticall || !useMulticall) {
        telemetry.directCalls.hasRole += fallbackTasks.length;
      }

      await Promise.all(
        fallbackTasks.map(async (task) => {
          const callResult = await decodeViaProvider(
            hre,
            task.context,
            "hasRole",
            [task.role.hash, task.holder === "deployer" ? deployer : governanceMultisig],
          );

          if (!callResult || !callResult.success) {
            return;
          }

          try {
            const decoded = task.context.iface.decodeFunctionResult("hasRole", callResult.returnData);
            if (Boolean(decoded[0])) {
              const contract = rolesByContract.get(task.context.address.toLowerCase());
              if (contract) {
                addHeldRole(contract, task.holder, task.role);
              }
            }
          } catch {
            // ignore decode errors in fallback path
          }
        }),
      );
    }
  }

  for (const contract of roleContracts) {
    const defaultAdminHash = contract.defaultAdminRoleHash;
    if (!defaultAdminHash) {
      continue;
    }

    const governanceHasDefaultAdmin = contract.rolesHeldByGovernance.some(
      (role) => role.hash.toLowerCase() === defaultAdminHash.toLowerCase(),
    );
    contract.governanceHasDefaultAdmin = governanceHasDefaultAdmin;
  }

  const ownableContracts: OwnableContractInfo[] = [];

  if (ownableCandidates.length > 0) {
    log(`Resolving owners for ${ownableCandidates.length} Ownable contracts.`);
  }

  for (const candidate of ownableCandidates) {
    const iface = new Interface(candidate.summary.abi as any);
    const callData = iface.encodeFunctionData("owner", []);
    try {
      const returnData = await ethers.provider.call({
        to: candidate.summary.address,
        data: callData,
      });
      telemetry.directCalls.owner += 1;
      const decoded = iface.decodeFunctionResult("owner", returnData);
      const owner = String(decoded[0]);
      const ownerLower = owner.toLowerCase();
      const deployerLower = deployer.toLowerCase();
      const governanceLower = governanceMultisig.toLowerCase();
      ownableContracts.push({
        deploymentName: candidate.summary.deploymentName,
        name: candidate.summary.contractName,
        address: candidate.summary.address,
        abi: candidate.summary.abi,
        owner,
        deployerIsOwner: ownerLower === deployerLower,
        governanceIsOwner: ownerLower === governanceLower,
      });
    } catch {
      // ignore failures to read owner
    }
  }

  const completedAt = Date.now();
  telemetry.completedAt = completedAt;
  telemetry.durationMs = completedAt - startedAt;

  return {
    rolesContracts: roleContracts,
    ownableContracts,
    stats: telemetry,
  };
}
