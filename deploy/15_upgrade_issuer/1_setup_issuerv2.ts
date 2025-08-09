import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Signer } from "ethers";

import { getConfig } from "../../config/config";
import {
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DUSD_TOKEN_ID,
  DS_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_ISSUER_CONTRACT_ID,
  DS_ISSUER_V2_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

async function ensureMinterRole(
  hre: HardhatRuntimeEnvironment,
  stableAddress: string,
  grantee: string
): Promise<void> {
  const stable = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    stableAddress
  );
  const MINTER_ROLE = await stable.MINTER_ROLE();
  if (!(await stable.hasRole(MINTER_ROLE, grantee))) {
    await stable.grantRole(MINTER_ROLE, grantee);
    console.log(`    ➕ Granted MINTER_ROLE to ${grantee}`);
  } else {
    console.log(`    ✓ MINTER_ROLE already granted to ${grantee}`);
  }
}

async function migrateIssuerRolesIdempotent(
  hre: HardhatRuntimeEnvironment,
  issuerName: string,
  issuerAddress: string,
  deployerSigner: Signer,
  governanceMultisig: string
): Promise<void> {
  const issuer = await hre.ethers.getContractAt(
    "IssuerV2",
    issuerAddress,
    deployerSigner
  );

  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const AMO_MANAGER_ROLE = await issuer.AMO_MANAGER_ROLE();
  const INCENTIVES_MANAGER_ROLE = await issuer.INCENTIVES_MANAGER_ROLE();
  const ASSET_MANAGER_ROLE = await issuer.ASSET_MANAGER_ROLE();
  const PAUSER_ROLE = await issuer.PAUSER_ROLE();

  const roles = [
    { name: "DEFAULT_ADMIN_ROLE", hash: DEFAULT_ADMIN_ROLE },
    { name: "AMO_MANAGER_ROLE", hash: AMO_MANAGER_ROLE },
    { name: "INCENTIVES_MANAGER_ROLE", hash: INCENTIVES_MANAGER_ROLE },
    { name: "ASSET_MANAGER_ROLE", hash: ASSET_MANAGER_ROLE },
    { name: "PAUSER_ROLE", hash: PAUSER_ROLE },
  ];

  console.log(`  📄 Migrating roles for ${issuerName} at ${issuerAddress}`);

  for (const role of roles) {
    if (!(await issuer.hasRole(role.hash, governanceMultisig))) {
      await issuer.grantRole(role.hash, governanceMultisig);
      console.log(`    ➕ Granted ${role.name} to ${governanceMultisig}`);
    } else {
      console.log(
        `    ✓ ${role.name} already granted to ${governanceMultisig}`
      );
    }
  }

  // After ensuring governance has roles, revoke from deployer in a safe order
  const deployerAddress = await deployerSigner.getAddress();

  for (const role of [
    AMO_MANAGER_ROLE,
    INCENTIVES_MANAGER_ROLE,
    ASSET_MANAGER_ROLE,
    PAUSER_ROLE,
  ]) {
    if (await issuer.hasRole(role, deployerAddress)) {
      await issuer.revokeRole(role, deployerAddress);
      console.log(`    ➖ Revoked ${role} from deployer`);
    }
  }

  if (await issuer.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress)) {
    await issuer.revokeRole(DEFAULT_ADMIN_ROLE, deployerAddress);
    console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from deployer`);
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Upgrade flow for each dStable: deploy IssuerV2, grant minter role, migrate roles idempotently
  type UpgradeTarget = {
    symbol: "dUSD" | "dS";
    oldId: string;
    newId: string;
    tokenId: string;
    vaultId: string;
    amoId: string;
    oracleId: string;
  };

  const targets: UpgradeTarget[] = [
    {
      symbol: "dUSD",
      oldId: DUSD_ISSUER_CONTRACT_ID,
      newId: DUSD_ISSUER_V2_CONTRACT_ID,
      tokenId: DUSD_TOKEN_ID,
      vaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      amoId: DUSD_AMO_MANAGER_ID,
      oracleId: USD_ORACLE_AGGREGATOR_ID,
    },
    {
      symbol: "dS",
      oldId: DS_ISSUER_CONTRACT_ID,
      newId: DS_ISSUER_V2_CONTRACT_ID,
      tokenId: DS_TOKEN_ID,
      vaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      amoId: DS_AMO_MANAGER_ID,
      oracleId: S_ORACLE_AGGREGATOR_ID,
    },
  ];

  for (const t of targets) {
    console.log(`\n=== Upgrading Issuer for ${t.symbol} ===`);

    const oldDeployment = await deployments.getOrNull(t.oldId);
    if (!oldDeployment) {
      console.log(
        `  ⚠️ Old issuer ${t.oldId} not found. Skipping ${t.symbol}.`
      );
      continue;
    }

    // Resolve dependency addresses
    const { address: oracleAggregatorAddress } = await deployments.get(
      t.oracleId
    );
    const { address: collateralVaultAddress } = await deployments.get(
      t.vaultId
    );
    const { address: amoManagerAddress } = await deployments.get(t.amoId);
    const tokenAddress = (config as any).tokenAddresses[t.symbol];

    // Deploy new IssuerV2 if not already deployed
    const result = await deployments.deploy(t.newId, {
      from: deployer,
      args: [
        collateralVaultAddress,
        tokenAddress,
        oracleAggregatorAddress,
        amoManagerAddress,
      ],
      contract: "IssuerV2",
      autoMine: true,
      log: false,
    });

    if (result.newlyDeployed) {
      console.log(`  ✅ Deployed ${t.newId} at ${result.address}`);
    } else {
      console.log(`  ✓ ${t.newId} already deployed at ${result.address}`);
    }

    const newIssuerAddress = result.address;

    // Grant MINTER_ROLE on the token to the new issuer (idempotent)
    await ensureMinterRole(hre, tokenAddress, newIssuerAddress);

    // Revoke MINTER_ROLE from the old issuer, but only after the new issuer has it
    try {
      const stable = await hre.ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        tokenAddress
      );
      const MINTER_ROLE = await stable.MINTER_ROLE();
      if (
        oldDeployment.address.toLowerCase() !==
          newIssuerAddress.toLowerCase() &&
        (await stable.hasRole(MINTER_ROLE, oldDeployment.address))
      ) {
        await stable.revokeRole(MINTER_ROLE, oldDeployment.address);
        console.log(
          `    ➖ Revoked MINTER_ROLE from old issuer ${oldDeployment.address}`
        );
      } else {
        console.log(
          `    ✓ Old issuer ${oldDeployment.address} does not have MINTER_ROLE or equals new issuer`
        );
      }
    } catch (e) {
      console.log(
        `    ⚠️ Could not check/revoke MINTER_ROLE on old issuer: ${(e as Error).message}`
      );
    }

    // Migrate roles to governance multisig (always idempotent)
    await migrateIssuerRolesIdempotent(
      hre,
      t.newId,
      newIssuerAddress,
      deployerSigner,
      config.walletAddresses.governanceMultisig
    );

    // Optional: keep old issuer operational until governance flips references
    console.log(
      `  ℹ️ New issuer ${t.newId} deployed and permissioned. Ensure dApp/services reference ${newIssuerAddress}.`
    );
  }

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.id = "1_setup_issuerv2";
func.tags = ["setup-issuerv2"];
func.dependencies = [
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
  DUSD_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  DS_AMO_MANAGER_ID,
];

export default func;
