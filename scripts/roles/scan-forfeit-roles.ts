import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
// import { DeployFunction } from "hardhat-deploy/types";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

import { getConfig } from "../../config/config";
import { AbiItem } from "web3-utils";

// const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
async function main() {
  const hre = require("hardhat");
  const { getNamedAccounts, network, deployments, ethers } = hre;
  const { deployer } = await getNamedAccounts();
  const deployerSigner: Signer = await ethers.getSigner(deployer);

  console.log(
    `\nScanning roles for deployer: ${deployer} on network: ${network.name}`
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

    // console.log(`Processing artifact file: ${filename}`); // Removed debug log

    try {
      const deployment = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      const abi: AbiItem[] = deployment.abi;
      const contractAddress: string = deployment.address;
      const contractName: string = deployment.contractName || deploymentName; // Use contractName from artifact if available

      // console.log(
      //   `  Successfully read artifact for ${filename}. Contract name: ${contractName}, Address: ${contractAddress}` // Removed debug log
      // );

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
        //   `  Skipping ${contractName}: No hasRole function found in ABI.` // Removed debug log
        // );
      }
    } catch (error) {
      console.error(
        `Error reading or processing artifact file ${filename}:`,
        error
      );
    }
  }

  console.log(
    `\nScan complete. Found potential roles in ${contractsWithPotentialRoles.length} contracts.`
  );

  const deployerRoles: {
    contractName: string;
    contractAddress: string;
    abi: AbiItem[];
    roles: { name: string; hash: string }[];
  }[] = [];

  console.log("\nChecking deployer's roles...");

  for (const contractInfo of contractsWithPotentialRoles) {
    const {
      name: contractName,
      address: contractAddress,
      abi,
      roles,
    } = contractInfo;

    try {
      // console.log(
      //   `  Getting contract instance for ${contractName} at ${contractAddress} with deployer signer ${await deployerSigner.getAddress()}` // Removed debug log
      // );
      const contract = await ethers.getContractAt(
        abi,
        contractAddress,
        deployerSigner
      );

      const rolesHeldByDeployer: { name: string; hash: string }[] = [];

      for (const role of roles) {
        // console.log(
        //   `    Checking if deployer ${deployer} has role ${role.name} with hash ${role.hash}...` // Removed debug log
        // );
        const hasRole = await contract.hasRole(role.hash, deployer);
        // console.log(`    Result: ${hasRole}`); // Removed debug log
        if (hasRole) {
          rolesHeldByDeployer.push(role);
          console.log(`  - Deployer HAS role ${role.name} on ${contractName}`);
        } else {
          // console.log(
          //   `  - Deployer does NOT have role ${role.name} on ${contractName}` // Removed debug log
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

  console.log("\n--- Summary of Deployer's Roles ---");
  if (deployerRoles.length === 0) {
    console.log("Deployer holds no identifiable roles on deployed contracts.");
  } else {
    for (const contractInfo of deployerRoles) {
      console.log(
        `Contract: ${contractInfo.contractName} (${contractInfo.contractAddress})`
      );
      for (const role of contractInfo.roles) {
        console.log(`  - ${role.name} (hash: ${role.hash})`);
      }
    }
  }

  if (deployerRoles.length === 0) {
    console.log("\nNo roles to transfer. Exiting.");
    return true;
  }

  // Ask for confirmation
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question =
    "\nDo you want to transfer the listed roles to the governance multisig? (yes/no): ";

  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });

  rl.close();

  if (answer.toLowerCase() !== "yes") {
    console.log("\nRole transfer cancelled by user. Exiting.");
    return true;
  }

  console.log("\nTransferring roles...");

  for (const contractInfo of deployerRoles) {
    const { contractName, contractAddress, abi, roles } = contractInfo;

    try {
      const contract = await ethers.getContractAt(
        abi,
        contractAddress,
        deployerSigner
      );

      for (const role of roles) {
        console.log(`  - Transferring role ${role.name} on ${contractName}...`);
        try {
          // Grant role to multisig
          const grantTx = await contract.grantRole(
            role.hash,
            governanceMultisig
          );
          await grantTx.wait();
          console.log(
            `    Granted ${role.name} to ${governanceMultisig} (Tx: ${grantTx.hash})`
          );

          // Revoke role from deployer
          const revokeTx = await contract.revokeRole(role.hash, deployer);
          await revokeTx.wait();
          console.log(
            `    Revoked ${role.name} from ${deployer} (Tx: ${revokeTx.hash})`
          );
        } catch (error) {
          console.error(
            `    Error transferring role ${role.name} on ${contractName}:`,
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

  console.log("\nRole transfer process completed.");

  return true;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
