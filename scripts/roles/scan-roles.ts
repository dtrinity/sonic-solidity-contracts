import { getConfig } from "../../config/config";
import { scanRolesAndOwnership } from "./lib/scan";

async function main() {
  const hre = require("hardhat");
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();
  const config = await getConfig(hre);
  const governance = config.walletAddresses.governanceMultisig;

  console.log(`Scanning roles/ownership on ${hre.network.name}`);

  const result = await scanRolesAndOwnership(hre, deployer, governance, (m: string) => console.log(m));

  console.log(`\nRoles contracts: ${result.rolesContracts.length}`);
  for (const c of result.rolesContracts) {
    console.log(`- ${c.name} (${c.address})`);
    if (c.rolesHeldByDeployer.length > 0) {
      console.log(`  deployer roles: ${c.rolesHeldByDeployer.map((r) => r.name).join(", ")}`);
    }
    if (c.rolesHeldByGovernance.length > 0) {
      console.log(`  governance roles: ${c.rolesHeldByGovernance.map((r) => r.name).join(", ")}`);
    }
    console.log(`  governanceHasDefaultAdmin: ${c.governanceHasDefaultAdmin}`);
  }

  console.log(`\nOwnable contracts: ${result.ownableContracts.length}`);
  for (const c of result.ownableContracts) {
    console.log(`- ${c.name} (${c.address}) owner=${c.owner} deployerIsOwner=${c.deployerIsOwner}`);
  }

  // Final exposure summary
  const exposureRoles = result.rolesContracts.filter((c) => c.rolesHeldByDeployer.length > 0);
  const exposureOwnable = result.ownableContracts.filter((c) => c.deployerIsOwner);

  console.log("\n--- Deployer Exposure Summary ---");
  if (exposureRoles.length > 0) {
    console.log(`Contracts with roles held by deployer: ${exposureRoles.length}`);
    for (const c of exposureRoles) {
      console.log(`- ${c.name} (${c.address})`);
      for (const role of c.rolesHeldByDeployer) {
        console.log(`  - ${role.name} (hash: ${role.hash})`);
      }
    }
  } else {
    console.log("Deployer holds no AccessControl roles.");
  }

  if (exposureOwnable.length > 0) {
    console.log(`\nOwnable contracts owned by deployer: ${exposureOwnable.length}`);
    for (const c of exposureOwnable) {
      console.log(`- ${c.name} (${c.address})`);
    }
  } else {
    console.log("\nDeployer owns no Ownable contracts.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
