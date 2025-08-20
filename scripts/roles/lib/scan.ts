import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AbiItem } from "web3-utils";
import * as fs from "fs";
import * as path from "path";

export interface RoleInfo {
  name: string;
  hash: string;
}

export interface RolesContractInfo {
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
  name: string;
  address: string;
  abi: AbiItem[];
  owner: string;
  deployerIsOwner: boolean;
}

export interface ScanResult {
  rolesContracts: RolesContractInfo[];
  ownableContracts: OwnableContractInfo[];
}

/**
 * Scan deployment artifacts for AccessControl roles and Ownable ownership.
 * Returns a structured result that can be used by revoke/transfer scripts.
 */
export async function scanRolesAndOwnership(
  hre: HardhatRuntimeEnvironment,
  deployer: string,
  governanceMultisig: string,
  logger?: (message: string) => void
): Promise<ScanResult> {
  const { ethers, network } = hre;
  const log = logger || (() => {});

  const deploymentsPath = path.join(hre.config.paths.deployments, network.name);

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `Deployments directory not found for network ${network.name}: ${deploymentsPath}`
    );
  }

  const deploymentFiles = fs
    .readdirSync(deploymentsPath)
    .filter(
      (f) =>
        f.endsWith(".json") && f !== ".migrations.json" && f !== "solcInputs"
    );

  const rolesContracts: RolesContractInfo[] = [];
  const ownableContracts: OwnableContractInfo[] = [];

  for (const filename of deploymentFiles) {
    try {
      const artifactPath = path.join(deploymentsPath, filename);
      const deployment = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      const abi: AbiItem[] = deployment.abi;
      const contractAddress: string = deployment.address;
      const contractName: string =
        deployment.contractName || filename.replace(".json", "");

      // Detect AccessControl (hasRole(bytes32,address) view returns bool)
      const hasRoleFn = abi.find(
        (item) =>
          item.type === "function" &&
          item.name === "hasRole" &&
          item.inputs?.length === 2 &&
          item.inputs[0].type === "bytes32" &&
          item.inputs[1].type === "address" &&
          item.outputs?.length === 1 &&
          item.outputs[0].type === "bool"
      );

      if (hasRoleFn) {
        log(`  Contract ${contractName} has a hasRole function.`);
        log(
          `\nChecking roles for contract: ${contractName} at ${contractAddress}`
        );
        const roles: RoleInfo[] = [];

        // Collect role constants as view functions returning bytes32
        for (const item of abi) {
          if (
            item.type === "function" &&
            item.stateMutability === "view" &&
            (item.name?.endsWith("_ROLE") ||
              item.name === "DEFAULT_ADMIN_ROLE") &&
            (item.inputs?.length ?? 0) === 0 &&
            item.outputs?.length === 1 &&
            item.outputs[0].type === "bytes32"
          ) {
            try {
              const contract = await ethers.getContractAt(abi, contractAddress);
              const roleHash: string = await contract[item.name]();
              roles.push({ name: item.name, hash: roleHash });
              log(`  - Found role: ${item.name} with hash ${roleHash}`);
            } catch {
              // ignore role hash failures for this item
            }
          }
        }

        // Build role ownership information
        const contract = await ethers.getContractAt(abi, contractAddress);
        const rolesHeldByDeployer: RoleInfo[] = [];
        const rolesHeldByGovernance: RoleInfo[] = [];

        for (const role of roles) {
          try {
            if (await contract.hasRole(role.hash, deployer)) {
              rolesHeldByDeployer.push(role);
              log(`    Deployer HAS role ${role.name}`);
            }
          } catch {}

          try {
            if (await contract.hasRole(role.hash, governanceMultisig)) {
              rolesHeldByGovernance.push(role);
              log(`    Governance HAS role ${role.name}`);
            }
          } catch {}
        }

        const defaultAdmin = roles.find((r) => r.name === "DEFAULT_ADMIN_ROLE");
        let governanceHasDefaultAdmin = false;
        if (defaultAdmin) {
          try {
            governanceHasDefaultAdmin = await contract.hasRole(
              defaultAdmin.hash,
              governanceMultisig
            );
            log(`    governanceHasDefaultAdmin: ${governanceHasDefaultAdmin}`);
          } catch {}
        }

        rolesContracts.push({
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
          item.type === "function" &&
          item.name === "owner" &&
          (item.inputs?.length ?? 0) === 0 &&
          item.outputs?.length === 1 &&
          item.outputs[0].type === "address"
      );

      if (ownerFn) {
        try {
          const contract = await ethers.getContractAt(abi, contractAddress);
          const owner: string = await contract.owner();
          log(
            `  Contract ${contractName} appears to be Ownable. owner=${owner}`
          );
          ownableContracts.push({
            name: contractName,
            address: contractAddress,
            abi,
            owner,
            deployerIsOwner: owner.toLowerCase() === deployer.toLowerCase(),
          });
        } catch {
          // ignore owner resolution failures
        }
      }
    } catch {
      // ignore malformed artifact
    }
  }

  return { rolesContracts, ownableContracts };
}
