import * as fs from "fs";
import * as path from "path";

import { getAddress } from "@ethersproject/address";

import { SafeConfig } from "./types";

export type ExecutionMode = "direct" | "safe";

export interface ManifestOwnableDefaults {
  readonly newOwner?: string;
  readonly execution?: ExecutionMode;
}

export interface ManifestDefaultAdminDefaults {
  readonly newAdmin?: string;
  readonly grantExecution?: ExecutionMode;
}

export interface ManifestDefaults {
  readonly ownable?: ManifestOwnableDefaults;
  readonly defaultAdmin?: ManifestDefaultAdminDefaults;
}

export interface ManifestOwnableOverrides extends ManifestOwnableDefaults {
  readonly enabled?: boolean;
}

export interface ManifestDefaultAdminOverrides extends ManifestDefaultAdminDefaults {
  readonly enabled?: boolean;
}

export interface ManifestContractOverride {
  readonly deployment: string;
  readonly alias?: string;
  readonly notes?: string;
  readonly ownable?: ManifestOwnableOverrides;
  readonly defaultAdmin?: ManifestDefaultAdminOverrides;
  readonly disabled?: boolean;
}

export interface ManifestOutputConfig {
  readonly json?: string;
}

export interface ManifestSafeConfig extends SafeConfig {
  readonly description?: string;
}

export interface ManifestAutoIncludeConfig {
  readonly ownable?: boolean;
  readonly defaultAdmin?: boolean;
}

export interface ManifestExclusionConfig {
  readonly deployment?: string;
  readonly deploymentPrefix?: string;
  readonly notes?: string;
  readonly reason?: string;
  readonly ownable?: boolean;
  readonly defaultAdmin?: boolean;
}

export interface RoleManifest {
  readonly version: 2;
  readonly network?: string;
  readonly deployer: string;
  readonly governance: string;
  readonly defaults?: ManifestDefaults;
  readonly autoInclude?: ManifestAutoIncludeConfig;
  readonly exclusions?: ManifestExclusionConfig[];
  readonly overrides?: ManifestContractOverride[];
  readonly safe?: ManifestSafeConfig;
  readonly output?: ManifestOutputConfig;
}

export interface ResolvedOwnableAction {
  readonly newOwner: string;
  readonly execution: ExecutionMode;
}

export interface ResolvedDefaultAdminAction {
  readonly newAdmin: string;
  readonly grantExecution: ExecutionMode;
}

export interface ResolvedOwnableOverride {
  readonly enabled?: boolean;
  readonly action?: ResolvedOwnableAction;
}

export interface ResolvedDefaultAdminOverride {
  readonly enabled?: boolean;
  readonly action?: ResolvedDefaultAdminAction;
}

export interface ResolvedContractOverride {
  readonly deployment: string;
  readonly alias?: string;
  readonly notes?: string;
  readonly ownable?: ResolvedOwnableOverride;
  readonly defaultAdmin?: ResolvedDefaultAdminOverride;
  readonly disabled?: boolean;
}

export interface ResolvedManifestDefaults {
  readonly ownable: ResolvedOwnableAction;
  readonly defaultAdmin: ResolvedDefaultAdminAction;
}

export interface ResolvedAutoIncludeConfig {
  readonly ownable: boolean;
  readonly defaultAdmin: boolean;
}

export interface ResolvedExclusion {
  readonly deployment?: string;
  readonly deploymentPrefix?: string;
  readonly notes?: string;
  readonly reason?: string;
  readonly ownable: boolean;
  readonly defaultAdmin: boolean;
}

