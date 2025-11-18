import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { rateStrategyZeroBorrow } from "../../config/dlend/interest-rate-strategies";
import { DUSD_ISSUER_V2_CONTRACT_ID, DUSD_REDEEMER_V2_CONTRACT_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { isMainnet } from "../../typescript/hardhat/deploy";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const STRATEGY_DEPLOYMENT_ID = `ReserveStrategy-${rateStrategyZeroBorrow.name}`;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

  if (!isMainnet(hre.network.name)) {
    console.log("ℹ️ Trevee unwind script is mainnet-only. Skipping on this network.");
    return true;
  }

  const governance = new GovernanceExecutor(hre, deployerSigner, config.safeConfig);
  await governance.initialize();

  const addressProviderDeployment = await deployments.get(POOL_ADDRESSES_PROVIDER_ID);
  const addressProvider = await ethers.getContractAt("PoolAddressesProvider", addressProviderDeployment.address, deployerSigner);

  const poolAddress = await addressProvider.getPool();
  const configuratorAddress = await addressProvider.getPoolConfigurator();
  const pool = await ethers.getContractAt("Pool", poolAddress, deployerSigner);
  const configurator = await ethers.getContractAt("PoolConfigurator", configuratorAddress, deployerSigner);

  const strategyParams = rateStrategyZeroBorrow;
  const strategyArguments = [
    addressProviderDeployment.address,
    strategyParams.optimalUsageRatio,
    strategyParams.baseVariableBorrowRate,
    strategyParams.variableRateSlope1,
    strategyParams.variableRateSlope2,
    strategyParams.stableRateSlope1,
    strategyParams.stableRateSlope2,
    strategyParams.baseStableRateOffset,
    strategyParams.stableRateExcessOffset,
    strategyParams.optimalStableToTotalDebtRatio,
  ];

  const zeroStrategyDeployment = await deployments.deploy(STRATEGY_DEPLOYMENT_ID, {
    contract: "DefaultReserveInterestRateStrategy",
    from: deployer,
    args: strategyArguments,
    log: true,
    skipIfAlreadyDeployed: true,
  });
  const zeroStrategyAddress = zeroStrategyDeployment.address.toLowerCase();

  let requirementsComplete = true;

  const reserveTargets: { symbol: string; address: string }[] = [
    { symbol: "dUSD", address: config.tokenAddresses.dUSD },
    { symbol: "dS", address: config.tokenAddresses.dS },
  ];

  for (const target of reserveTargets) {
    const { symbol, address } = target;

    if (!address || address === ZeroAddress) {
      throw new Error(`Missing token address for ${symbol}. Cannot update reserve strategy.`);
    }

    const reserveData = await pool.getReserveData(address);
    const currentStrategy = reserveData.interestRateStrategyAddress.toLowerCase();

    if (currentStrategy === zeroStrategyAddress) {
      console.log(`✅ ${symbol} reserve already uses the zero borrow rate strategy.`);
      continue;
    }

    console.log(`🔄 Updating ${symbol} reserve to zero borrow rate strategy...`);
    const safeTxData = configurator.interface.encodeFunctionData("setReserveInterestRateStrategyAddress", [
      address,
      zeroStrategyDeployment.address,
    ]);
    const complete = await governance.tryOrQueue(
      async () => {
        const tx = await configurator.setReserveInterestRateStrategyAddress(address, zeroStrategyDeployment.address);
        await tx.wait();
        console.log(`   ➕ Applied zero borrow strategy on-chain for ${symbol}.`);
      },
      () => ({
        to: configuratorAddress,
        value: "0",
        data: safeTxData,
      }),
    );

    if (!complete) {
      requirementsComplete = false;
      console.log(`   📝 Queued Safe transaction to update ${symbol} reserve strategy.`);
    }
  }

  const dUsdCollaterals = (config.dStables.dUSD?.collaterals || []).filter((address) => address && address !== ZeroAddress);

  if (dUsdCollaterals.length === 0) {
    throw new Error("No dUSD collateral addresses configured; cannot enforce mint/redeem pauses.");
  } else {
    const issuerDeployment = await deployments.getOrNull(DUSD_ISSUER_V2_CONTRACT_ID);
    const redeemerDeployment = await deployments.getOrNull(DUSD_REDEEMER_V2_CONTRACT_ID);
    const issuerAddress = issuerDeployment?.address || process.env.DUSD_ISSUER_V2_ADDRESS;
    const redeemerAddress = redeemerDeployment?.address || process.env.DUSD_REDEEMER_V2_ADDRESS;

    if (!issuerAddress || !redeemerAddress) {
      throw new Error(
        "Missing IssuerV2 or RedeemerV2 deployments for dUSD; provide DUSD_ISSUER_V2_ADDRESS and DUSD_REDEEMER_V2_ADDRESS env vars to override.",
      );
    } else {
      if (!issuerDeployment) {
        console.log(`ℹ️ Using IssuerV2 override from env: ${issuerAddress}`);
      }

      if (!redeemerDeployment) {
        console.log(`ℹ️ Using RedeemerV2 override from env: ${redeemerAddress}`);
      }
      const issuer = await ethers.getContractAt("IssuerV2", issuerAddress, deployerSigner);
      const redeemer = await ethers.getContractAt("RedeemerV2", redeemerAddress, deployerSigner);
      const collateralVault = await ethers.getContractAt("CollateralVault", await issuer.collateralVault(), deployerSigner);

      for (const collateral of dUsdCollaterals) {
        const supported = await collateralVault.isCollateralSupported(collateral);

        if (!supported) {
          console.warn(`⚠️ Collateral ${collateral} is not supported by the vault; skipping.`);
          continue;
        }

        if (await issuer.assetMintingPaused(collateral)) {
          console.log(`✅ Minting already paused for collateral ${collateral}.`);
        } else {
          console.log(`⏸️ Pausing minting for collateral ${collateral}...`);
          const safeTxData = issuer.interface.encodeFunctionData("setAssetMintingPause", [collateral, true]);
          const complete = await governance.tryOrQueue(
            async () => {
              const tx = await issuer.setAssetMintingPause(collateral, true);
              await tx.wait();
              console.log(`   ➕ Minting paused for ${collateral}.`);
            },
            () => ({
              to: issuerAddress,
              value: "0",
              data: safeTxData,
            }),
          );

          if (!complete) {
            requirementsComplete = false;
            console.log(`   📝 Queued Safe transaction to pause minting for ${collateral}.`);
          }
        }

        if (await redeemer.assetRedemptionPaused(collateral)) {
          console.log(`✅ Redemption already paused for collateral ${collateral}.`);
        } else {
          console.log(`⏸️ Pausing redemption for collateral ${collateral}...`);
          const safeTxData = redeemer.interface.encodeFunctionData("setAssetRedemptionPause", [collateral, true]);
          const complete = await governance.tryOrQueue(
            async () => {
              const tx = await redeemer.setAssetRedemptionPause(collateral, true);
              await tx.wait();
              console.log(`   ➕ Redemption paused for ${collateral}.`);
            },
            () => ({
              to: redeemerAddress,
              value: "0",
              data: safeTxData,
            }),
          );

          if (!complete) {
            requirementsComplete = false;
            console.log(`   📝 Queued Safe transaction to pause redemption for ${collateral}.`);
          }
        }
      }

      if (!(await issuer.paused())) {
        console.log("⏸️ Pausing global dUSD minting...");
        const safeTxData = issuer.interface.encodeFunctionData("pauseMinting");
        const complete = await governance.tryOrQueue(
          async () => {
            const tx = await issuer.pauseMinting();
            await tx.wait();
            console.log("   ➕ Global minting paused on IssuerV2.");
          },
          () => ({
            to: issuerAddress,
            value: "0",
            data: safeTxData,
          }),
        );

        if (!complete) {
          requirementsComplete = false;
          console.log("   📝 Queued Safe transaction to pause global minting.");
        }
      } else {
        console.log("✅ Global dUSD minting already paused.");
      }

      if (!(await redeemer.paused())) {
        console.log("⏸️ Pausing global dUSD redemption...");
        const safeTxData = redeemer.interface.encodeFunctionData("pauseRedemption");
        const complete = await governance.tryOrQueue(
          async () => {
            const tx = await redeemer.pauseRedemption();
            await tx.wait();
            console.log("   ➕ Global redemption paused on RedeemerV2.");
          },
          () => ({
            to: redeemerAddress,
            value: "0",
            data: safeTxData,
          }),
        );

        if (!complete) {
          requirementsComplete = false;
          console.log("   📝 Queued Safe transaction to pause global redemption.");
        }
      } else {
        console.log("✅ Global dUSD redemption already paused.");
      }
    }
  }

  const batchDescription = "Pause key operations for Trevee unwind (zero borrow + pause dUSD mint/redeem)";
  const flushed = await governance.flush(batchDescription);

  if (!flushed) {
    throw new Error("Failed to create Safe batch for Trevee unwind operations.");
  }

  console.log(`📬 Safe batch prepared: ${batchDescription}`);
  return requirementsComplete;
};

func.tags = ["trevee-unwind", "pause-key-operations"];
func.runAtTheEnd = true;
func.id = "pause-key-operations-trevee-unwind";

export default func;
