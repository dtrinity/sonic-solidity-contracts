import { Signer } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

import { getConfig } from "../../config/config";
import { AbiItem } from "web3-utils";

async function main() {
  const hre = require("hardhat");
  const { getNamedAccounts, network, deployments, ethers } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner: Signer = await ethers.getSigner(deployer);

  console.log(
    `\nScanning roles and ownership for deployer: ${deployer} on network: ${network.name}`
  );

  const config = await getConfig(hre);
  const { governanceMultisig } = config.walletAddresses;

  console.log(`Governance Multisig: ${governanceMultisig}`);

  const deploymentsPath = path.join(
    __dirname,
    "..",
    "..",
    "deployments",
    network.name
  );
  const migrationsFilePath = path.join(deploymentsPath, ".migrations.json");

  if (!fs.existsSync(deploymentsPath)) {
    console.error(
      `\nError: deployments directory not found for network ${network.name}. Please ensure contracts are deployed on this network.`
    );
    return false;
  }

  // Read the .migrations.json file to get the names (optional, mainly for context)
  let deployedNames: string[] = [];
  if (fs.existsSync(migrationsFilePath)) {
    const migrations = JSON.parse(fs.readFileSync(migrationsFilePath, "utf-8"));
    deployedNames = Object.keys(migrations);
    console.log(
      `Found ${deployedNames.length} entries in .migrations.json (for context).`
    );
  } else {
    console.log(
      `.migrations.json not found for network ${network.name}. Proceeding by scanning deployment files.`
    );
  }

  const contractsWithPotentialRoles: {
    name: string;
    address: string;
    abi: AbiItem[];
    roles: { name: string; hash: string }[];
  }[] = [];

  const contractsWithPotentialOwnership: {
    name: string;
    address: string;
    abi: AbiItem[];
  }[] = [];

  // Read deployment artifacts directly from the directory
  const deploymentFiles = fs.readdirSync(deploymentsPath);
  const contractArtifactFiles = deploymentFiles.filter(
    (file) => file.endsWith(".json") && file !== ".migrations.json"
  );

  console.log(
    `Found ${contractArtifactFiles.length} potential contract artifact files in ${deploymentsPath}.`
  );

  for (const filename of contractArtifactFiles) {
    const deploymentName = filename.replace(".json", ""); // Use filename as a potential deployment name
    const artifactPath = path.join(deploymentsPath, filename);

    try {
      const deployment = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      const abi: AbiItem[] = deployment.abi;
      const contractAddress: string = deployment.address;
      const contractName: string = deployment.contractName || deploymentName; // Use contractName from artifact if available

      // Check if the contract uses AccessControl by looking for hasRole function
      const hasRoleFunction = abi.find(
        (item) =>
          item.type === "function" &&
          item.name === "hasRole" &&
          item.inputs?.length === 2 &&
          item.inputs[0].type === "bytes32" &&
          item.inputs[1].type === "address" &&
          item.outputs?.length === 1 &&
          item.outputs[0].type === "bool"
      );

      if (hasRoleFunction) {
        console.log(`  Contract ${contractName} has a hasRole function.`);
        console.log(
          `\nChecking roles for contract: ${contractName} at ${contractAddress}`
        );

        const roles: { name: string; hash: string }[] = [];

        // Find role constants (e.g., DEFAULT_ADMIN_ROLE, MINTER_ROLE)
        for (const item of abi) {
          // Check if it's a view function returning bytes32 with no inputs
          if (
            item.type === "function" &&
            item.stateMutability === "view" &&
            item.inputs?.length === 0 &&
            item.outputs?.length === 1 &&
            item.outputs[0].type === "bytes32"
          ) {
            // Check if the function name looks like a role constant
            if (
              item.name &&
              (item.name.endsWith("_ROLE") ||
                item.name === "DEFAULT_ADMIN_ROLE")
            ) {
              const roleName = item.name;
              try {
                const contract = await ethers.getContractAt(
                  abi,
                  contractAddress,
                  deployerSigner
                );
                // Call the function to get the role hash
                const roleHash = await contract[roleName]();
                roles.push({ name: roleName, hash: roleHash });
                console.log(
                  `  - Found role: ${roleName} with hash ${roleHash}`
                );
              } catch (error) {
                console.error(
                  `    Error getting role hash for ${roleName}:`,
                  error
                );
              }
            }
          }
        }

        if (roles.length > 0) {
          contractsWithPotentialRoles.push({
            name: contractName,
            address: contractAddress,
            abi,
            roles,
          });
        }
      } else {
        // console.log(
        //   `  Skipping ${contractName}: No hasRole function found in ABI.` // Debug log
        // );
      }

      // Check if the contract is Ownable by looking for owner() and transferOwnership(address)
      const ownerFunction = abi.find(
        (item) =>
          item.type === "function" &&
          item.name === "owner" &&
          item.inputs?.length === 0 &&
          item.outputs?.length === 1 &&
          item.outputs[0].type === "address"
      );

      const transferOwnershipFunction = abi.find(
        (item) =>
          item.type === "function" &&
          item.name === "transferOwnership" &&
          item.inputs?.length === 1 &&
          item.inputs[0].type === "address"
      );

      if (ownerFunction && transferOwnershipFunction) {
        console.log(`  Contract ${contractName} appears to be Ownable.`);
        contractsWithPotentialOwnership.push({
          name: contractName,
          address: contractAddress,
          abi,
        });
      }
    } catch (error) {
      console.error(
        `Error reading or processing artifact file ${filename}:`,
        error
      );
    }
  }

  console.log(
    `\nScan complete. Found potential roles in ${contractsWithPotentialRoles.length} contracts and potential ownership in ${contractsWithPotentialOwnership.length} contracts.`
  );

  const deployerRoles: {
    contractName: string;
    contractAddress: string;
    abi: AbiItem[];
    roles: { name: string; hash: string }[];
  }[] = [];

  const deployerOwnedContracts: {
    name: string;
    address: string;
    abi: AbiItem[];
  }[] = [];

  console.log("\nChecking deployer's roles and ownership...");

  for (const contractInfo of contractsWithPotentialRoles) {
    const {
      name: contractName,
      address: contractAddress,
      abi,
      roles,
    } = contractInfo;

    try {
      const contract = await ethers.getContractAt(
        abi,
        contractAddress,
        deployerSigner
      );

      const rolesHeldByDeployer: { name: string; hash: string }[] = [];

      for (const role of roles) {
        const hasRole = await contract.hasRole(role.hash, deployer);
        if (hasRole) {
          rolesHeldByDeployer.push(role);
          console.log(`  - Deployer HAS role ${role.name} on ${contractName}`);
        } else {
          // console.log(
          //   `  - Deployer does NOT have role ${role.name} on ${contractName}` // Debug log
          // );
        }
      }

      if (rolesHeldByDeployer.length > 0) {
        deployerRoles.push({
          contractName,
          contractAddress,
          abi,
          roles: rolesHeldByDeployer,
        });
      }
    } catch (error) {
      console.error(`Error checking roles for ${contractName}:`, error);
    }
  }

  for (const contractInfo of contractsWithPotentialOwnership) {
    const { name: contractName, address: contractAddress, abi } = contractInfo;

    try {
      console.log(
        `  Checking ownership for ${contractName} at ${contractAddress}`
      );
      const contract = await ethers.getContractAt(
        abi,
        contractAddress,
        deployerSigner
      );

      const currentOwner = await contract.owner();

      if (currentOwner.toLowerCase() === deployer.toLowerCase()) {
        deployerOwnedContracts.push(contractInfo);
        console.log(`  - Deployer IS the owner of ${contractName}`);
      } else {
        console.log(
          `  - Deployer is NOT the owner of ${contractName}. Current owner: ${currentOwner}`
        );
      }
    } catch (error) {
      console.error(`Error checking ownership for ${contractName}:`, error);
    }
  }

  console.log("\n--- Summary of Deployer's Roles and Ownership ---");
  if (deployerRoles.length === 0 && deployerOwnedContracts.length === 0) {
    console.log(
      "Deployer holds no identifiable roles or ownership on deployed contracts."
    );
  } else {
    console.log("Contracts with Roles Held by Deployer:");
    for (const contractInfo of deployerRoles) {
      console.log(
        `Contract: ${contractInfo.contractName} (${contractInfo.contractAddress})`
      );
      for (const role of contractInfo.roles) {
        console.log(`  - ${role.name} (hash: ${role.hash})`);
      }
    }
  }

  if (deployerOwnedContracts.length > 0) {
    console.log("Ownable Contracts Owned by Deployer:");
    for (const contractInfo of deployerOwnedContracts) {
      console.log(`Contract: ${contractInfo.name} (${contractInfo.address})`);
    }
  }

  if (deployerRoles.length === 0 && deployerOwnedContracts.length === 0) {
    console.log("\nNo roles or ownership to transfer. Exiting.");
    return true;
  }

  // Ask for confirmation
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question =
    "\nDo you want to transfer the listed roles and ownership to the governance multisig? (yes/no): ";

  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });

  rl.close();

  if (answer.toLowerCase() !== "yes") {
    console.log("\nRole and ownership transfer cancelled by user. Exiting.");
    return true;
  }

  console.log("\nTransferring roles and ownership...");

  // Transfer AccessControl roles
  for (const contractInfo of deployerRoles) {
    const { contractName, contractAddress, abi, roles } = contractInfo;

    try {
      const contract = await ethers.getContractAt(
        abi,
        contractAddress,
        deployerSigner
      );

      // Separate roles
      const adminRole = roles.find((r) => r.name === "DEFAULT_ADMIN_ROLE");
      const otherRoles = roles.filter((r) => r.name !== "DEFAULT_ADMIN_ROLE");

      // 1. Transfer other roles first
      console.log(
        `  - Transferring ${otherRoles.length} non-admin role(s) on ${contractName}...`
      );
      for (const role of otherRoles) {
        console.log(`    - Transferring role ${role.name}...`);
        try {
          // Grant role to multisig
          const grantTx = await contract.grantRole(
            role.hash,
            governanceMultisig
          );
          await grantTx.wait();
          console.log(
            `      Granted ${role.name} to ${governanceMultisig} (Tx: ${grantTx.hash})`
          );

          // Revoke role from deployer
          const revokeTx = await contract.revokeRole(role.hash, deployer);
          await revokeTx.wait();
          console.log(
            `      Revoked ${role.name} from ${deployer} (Tx: ${revokeTx.hash})`
          );
        } catch (error) {
          console.error(
            `      Error transferring role ${role.name} on ${contractName}:`,
            error
          );
          // Decide if you want to stop the whole process or just skip this role/contract
          console.warn(
            `      Skipping remaining role transfers for ${contractName} due to error.`
          );
          break; // Break inner loop for this contract if a non-admin role fails
        }
      }

      // 2. Transfer DEFAULT_ADMIN_ROLE last (if it exists and other roles were successful)
      if (adminRole) {
        console.log(
          `  - Transferring DEFAULT_ADMIN_ROLE on ${contractName}...`
        );
        try {
          // CRITICAL: Grant the admin role to the new admin *before* revoking it from the old one.
          // Grant role to multisig
          const grantTx = await contract.grantRole(
            adminRole.hash,
            governanceMultisig
          );
          await grantTx.wait();
          console.log(
            `    Granted ${adminRole.name} to ${governanceMultisig} (Tx: ${grantTx.hash})`
          );

          // Safety check: Verify the multisig now has the admin role before revoking.
          const hasRoleCheck = await contract.hasRole(
            adminRole.hash,
            governanceMultisig
          );
          if (!hasRoleCheck) {
            throw new Error(
              `Verification failed: Governance multisig ${governanceMultisig} does NOT have role ${adminRole.name} on ${contractName} after grant attempt.`
            );
          }
          console.log(
            `      Verification successful: Multisig now has role ${adminRole.name}.`
          );

          // Revoke role from deployer
          const revokeTx = await contract.revokeRole(adminRole.hash, deployer);
          await revokeTx.wait();
          console.log(
            `    Revoked ${adminRole.name} from ${deployer} (Tx: ${revokeTx.hash})`
          );
        } catch (error) {
          console.error(
            `    Error transferring ${adminRole.name} on ${contractName}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error(
        `Error interacting with contract ${contractName} for role transfer:`,
        error
      );
    }
  }

  // Transfer Ownable ownership
  for (const contractInfo of deployerOwnedContracts) {
    const { name: contractName, address: contractAddress, abi } = contractInfo;

    try {
      console.log(`  - Transferring ownership of ${contractName}...`);
      const contract = await ethers.getContractAt(
        abi,
        contractAddress,
        deployerSigner
      );
      try {
        const transferTx = await contract.transferOwnership(governanceMultisig);
        await transferTx.wait();
        console.log(
          `    Transferred ownership of ${contractName} to ${governanceMultisig} (Tx: ${transferTx.hash})`
        );
      } catch (error) {
        console.error(
          `    Error transferring ownership of ${contractName}:`,
          error
        );
      }
    } catch (error) {
      console.error(
        `Error interacting with contract ${contractName} for ownership transfer:`,
        error
      );
    }
  }

  console.log("\nRole and ownership transfer process completed.");

  return true;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
