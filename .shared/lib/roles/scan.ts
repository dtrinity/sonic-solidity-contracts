import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AbiItem } from "web3-utils";
import * as fs from "fs";
import * as path from "path";

// Type guards for ABI fragments
function isAbiFunctionFragment(
  item: AbiItem,
): item is AbiItem & { type: "function"; name: string; stateMutability?: string; inputs?: any[]; outputs?: any[] } {
  return item.type === "function";
}

export interface RoleInfo {
  name: string;
  hash: string;
}

export interface RolesContractInfo {
  deploymentName: string;
  name: string;
  address: string;
  abi: AbiItem[];
  roles: RoleInfo[];
  rolesHeldByDeployer: RoleInfo[];
  rolesHeldByGovernance: RoleInfo[];
  defaultAdminRoleHash?: string;
  governanceHasDefaultAdmin: boolean;
}

export interface OwnableContractInfo {
  deploymentName: string;
  name: string;
  address: string;
  abi: AbiItem[];
  owner: string;
  deployerIsOwner: boolean;
  governanceIsOwner: boolean;
}

export interface ScanResult {
  rolesContracts: RolesContractInfo[];
  ownableContracts: OwnableContractInfo[];
}

export interface ScanOptions {
  hre: HardhatRuntimeEnvironment;
  deployer: string;
  governanceMultisig: string;
  deploymentsPath?: string;
  logger?: (message: string) => void;
}

export async function scanRolesAndOwnership(options: ScanOptions): Promise<ScanResult> {
  const { hre, deployer, governanceMultisig, logger } = options;
  const ethers = (hre as any).ethers;
  const network = (hre as any).network;
  const log = logger || (() => {});

  const deploymentsPath = options.deploymentsPath || path.join((hre as any).config.paths.deployments, network.name);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Deployments directory not found for network ${network.name}: ${deploymentsPath}`);
  }

  const deploymentFiles = fs
    .readdirSync(deploymentsPath)
    .filter((f) => f.endsWith(".json") && f !== ".migrations.json" && f !== "solcInputs");

  const rolesContracts: RolesContractInfo[] = [];
  const ownableContracts: OwnableContractInfo[] = [];

  for (const filename of deploymentFiles) {
    try {
      const artifactPath = path.join(deploymentsPath, filename);
      const deployment = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      const abi: AbiItem[] = deployment.abi;
      const contractAddress: string = deployment.address;
      const deploymentName: string = filename.replace(".json", "");
      const contractName: string = deployment.contractName || deploymentName;

      // Detect AccessControl
      const hasRoleFn = abi.find(
        (item) =>
          isAbiFunctionFragment(item) &&
          item.name === "hasRole" &&
          item.inputs?.length === 2 &&
          item.inputs[0].type === "bytes32" &&
          item.inputs[1].type === "address" &&
          item.outputs?.length === 1 &&
          item.outputs[0].type === "bool",
      );

      if (hasRoleFn) {
        log(`  Contract ${contractName} has a hasRole function.`);
        log(`\nChecking roles for contract: ${contractName} at ${contractAddress}`);
        const roles: RoleInfo[] = [];

        // Collect role constants as view functions returning bytes32
        for (const item of abi) {
          if (
            isAbiFunctionFragment(item) &&
            item.stateMutability === "view" &&
            ((item.name?.endsWith("_ROLE") as boolean) || item.name === "DEFAULT_ADMIN_ROLE") &&
            (item.inputs?.length ?? 0) === 0 &&
            item.outputs?.length === 1 &&
            item.outputs[0].type === "bytes32"
          ) {
            try {
              const contract = await ethers.getContractAt(abi as any, contractAddress);
              const roleHash: string = await (contract as any)[item.name]();
              roles.push({ name: item.name!, hash: roleHash });
              log(`  - Found role: ${item.name} with hash ${roleHash}`);
            } catch {
              // ignore role hash failures for this item
            }
          }
        }

        // Build role ownership information
        const contract = await ethers.getContractAt(abi as any, contractAddress);
        const rolesHeldByDeployer: RoleInfo[] = [];
        const rolesHeldByGovernance: RoleInfo[] = [];

        for (const role of roles) {
          try {
            if (await (contract as any).hasRole(role.hash, deployer)) {
              rolesHeldByDeployer.push(role);
              log(`    Deployer HAS role ${role.name}`);
            }
          } catch {}

          try {
            if (await (contract as any).hasRole(role.hash, governanceMultisig)) {
              rolesHeldByGovernance.push(role);
              log(`    Governance HAS role ${role.name}`);
            }
          } catch {}
        }

        const defaultAdmin = roles.find((r) => r.name === "DEFAULT_ADMIN_ROLE");
        let governanceHasDefaultAdmin = false;
        if (defaultAdmin) {
          try {
            governanceHasDefaultAdmin = await (contract as any).hasRole(defaultAdmin.hash, governanceMultisig);
            log(`    governanceHasDefaultAdmin: ${governanceHasDefaultAdmin}`);
          } catch {}
        }

        rolesContracts.push({
          deploymentName,
          name: contractName,
          address: contractAddress,
          abi,
          roles,
          rolesHeldByDeployer,
          rolesHeldByGovernance,
          defaultAdminRoleHash: defaultAdmin?.hash,
          governanceHasDefaultAdmin,
        });
      }

      // Detect Ownable (owner() view returns address)
      const ownerFn = abi.find(
        (item) =>
          isAbiFunctionFragment(item) &&
          item.name === "owner" &&
          (item.inputs?.length ?? 0) === 0 &&
          item.outputs?.length === 1 &&
          item.outputs[0].type === "address",
      );

      if (ownerFn) {
        try {
          const contract = await ethers.getContractAt(abi as any, contractAddress);
          const owner: string = await (contract as any).owner();
          const ownerLower = owner.toLowerCase();
          const deployerLower = deployer?.toLowerCase?.();
          const governanceLower = governanceMultisig?.toLowerCase?.();
          log(`  Contract ${contractName} appears to be Ownable. owner=${owner}`);
          ownableContracts.push({
            deploymentName,
            name: contractName,
            address: contractAddress,
            abi,
            owner,
            deployerIsOwner: deployerLower ? ownerLower === deployerLower : false,
            governanceIsOwner: governanceLower ? ownerLower === governanceLower : false,
          });
        } catch (error) {
          log(`    Failed to resolve owner for ${contractName}: ${error}`);
        }
      }
    } catch {
      // ignore malformed artifact
    }
  }

  return { rolesContracts, ownableContracts };
}
