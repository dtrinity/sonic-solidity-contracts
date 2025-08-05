import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DStakeInstanceConfig } from "../../config/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { get } = deployments;
  const { deployer } = await getNamedAccounts();

  // Use deployer for all state-changing transactions. Permission migrations to the
  // designated admin and fee manager addresses will be handled in a separate
  // script executed after configuration.
  const deployerSigner = await ethers.getSigner(deployer);

  const config = await getConfig(hre);

  if (!config.dStake) {
    console.log(
      "No dSTAKE configuration found for this network. Skipping configuration.",
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
        `Missing dStable address for dSTAKE instance ${instanceKey}`,
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
        `Missing initialAdmin for dSTAKE instance ${instanceKey}`,
      );
    }

    if (
      !instanceConfig.initialFeeManager ||
      instanceConfig.initialFeeManager === ethers.ZeroAddress
    ) {
      throw new Error(
        `Missing initialFeeManager for dSTAKE instance ${instanceKey}`,
      );
    }

    if (typeof instanceConfig.initialWithdrawalFeeBps !== "number") {
      throw new Error(
        `Missing initialWithdrawalFeeBps for dSTAKE instance ${instanceKey}`,
      );
    }

    if (!instanceConfig.adapters || !Array.isArray(instanceConfig.adapters)) {
      throw new Error(
        `Missing adapters array for dSTAKE instance ${instanceKey}`,
      );
    }

    if (
      !instanceConfig.defaultDepositVaultAsset ||
      instanceConfig.defaultDepositVaultAsset === ethers.ZeroAddress
    ) {
      throw new Error(
        `Missing defaultDepositVaultAsset for dSTAKE instance ${instanceKey}`,
      );
    }

    if (
      !instanceConfig.collateralExchangers ||
      !Array.isArray(instanceConfig.collateralExchangers)
    ) {
      throw new Error(
        `Missing collateralExchangers array for dSTAKE instance ${instanceKey}`,
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

    // (Permissions remain with the deployer; role migration happens later.)
    // Get Typechain instances
    const dstakeToken = await ethers.getContractAt(
      "DStakeToken",
      dstakeTokenDeployment.address,
      await ethers.getSigner(deployer), // Use deployer as signer for read calls
    );
    const collateralVault = await ethers.getContractAt(
      "DStakeCollateralVault",
      collateralVaultDeployment.address,
      await ethers.getSigner(deployer), // Use deployer as signer for read calls
    );

    // --- Configure DStakeToken ---
    const currentRouter = await dstakeToken.router();

    if (currentRouter !== routerDeployment.address) {
      console.log(
        `    ⚙️ Setting router for ${DStakeTokenDeploymentName} to ${routerDeployment.address}`,
      );
      await dstakeToken
        .connect(deployerSigner)
        .setRouter(routerDeployment.address);
    }
    const currentVault = await dstakeToken.collateralVault();

    if (currentVault !== collateralVaultDeployment.address) {
      console.log(
        `    ⚙️ Setting collateral vault for ${DStakeTokenDeploymentName} to ${collateralVaultDeployment.address}`,
      );
      await dstakeToken
        .connect(deployerSigner)
        .setCollateralVault(collateralVaultDeployment.address);
    }
    const currentFee = await dstakeToken.withdrawalFeeBps();

    if (
      currentFee.toString() !==
      instanceConfig.initialWithdrawalFeeBps.toString()
    ) {
      console.log(
        `    ⚙️ Setting withdrawal fee for ${DStakeTokenDeploymentName} to ${instanceConfig.initialWithdrawalFeeBps}`,
      );
      await dstakeToken
        .connect(deployerSigner)
        .setWithdrawalFee(instanceConfig.initialWithdrawalFeeBps);
    }

    // --- Configure DStakeCollateralVault ---
    const routerContract = await ethers.getContractAt(
      "DStakeRouterDLend",
      routerDeployment.address,
      deployerSigner,
    );

    const vaultRouter = await collateralVault.router();
    const vaultRouterRole = await collateralVault.ROUTER_ROLE();
    const isRouterRoleGranted = await collateralVault.hasRole(
      vaultRouterRole,
      routerDeployment.address,
    );

    if (vaultRouter !== routerDeployment.address || !isRouterRoleGranted) {
      console.log(
        `    ⚙️ Setting router for ${collateralVaultDeploymentName} to ${routerDeployment.address}`,
      );
      await collateralVault
        .connect(deployerSigner)
        .setRouter(routerDeployment.address);
    }

    // --- Configure DStakeCollateralVault Adapters ---
    for (const adapterConfig of instanceConfig.adapters) {
      const adapterDeploymentName = `${adapterConfig.adapterContract}_${instanceConfig.symbol}`;
      const adapterDeployment = await get(adapterDeploymentName);
      const vaultAssetAddress = adapterConfig.vaultAsset;
      const existingAdapter =
        await routerContract.vaultAssetToAdapter(vaultAssetAddress);

      if (existingAdapter === ethers.ZeroAddress) {
        await routerContract
          .connect(deployerSigner)
          .addAdapter(vaultAssetAddress, adapterDeployment.address);
        console.log(
          `    ➕ Added adapter ${adapterDeploymentName} for asset ${vaultAssetAddress} to ${routerDeploymentName}`,
        );
      } else if (existingAdapter !== adapterDeployment.address) {
        throw new Error(
          `⚠️ Adapter for asset ${vaultAssetAddress} in router is already set to ${existingAdapter} but config expects ${adapterDeployment.address}. Manual intervention may be required.`,
        );
      } else {
        console.log(
          `    👍 Adapter ${adapterDeploymentName} for asset ${vaultAssetAddress} already configured correctly in ${routerDeploymentName}`,
        );
      }
    }

    // --- Configure DStakeRouter --- // This part already uses Typechain
    const collateralExchangerRole =
      await routerContract.COLLATERAL_EXCHANGER_ROLE();

    for (const exchanger of instanceConfig.collateralExchangers) {
      const hasRole = await routerContract.hasRole(
        collateralExchangerRole,
        exchanger,
      );

      if (!hasRole) {
        await routerContract.grantRole(collateralExchangerRole, exchanger);
        console.log(
          `    ➕ Granted COLLATERAL_EXCHANGER_ROLE to ${exchanger} for ${routerDeploymentName}`,
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
          adapterDeployment.address,
        );
        console.log(
          `    ➕ Added adapter ${adapterDeploymentName} for asset ${vaultAssetAddress} to ${routerDeploymentName}`,
        );
      }
    }

    const currentDefaultAsset = await routerContract.defaultDepositVaultAsset();

    if (currentDefaultAsset !== instanceConfig.defaultDepositVaultAsset) {
      await routerContract.setDefaultDepositVaultAsset(
        instanceConfig.defaultDepositVaultAsset,
      );
      console.log(
        `    ⚙️ Set default deposit vault asset for ${routerDeploymentName}`,
      );
    }
  }

  console.log(`🥩 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

export default func;
func.tags = ["dStakeConfigure", "dStake"];
func.dependencies = ["dStakeCore", "dStakeAdapters"];
func.runAtTheEnd = true;

// Prevent re-execution after successful run.
func.id = "configure_dstake";
