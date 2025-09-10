import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_AMO_DEBT_TOKEN_ID,
  DS_AMO_MANAGER_V2_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  DUSD_AMO_DEBT_TOKEN_ID,
  DUSD_AMO_MANAGER_V2_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  // Initialize governance executor
  const executor = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await executor.initialize();

  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: executing...`);

  const governanceMultisig = config.walletAddresses.governanceMultisig;
  console.log(`🔐 Governance multisig: ${governanceMultisig}`);

  // Configuration for both systems
  const amoConfigs = [
    {
      name: "dUSD",
      tokenId: DUSD_TOKEN_ID,
      oracleId: USD_ORACLE_AGGREGATOR_ID,
      collateralVaultId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerV2Id: DUSD_AMO_MANAGER_V2_ID,
      amoDebtTokenId: DUSD_AMO_DEBT_TOKEN_ID,
    },
    {
      name: "dS",
      tokenId: DS_TOKEN_ID,
      oracleId: S_ORACLE_AGGREGATOR_ID,
      collateralVaultId: DS_COLLATERAL_VAULT_CONTRACT_ID,
      amoManagerV2Id: DS_AMO_MANAGER_V2_ID,
      amoDebtTokenId: DS_AMO_DEBT_TOKEN_ID,
    },
  ];

  let allOperationsComplete = true;

  for (const amoConfig of amoConfigs) {
    console.log(`\n🔄 Configuring ${amoConfig.name} AMO system...`);

    // Get deployed contracts
    const tokenDeployment = await deployments.get(amoConfig.tokenId);
    const oracleDeployment = await deployments.get(amoConfig.oracleId);
    const collateralVaultDeployment = await deployments.get(amoConfig.collateralVaultId);
    const amoManagerDeployment = await deployments.get(amoConfig.amoManagerV2Id);
    const debtTokenDeployment = await deployments.get(amoConfig.amoDebtTokenId);

    // Get contract instances
    const dstable = await ethers.getContractAt("ERC20StablecoinUpgradeable", tokenDeployment.address, deployerSigner);
    const oracle = await ethers.getContractAt("OracleAggregator", oracleDeployment.address, deployerSigner);
    const collateralVault = await ethers.getContractAt("CollateralHolderVault", collateralVaultDeployment.address, deployerSigner);
    const amoManager = await ethers.getContractAt("AmoManagerV2", amoManagerDeployment.address, deployerSigner);
    const debtToken = await ethers.getContractAt("AmoDebtToken", debtTokenDeployment.address, deployerSigner);

    console.log(`  📊 Setting up oracle price feed for debt token...`);

    // Configure oracle to return base currency unit (1.0) for debt token
    const baseCurrencyUnit = await oracle.BASE_CURRENCY_UNIT();
    const priceDecimals = await oracle.PRICE_DECIMALS();
    const fixedPrice = baseCurrencyUnit; // 1.0 in base units

    try {
      const currentPrice = await oracle.getAssetPrice(debtTokenDeployment.address);

      if (currentPrice !== fixedPrice) {
        console.log(`    Setting debt token price to ${ethers.formatUnits(fixedPrice, priceDecimals)}`);

        // Note: This assumes the oracle has a method to set prices (for mock oracles)
        // In production, this would be handled differently depending on the oracle implementation
        if (oracle.interface.hasFunction("setAssetPrice")) {
          const complete = await executor.tryOrQueue(
            async () => {
              await oracle.setAssetPrice(debtTokenDeployment.address, fixedPrice);
              console.log(`    ✅ Debt token oracle price set`);
            },
            () => ({
              to: oracleDeployment.address,
              value: "0",
              data: oracle.interface.encodeFunctionData("setAssetPrice", [debtTokenDeployment.address, fixedPrice]),
            }),
          );
          if (!complete) allOperationsComplete = false;
        } else {
          console.log(`    ℹ️  Oracle doesn't support setAssetPrice - manual configuration required`);
        }
      } else {
        console.log(`    ✅ Debt token oracle price already set correctly`);
      }
    } catch (error) {
      console.log(`    ⚠️  Could not check oracle price, assuming it needs to be set: ${error}`);
    }

    console.log(`  🔐 Setting up roles and permissions...`);

    // 1. Grant roles on debt token to AMO Manager V2
    const AMO_MINTER_ROLE = await debtToken.AMO_MINTER_ROLE();
    const AMO_BORROWER_ROLE = await debtToken.AMO_BORROWER_ROLE();

    if (!(await debtToken.hasRole(AMO_MINTER_ROLE, amoManagerDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await debtToken.grantRole(AMO_MINTER_ROLE, amoManagerDeployment.address);
          console.log(`    ✅ Granted AMO_MINTER_ROLE to AMO Manager V2`);
        },
        () => ({
          to: debtTokenDeployment.address,
          value: "0",
          data: debtToken.interface.encodeFunctionData("grantRole", [AMO_MINTER_ROLE, amoManagerDeployment.address]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ AMO_MINTER_ROLE already granted to AMO Manager V2`);
    }

    if (!(await debtToken.hasRole(AMO_BORROWER_ROLE, amoManagerDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await debtToken.grantRole(AMO_BORROWER_ROLE, amoManagerDeployment.address);
          console.log(`    ✅ Granted AMO_BORROWER_ROLE to AMO Manager V2`);
        },
        () => ({
          to: debtTokenDeployment.address,
          value: "0",
          data: debtToken.interface.encodeFunctionData("grantRole", [AMO_BORROWER_ROLE, amoManagerDeployment.address]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ AMO_BORROWER_ROLE already granted to AMO Manager V2`);
    }

    // 2. Grant MINTER_ROLE on dStable to AMO Manager V2
    const MINTER_ROLE = await dstable.MINTER_ROLE();

    if (!(await dstable.hasRole(MINTER_ROLE, amoManagerDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await dstable.grantRole(MINTER_ROLE, amoManagerDeployment.address);
          console.log(`    ✅ Granted MINTER_ROLE on dStable to AMO Manager V2`);
        },
        () => ({
          to: tokenDeployment.address,
          value: "0",
          data: dstable.interface.encodeFunctionData("grantRole", [MINTER_ROLE, amoManagerDeployment.address]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ MINTER_ROLE on dStable already granted to AMO Manager V2`);
    }

    // 3. Grant COLLATERAL_WITHDRAWER_ROLE on vault to AMO Manager V2
    const COLLATERAL_WITHDRAWER_ROLE = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();

    if (!(await collateralVault.hasRole(COLLATERAL_WITHDRAWER_ROLE, amoManagerDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await collateralVault.grantRole(COLLATERAL_WITHDRAWER_ROLE, amoManagerDeployment.address);
          console.log(`    ✅ Granted COLLATERAL_WITHDRAWER_ROLE on vault to AMO Manager V2`);
        },
        () => ({
          to: collateralVaultDeployment.address,
          value: "0",
          data: collateralVault.interface.encodeFunctionData("grantRole", [COLLATERAL_WITHDRAWER_ROLE, amoManagerDeployment.address]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ COLLATERAL_WITHDRAWER_ROLE on vault already granted to AMO Manager V2`);
    }

    console.log(`  📝 Setting up allowlists...`);

    // 4. Add collateral vault to debt token allowlist
    if (!(await debtToken.isAllowlisted(collateralVaultDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await debtToken.setAllowlisted(collateralVaultDeployment.address, true);
          console.log(`    ✅ Added collateral vault to debt token allowlist`);
        },
        () => ({
          to: debtTokenDeployment.address,
          value: "0",
          data: debtToken.interface.encodeFunctionData("setAllowlisted", [collateralVaultDeployment.address, true]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ Collateral vault already allowlisted on debt token`);
    }

    // 5. Add AMO Manager V2 to debt token allowlist (for burns)
    if (!(await debtToken.isAllowlisted(amoManagerDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await debtToken.setAllowlisted(amoManagerDeployment.address, true);
          console.log(`    ✅ Added AMO Manager V2 to debt token allowlist`);
        },
        () => ({
          to: debtTokenDeployment.address,
          value: "0",
          data: debtToken.interface.encodeFunctionData("setAllowlisted", [amoManagerDeployment.address, true]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ AMO Manager V2 already allowlisted on debt token`);
    }

    // 6. Add vault to AMO Manager V2 allowed vaults
    if (!(await amoManager.isVaultAllowed(collateralVaultDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await amoManager.setVaultAllowed(collateralVaultDeployment.address, true);
          console.log(`    ✅ Added vault to AMO Manager V2 allowed vaults`);
        },
        () => ({
          to: amoManagerDeployment.address,
          value: "0",
          data: amoManager.interface.encodeFunctionData("setVaultAllowed", [collateralVaultDeployment.address, true]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ Vault already allowed in AMO Manager V2`);
    }

    // 7. Add governance multisig to AMO Manager V2 allowed endpoints
    if (!(await amoManager.isEndpointAllowed(governanceMultisig))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await amoManager.setEndpointAllowed(governanceMultisig, true);
          console.log(`    ✅ Added governance multisig to AMO Manager V2 allowed endpoints`);
        },
        () => ({
          to: amoManagerDeployment.address,
          value: "0",
          data: amoManager.interface.encodeFunctionData("setEndpointAllowed", [governanceMultisig, true]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ Governance multisig already allowed as endpoint in AMO Manager V2`);
    }

    console.log(`  ⚖️  Adding debt token as supported collateral...`);

    // 8. Add debt token to vault as supported collateral
    if (!(await collateralVault.isCollateralSupported(debtTokenDeployment.address))) {
      const complete = await executor.tryOrQueue(
        async () => {
          await collateralVault.allowCollateral(debtTokenDeployment.address);
          console.log(`    ✅ Added debt token to vault supported collateral`);
        },
        () => ({
          to: collateralVaultDeployment.address,
          value: "0",
          data: collateralVault.interface.encodeFunctionData("allowCollateral", [debtTokenDeployment.address]),
        }),
      );
      if (!complete) allOperationsComplete = false;
    } else {
      console.log(`    ✅ Debt token already supported as collateral in vault`);
    }

    console.log(`  ✅ ${amoConfig.name} AMO system configuration complete`);
  }

  if (!allOperationsComplete) {
    const flushed = await executor.flush(`Configure AMO Manager V2 and Debt System`);

    if (executor.useSafe) {
      if (!flushed) {
        console.log(`❌ Failed to prepare governance batch`);
      }
      console.log("\n⏳ Some operations require governance signatures to complete.");
      console.log("   The deployment script will exit and can be re-run after governance executes the transactions.");
      console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: pending governance ⏳`);
      return false;
    } else {
      console.log("\n⏭️ Non-Safe mode: pending governance operations detected; continuing.");
    }
  }

  console.log("\n✅ All AMO system configuration completed successfully.");
  console.log(`\n≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

export default func;
func.id = "02_configure_amo_system";
func.tags = ["amo-debt-system", "amo-configuration"];
func.dependencies = [
  // Core AMO deployments
  DUSD_AMO_MANAGER_V2_ID,
  DS_AMO_MANAGER_V2_ID,
  DUSD_AMO_DEBT_TOKEN_ID,
  DS_AMO_DEBT_TOKEN_ID,
];
