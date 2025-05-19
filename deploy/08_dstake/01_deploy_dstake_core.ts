import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";
// Assuming these IDs exist

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log(
      "No dStake configuration found for this network. Skipping core deployment."
    );
    return;
  }

  // Validate all configs before deploying anything
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;

    if (
      !instanceConfig.dStable ||
      instanceConfig.dStable === ethers.ZeroAddress
    ) {
      throw new Error(
        `Missing dStable address for dSTAKE instance ${instanceKey}`
      );
    }

    if (!instanceConfig.symbol) {
      throw new Error(`Missing symbol for dSTAKE instance ${instanceKey}`);
    }

    if (!instanceConfig.name) {
      throw new Error(`Missing name for dSTAKE instance ${instanceKey}`);
    }

    if (
      !instanceConfig.initialAdmin ||
      instanceConfig.initialAdmin === ethers.ZeroAddress
    ) {
      throw new Error(
        `Missing initialAdmin for dSTAKE instance ${instanceKey}`
      );
    }

    if (
      !instanceConfig.initialFeeManager ||
      instanceConfig.initialFeeManager === ethers.ZeroAddress
    ) {
      throw new Error(
        `Missing initialFeeManager for dSTAKE instance ${instanceKey}`
      );
    }

    if (typeof instanceConfig.initialWithdrawalFeeBps !== "number") {
      throw new Error(
        `Missing initialWithdrawalFeeBps for dSTAKE instance ${instanceKey}`
      );
    }

    if (!instanceConfig.adapters || !Array.isArray(instanceConfig.adapters)) {
      throw new Error(
        `Missing adapters array for dSTAKE instance ${instanceKey}`
      );
    }

    if (
      !instanceConfig.defaultDepositVaultAsset ||
      instanceConfig.defaultDepositVaultAsset === ethers.ZeroAddress
    ) {
      throw new Error(
        `Missing defaultDepositVaultAsset for dSTAKE instance ${instanceKey}`
      );
    }

    if (
      !instanceConfig.collateralExchangers ||
      !Array.isArray(instanceConfig.collateralExchangers)
    ) {
      throw new Error(
        `Missing collateralExchangers array for dSTAKE instance ${instanceKey}`
      );
    }
  }

  // All configs are valid, proceed with deployment
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const DStakeTokenDeploymentName = `DStakeToken_${instanceKey}`;
    const DStakeTokenDeployment = await deploy(DStakeTokenDeploymentName, {
      from: deployer,
      contract: "DStakeToken",
      proxy: {
        proxyContract: "OpenZeppelinTransparentProxy",
        execute: {
          init: {
            methodName: "initialize",
            args: [
              instanceConfig.dStable,
              instanceConfig.name,
              instanceConfig.symbol,
              instanceConfig.initialAdmin,
              instanceConfig.initialFeeManager,
            ],
          },
        },
      },
      log: false,
    });

    const collateralVaultDeploymentName = `DStakeCollateralVault_${instanceKey}`;
    const collateralVaultDeployment = await deploy(
      collateralVaultDeploymentName,
      {
        from: deployer,
        contract: "DStakeCollateralVault",
        args: [DStakeTokenDeployment.address, instanceConfig.dStable],
        log: false,
      }
    );

    const routerDeploymentName = `DStakeRouter_${instanceKey}`;
    const routerDeployment = await deploy(routerDeploymentName, {
      from: deployer,
      contract: "DStakeRouterDLend",
      args: [DStakeTokenDeployment.address, collateralVaultDeployment.address],
      log: false,
    });

    // --- Grant Vault Admin Role to Initial Admin ---
    const collateralVault = await hre.ethers.getContractAt(
      "DStakeCollateralVault",
      collateralVaultDeployment.address
    );
    const adminRole = ethers.ZeroHash;
    const hasVaultAdminRole = await collateralVault.hasRole(
      adminRole,
      instanceConfig.initialAdmin
    );

    if (!hasVaultAdminRole) {
      const tx = await collateralVault.grantRole(
        adminRole,
        instanceConfig.initialAdmin
      );
      await tx.wait();
    }

    // --- Grant Router Admin Role to Initial Admin ---
    const router = await hre.ethers.getContractAt(
      "DStakeRouterDLend",
      routerDeployment.address
    );
    const routerAdminRole = ethers.ZeroHash;

    const hasRouterAdminRole = await router.hasRole(
      routerAdminRole,
      instanceConfig.initialAdmin
    );

    if (!hasRouterAdminRole) {
      const grantTx = await router
        .connect(await hre.ethers.getSigner(deployer))
        .grantRole(routerAdminRole, instanceConfig.initialAdmin);
      await grantTx.wait();
    }
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.tags = ["dStakeCore", "dStake"];
// Depends on adapters being deployed if adapters need to be configured *during* core deployment (unlikely)
// Primarily depends on the underlying dStable tokens being deployed.
func.dependencies = ["dStable", "dUSD-aTokenWrapper", "dS-aTokenWrapper"]; // Ensure dUSD/dS and their wrapped tokens are deployed
