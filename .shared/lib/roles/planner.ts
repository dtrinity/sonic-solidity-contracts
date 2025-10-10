import { OwnableContractInfo, RolesContractInfo } from "./scan";
import {
  ResolvedContractOverride,
  ResolvedDefaultAdminAction,
  ResolvedOwnableAction,
  ResolvedRoleManifest,
} from "./manifest";

export type ActionSource = "auto" | "override";

export interface PreparedContractPlan {
  readonly deployment: string;
  readonly alias?: string;
  readonly notes?: string;
  readonly ownable?: ResolvedOwnableAction;
  readonly ownableSource?: ActionSource;
  readonly defaultAdmin?: ResolvedDefaultAdminAction;
  readonly defaultAdminSource?: ActionSource;
}

interface SelectionResult<TAction> {
  readonly action?: TAction;
  readonly source?: ActionSource;
  readonly excluded: boolean;
}

interface PrepareContractPlansOptions {
  readonly manifest: ResolvedRoleManifest;
  readonly rolesByDeployment: Map<string, RolesContractInfo>;
  readonly ownableByDeployment: Map<string, OwnableContractInfo>;
}

interface OwnableSelectionOptions {
  readonly manifest: ResolvedRoleManifest;
  readonly override?: ResolvedContractOverride;
  readonly deployment: string;
  readonly hasOwnable: boolean;
}

interface DefaultAdminSelectionOptions {
  readonly manifest: ResolvedRoleManifest;
  readonly override?: ResolvedContractOverride;
  readonly deployment: string;
  readonly hasRoles: boolean;
}

export function prepareContractPlans(options: PrepareContractPlansOptions): PreparedContractPlan[] {
  const { manifest, rolesByDeployment, ownableByDeployment } = options;
  const overrides: ResolvedContractOverride[] = Array.from(manifest.overrides ?? []);
  const overridesByDeployment: Map<string, ResolvedContractOverride> = new Map(overrides.map((o) => [o.deployment, o]));

  const orderedOverrides = overrides.map((o) => o.deployment);

  const autoCandidatesSet = new Set<string>();
  for (const deploymentName of ownableByDeployment.keys()) {
    autoCandidatesSet.add(deploymentName);
  }
  for (const deploymentName of rolesByDeployment.keys()) {
    autoCandidatesSet.add(deploymentName);
  }

  const autoCandidates = Array.from(autoCandidatesSet).filter((deployment) => !overridesByDeployment.has(deployment));
  autoCandidates.sort();

  const orderedDeployments = [...orderedOverrides, ...autoCandidates];
  const plans: PreparedContractPlan[] = [];

  for (const deployment of orderedDeployments) {
    const override: ResolvedContractOverride | undefined = overridesByDeployment.get(deployment);
    const rolesInfo = rolesByDeployment.get(deployment);
    const ownableInfo = ownableByDeployment.get(deployment);

    const ownableSelection = computeOwnableSelection({
      manifest,
      override,
      deployment,
      hasOwnable: Boolean(ownableInfo),
    });

    const defaultAdminSelection = computeDefaultAdminSelection({
      manifest,
      override,
      deployment,
      hasRoles: Boolean(rolesInfo?.defaultAdminRoleHash),
    });

    const hasAction = Boolean(ownableSelection.action || defaultAdminSelection.action);
    let hasOverride = false;
    let hasPresentation = false;
    if (override) {
      hasOverride = true;
      hasPresentation = Boolean(override.alias || override.notes);
    }

    if (!hasAction && !hasPresentation && !hasOverride) {
      continue;
    }

    plans.push({
      deployment,
      alias: override?.alias,
      notes: override?.notes,
      ownable: ownableSelection.action,
      ownableSource: ownableSelection.source,
      defaultAdmin: defaultAdminSelection.action,
      defaultAdminSource: defaultAdminSelection.source,
    });
  }

  return plans;
}

function computeOwnableSelection(options: OwnableSelectionOptions): SelectionResult<ResolvedOwnableAction> {
  const { manifest, override, deployment, hasOwnable } = options;
  const excluded = isDeploymentExcluded(manifest, deployment, "ownable");
  const overrideConfig = override?.ownable;

  if (overrideConfig && overrideConfig.enabled === false) {
    return { excluded };
  }

  if (overrideConfig && overrideConfig.action) {
    if (excluded && overrideConfig.enabled !== true) {
      return { excluded: true };
    }

    return {
      action: cloneOwnableAction(overrideConfig.action),
      source: "override",
      excluded: false,
    };
  }

  if (excluded) {
    return { excluded: true };
  }

  if (manifest.autoInclude.ownable && hasOwnable) {
    return {
      action: cloneOwnableAction(manifest.defaults.ownable),
      source: "auto",
      excluded: false,
    };
  }

  return { excluded: false };
}

function computeDefaultAdminSelection(options: DefaultAdminSelectionOptions): SelectionResult<ResolvedDefaultAdminAction> {
  const { manifest, override, deployment, hasRoles } = options;
  const excluded = isDeploymentExcluded(manifest, deployment, "defaultAdmin");
  const overrideConfig = override?.defaultAdmin;

  if (overrideConfig && overrideConfig.enabled === false) {
    return { excluded };
  }

  if (overrideConfig && overrideConfig.action) {
    if (excluded && overrideConfig.enabled !== true) {
      return { excluded: true };
    }

    return {
      action: cloneDefaultAdminAction(overrideConfig.action),
      source: "override",
      excluded: false,
    };
  }

  if (excluded) {
    return { excluded: true };
  }

  if (manifest.autoInclude.defaultAdmin && hasRoles) {
    return {
      action: cloneDefaultAdminAction(manifest.defaults.defaultAdmin),
      source: "auto",
      excluded: false,
    };
  }

  return { excluded: false };
}

export function isDeploymentExcluded(
  manifest: ResolvedRoleManifest,
  deployment: string,
  kind: "ownable" | "defaultAdmin",
): boolean {
  return manifest.exclusions.some((exclusion) => {
    const appliesToKind = exclusion[kind];
    if (!appliesToKind) {
      return false;
    }

    if (exclusion.deployment && exclusion.deployment === deployment) {
      return true;
    }

    if (exclusion.deploymentPrefix && deployment.startsWith(exclusion.deploymentPrefix)) {
      return true;
    }

    return false;
  });
}

export function cloneOwnableAction(action: ResolvedOwnableAction): ResolvedOwnableAction {
  return {
    newOwner: action.newOwner,
    execution: action.execution,
  };
}

export function cloneDefaultAdminAction(action: ResolvedDefaultAdminAction): ResolvedDefaultAdminAction {
  return {
    newAdmin: action.newAdmin,
    grantExecution: action.grantExecution,
    removal: action.removal
      ? {
          address: action.removal.address,
          strategy: action.removal.strategy,
          execution: action.removal.execution,
        }
      : undefined,
  };
}