export interface ResolvedRoleManifest {
  readonly version: 2;
  readonly network?: string;
  readonly deployer: string;
  readonly governance: string;
  readonly defaults: ResolvedManifestDefaults;
  readonly autoInclude: ResolvedAutoIncludeConfig;
  readonly exclusions: ResolvedExclusion[];
  readonly overrides: ResolvedContractOverride[];
  readonly safe?: ManifestSafeConfig;
  readonly output?: ManifestOutputConfig;
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

interface AddressContext {
  readonly deployer: string;
  readonly governance: string;
}

function resolveAddress(value: string | undefined, context: AddressContext, field: string): string {
  if (!value) {
    throw new ManifestValidationError(`${field} is required`);
  }

  const trimmed = value.trim();

  if (trimmed === "{{deployer}}") {
    return context.deployer;
  }

  if (trimmed === "{{governance}}") {
    return context.governance;
  }

  try {
    return getAddress(trimmed);
  } catch (error) {
    throw new ManifestValidationError(`${field} is not a valid address: ${trimmed}`);
  }
}

function normalizeExecution(mode: ExecutionMode | undefined, fallback: ExecutionMode): ExecutionMode {
  if (!mode) {
    return fallback;
  }

  if (mode !== "direct" && mode !== "safe") {
    throw new ManifestValidationError(`Unsupported execution mode: ${mode}`);
  }

  return mode;
}

export function loadRoleManifest(manifestPath: string): RoleManifest {
  const absolutePath = path.isAbsolute(manifestPath) ? manifestPath : path.join(process.cwd(), manifestPath);

  if (!fs.existsSync(absolutePath)) {
    throw new ManifestValidationError(`Manifest not found at ${absolutePath}`);
  }

  const contents = fs.readFileSync(absolutePath, "utf8");

  try {
    const parsed = JSON.parse(contents);
    return parsed as RoleManifest;
  } catch (error) {
    throw new ManifestValidationError(`Failed to parse manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function resolveRoleManifest(manifest: RoleManifest): ResolvedRoleManifest {
  if (manifest.version !== 2) {
    throw new ManifestValidationError(`Unsupported manifest version: ${manifest.version}`);
  }

  const deployer = getAddress(manifest.deployer);
  const governance = getAddress(manifest.governance);
  const context: AddressContext = { deployer, governance };

  const autoInclude: ResolvedAutoIncludeConfig = {
    ownable: manifest.autoInclude?.ownable ?? true,
    defaultAdmin: manifest.autoInclude?.defaultAdmin ?? true,
  };

  const defaults = resolveManifestDefaults(manifest.defaults, context);

  const exclusions = (manifest.exclusions ?? []).map((exclusion, index) => {
    if (!exclusion.deployment && !exclusion.deploymentPrefix) {
      throw new ManifestValidationError(
        `exclusions[${index}] must specify either a deployment or deploymentPrefix`,
      );
    }

    return {
      deployment: exclusion.deployment?.trim(),
      deploymentPrefix: exclusion.deploymentPrefix?.trim(),
      notes: exclusion.notes?.trim(),
      reason: exclusion.reason?.trim(),
      ownable: exclusion.ownable ?? true,
      defaultAdmin: exclusion.defaultAdmin ?? true,
    } satisfies ResolvedExclusion;
  });

  const overrides: ResolvedContractOverride[] = [];
  const seenDeployments = new Set<string>();

  for (let index = 0; index < (manifest.overrides?.length ?? 0); index += 1) {
    const contract = manifest.overrides![index];
    if (!contract || contract.disabled) {
      continue;
    }

    if (!contract.deployment || contract.deployment.trim().length === 0) {
      throw new ManifestValidationError(`overrides[${index}].deployment is required.`);
    }

    const deployment = contract.deployment.trim();
    if (seenDeployments.has(deployment)) {
      throw new ManifestValidationError(
        `Duplicate override detected for deployment ${deployment}. Each deployment can only appear once.`,
      );
    }
    seenDeployments.add(deployment);

    const ownableOverride = contract.ownable
      ? resolveOwnableOverride(contract.ownable, defaults.ownable, context, `overrides[${index}]`)
      : undefined;

    const defaultAdminOverride = contract.defaultAdmin
      ? resolveDefaultAdminOverride(contract.defaultAdmin, defaults.defaultAdmin, context, `overrides[${index}]`)
      : undefined;

    const resolvedOverride: ResolvedContractOverride = {
      deployment,
      ...(contract.alias && contract.alias.trim().length > 0 ? { alias: contract.alias.trim() } : {}),
      ...(contract.notes ? { notes: contract.notes } : {}),
      ...(ownableOverride ? { ownable: ownableOverride } : {}),
      ...(defaultAdminOverride ? { defaultAdmin: defaultAdminOverride } : {}),
    };

    overrides.push(resolvedOverride);
  }

  let safeConfig: ManifestSafeConfig | undefined;

  if (manifest.safe) {
    const owners = manifest.safe.owners && manifest.safe.owners.length > 0 ? manifest.safe.owners : [manifest.governance];
    safeConfig = {
      ...manifest.safe,
      safeAddress: resolveAddress(manifest.safe.safeAddress, context, "manifest.safe.safeAddress"),
      owners: owners.map((owner, index) => resolveAddress(owner, context, `manifest.safe.owners[${index}]`)),
      threshold: manifest.safe.threshold,
      chainId: manifest.safe.chainId,
      description: manifest.safe.description,
    };
  }

  return {
    version: 2,
    network: manifest.network,
    deployer,
    governance,
    defaults,
    autoInclude,
    exclusions,
    overrides,
    safe: safeConfig,
    output: manifest.output,
  };
}

function resolveManifestDefaults(defaults: ManifestDefaults | undefined, context: AddressContext): ResolvedManifestDefaults {
  const ownableDefaults = defaults?.ownable;
  const ownableExecution = normalizeExecution(ownableDefaults?.execution, "direct");
  if (ownableExecution !== "direct") {
    throw new ManifestValidationError(
      `defaults.ownable.execution must be 'direct'. Safe execution is not supported for Ownable transfers.`,
    );
  }

  const resolvedOwnable: ResolvedOwnableAction = {
    newOwner: resolveAddress(
      ownableDefaults?.newOwner ?? context.governance,
      context,
      "defaults.ownable.newOwner",
    ),
    execution: ownableExecution,
  };

  const defaultAdminDefaults = defaults?.defaultAdmin;
  if (defaultAdminDefaults && Object.prototype.hasOwnProperty.call(defaultAdminDefaults as Record<string, unknown>, "remove")) {
    throw new ManifestValidationError(
      "defaults.defaultAdmin.remove is no longer supported. Use the revoke script generated Safe batch to drop deployer roles.",
    );
  }
  const grantExecution = normalizeExecution(defaultAdminDefaults?.grantExecution, "direct");
  if (grantExecution === "safe") {
    throw new ManifestValidationError(
      `defaults.defaultAdmin.grantExecution cannot be 'safe'. Granting requires the current admin signer.`,
    );
  }

  const resolvedDefaultAdmin: ResolvedDefaultAdminAction = {
    newAdmin: resolveAddress(
      defaultAdminDefaults?.newAdmin ?? context.governance,
      context,
      "defaults.defaultAdmin.newAdmin",
    ),
    grantExecution,
  };

  return {
    ownable: resolvedOwnable,
    defaultAdmin: resolvedDefaultAdmin,
  };
}

function resolveOwnableOverride(
  override: ManifestOwnableOverrides,
  defaults: ResolvedOwnableAction,
  context: AddressContext,
  label: string,
): ResolvedOwnableOverride {
  const enabled = override.enabled;

  if (enabled === false) {
    return { enabled };
  }

  if (Object.prototype.hasOwnProperty.call(override as Record<string, unknown>, "remove")) {
    throw new ManifestValidationError(
      `${label}.defaultAdmin.remove is no longer supported. Use the revoke script generated Safe batch to drop deployer roles.`,
    );
  }

  const execution = normalizeExecution(override.execution, defaults.execution);
  if (execution !== "direct") {
    throw new ManifestValidationError(
      `${label}.ownable.execution must be 'direct'. Safe execution is not supported for Ownable transfers.`,
    );
  }

  const newOwner = resolveAddress(
    override.newOwner ?? defaults.newOwner,
    context,
    `${label}.ownable.newOwner`,
  );

  return {
    enabled,
    action: {
      newOwner,
      execution,
    },
  };
}

function resolveDefaultAdminOverride(
  override: ManifestDefaultAdminOverrides,
  defaults: ResolvedDefaultAdminAction,
  context: AddressContext,
  label: string,
): ResolvedDefaultAdminOverride {
  const enabled = override.enabled;

  if (enabled === false) {
    return { enabled };
  }

  const grantExecution = normalizeExecution(override.grantExecution, defaults.grantExecution);
  if (grantExecution === "safe") {
    throw new ManifestValidationError(
      `${label}.defaultAdmin.grantExecution cannot be 'safe'. Granting requires the current admin signer.`,
    );
  }

  const newAdmin = resolveAddress(
    override.newAdmin ?? defaults.newAdmin,
    context,
    `${label}.defaultAdmin.newAdmin`,
  );

  return {
    enabled,
    action: {
      newAdmin,
      grantExecution,
    },
  };
}
