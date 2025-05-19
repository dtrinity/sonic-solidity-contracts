import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { execute, read, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log(
      "No dStake configuration found for this network. Skipping configuration."
    );
    return;
  }

  // Validate all configs before configuring anything
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

  // All configs are valid, proceed with configuration
  for (const instanceKey in config.dStake) {
    const instanceConfig = config.dStake[instanceKey] as DStakeInstanceConfig;
    const DStakeTokenDeploymentName = `DStakeToken_${instanceKey}`;
    const collateralVaultDeploymentName = `DStakeCollateralVault_${instanceKey}`;
    const routerDeploymentName = `DStakeRouter_${instanceKey}`;

    const collateralVaultDeployment = await get(collateralVaultDeploymentName);
    const routerDeployment = await get(routerDeploymentName);
    const dstakeTokenDeployment = await get(DStakeTokenDeploymentName);

    const initialAdmin = instanceConfig.initialAdmin;
    const initialFeeManager = instanceConfig.initialFeeManager;

    const adminSigner = initialAdmin === deployer ? deployer : initialAdmin;
    const feeManagerSigner =
      initialFeeManager === deployer ? deployer : initialFeeManager;

    // Get Typechain instances
    const dstakeToken = await ethers.getContractAt(
      "DStakeToken",
      dstakeTokenDeployment.address,
      await ethers.getSigner(deployer) // Use deployer as signer for read calls if needed, will connect admin/feeManager for transactions
    );
    const collateralVault = await ethers.getContractAt(
      "DStakeCollateralVault",
      collateralVaultDeployment.address,
      await ethers.getSigner(deployer) // Use deployer as signer for read calls
    );

    // --- Configure DStakeToken ---
    const currentRouter = await dstakeToken.router();

    if (currentRouter !== routerDeployment.address) {
      console.log(
        `    ⚙️ Setting router for ${DStakeTokenDeploymentName} to ${routerDeployment.address}`
      );
      await dstakeToken
        .connect(await ethers.getSigner(adminSigner))
        .setRouter(routerDeployment.address);
    }
    const currentVault = await dstakeToken.collateralVault();

    if (currentVault !== collateralVaultDeployment.address) {
      console.log(
        `    ⚙️ Setting collateral vault for ${DStakeTokenDeploymentName} to ${collateralVaultDeployment.address}`
      );
      await dstakeToken
        .connect(await ethers.getSigner(adminSigner))
        .setCollateralVault(collateralVaultDeployment.address);
    }
    const currentFee = await dstakeToken.withdrawalFeeBps();

    if (
      currentFee.toString() !==
      instanceConfig.initialWithdrawalFeeBps.toString()
    ) {
      console.log(
        `    ⚙️ Setting withdrawal fee for ${DStakeTokenDeploymentName} to ${instanceConfig.initialWithdrawalFeeBps}`
      );
      await dstakeToken
        .connect(await ethers.getSigner(feeManagerSigner))
        .setWithdrawalFee(instanceConfig.initialWithdrawalFeeBps);
    }

    // --- Configure DStakeCollateralVault ---
    const routerContract = await ethers.getContractAt(
      "DStakeRouterDLend",
      routerDeployment.address,
      await ethers.getSigner(adminSigner)
    );

    const vaultRouter = await collateralVault.router();
    const vaultRouterRole = await collateralVault.ROUTER_ROLE();
    const isRouterRoleGranted = await collateralVault.hasRole(
      vaultRouterRole,
      routerDeployment.address
    );

    if (vaultRouter !== routerDeployment.address || !isRouterRoleGranted) {
      console.log(
        `    ⚙️ Setting router for ${collateralVaultDeploymentName} to ${routerDeployment.address}`
      );
      await collateralVault
        .connect(await ethers.getSigner(adminSigner))
        .setRouter(routerDeployment.address);
    }

    // --- Configure DStakeCollateralVault Adapters ---
    for (const adapterConfig of instanceConfig.adapters) {
      const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
      const adapterDeployment = await get(adapterDeploymentName);
      const vaultAssetAddress = adapterConfig.vaultAsset;
      await collateralVault
        .connect(await ethers.getSigner(adminSigner))
        .addAdapter(vaultAssetAddress, adapterDeployment.address);
      console.log(
        `    ➕ Added adapter ${adapterDeploymentName} for asset ${vaultAssetAddress} to ${collateralVaultDeploymentName}`
      );
    }

    // --- Configure DStakeRouter --- // This part already uses Typechain
    const collateralExchangerRole =
      await routerContract.COLLATERAL_EXCHANGER_ROLE();

    for (const exchanger of instanceConfig.collateralExchangers) {
      const hasRole = await routerContract.hasRole(
        collateralExchangerRole,
        exchanger
      );

      if (!hasRole) {
        await routerContract.grantRole(collateralExchangerRole, exchanger);
        console.log(
          `    ➕ Granted COLLATERAL_EXCHANGER_ROLE to ${exchanger} for ${routerDeploymentName}`
        );
      }
    }

    for (const adapterConfig of instanceConfig.adapters) {
      const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
      const adapterDeployment = await get(adapterDeploymentName);
      const vaultAssetAddress = adapterConfig.vaultAsset;
      const currentAdapter =
        await routerContract.vaultAssetToAdapter(vaultAssetAddress);

      if (currentAdapter !== adapterDeployment.address) {
        await routerContract.addAdapter(
          vaultAssetAddress,
          adapterDeployment.address
        );
        console.log(
          `    ➕ Added adapter ${adapterDeploymentName} for asset ${vaultAssetAddress} to ${routerDeploymentName}`
        );
      }
    }

    const currentDefaultAsset = await routerContract.defaultDepositVaultAsset();

    if (currentDefaultAsset !== instanceConfig.defaultDepositVaultAsset) {
      await routerContract.setDefaultDepositVaultAsset(
        instanceConfig.defaultDepositVaultAsset
      );
      console.log(
        `    ⚙️ Set default deposit vault asset for ${routerDeploymentName}`
      );
    }
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.tags = ["dStakeConfigure", "dStake"];
func.dependencies = ["dStakeCore", "dStakeAdapters"];
func.runAtTheEnd = true;
