import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { rateStrategyZeroBorrow } from "../../config/dlend/interest-rate-strategies";
import { DUSD_ISSUER_V2_CONTRACT_ID, DUSD_REDEEMER_V2_CONTRACT_ID, POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import { GovernanceExecutor } from "../../typescript/hardhat/governance";

const STRATEGY_DEPLOYMENT_ID = `ReserveStrategy-${rateStrategyZeroBorrow.name}`;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment): Promise<boolean> {
  const { deployments, ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const config = await getConfig(hre);

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
  });
  const zeroStrategyAddress = zeroStrategyDeployment.address.toLowerCase();

  let requirementsComplete = true;

  const reserveTargets: { symbol: string; address?: string }[] = [
    { symbol: "dUSD", address: config.tokenAddresses.dUSD },
    { symbol: "dS", address: config.tokenAddresses.dS },
  ];

  for (const target of reserveTargets) {
    const { symbol, address } = target;

    if (!address || address === ZeroAddress) {
      console.warn(`⚠️ Skipping ${symbol} reserve strategy update because address is not configured.`);
      continue;
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
    console.warn("⚠️ No dUSD collateral addresses configured; skipping mint/redeem pause enforcement.");
  } else {
    const issuerDeployment = await deployments.getOrNull(DUSD_ISSUER_V2_CONTRACT_ID);
    const redeemerDeployment = await deployments.getOrNull(DUSD_REDEEMER_V2_CONTRACT_ID);

    if (!issuerDeployment || !redeemerDeployment) {
      console.warn("⚠️ Missing IssuerV2 or RedeemerV2 deployments for dUSD; skipping mint/redeem pause enforcement.");
    } else {
      const issuer = await ethers.getContractAt("IssuerV2", issuerDeployment.address, deployerSigner);
      const redeemer = await ethers.getContractAt("RedeemerV2", redeemerDeployment.address, deployerSigner);
      const collateralVault = await ethers.getContractAt("CollateralVault", await issuer.collateralVault(), deployerSigner);

      for (const collateral of dUsdCollaterals) {
        const supported = await collateralVault.isCollateralSupported(collateral);

        if (!supported) {
          console.warn(`⚠️ Collateral ${collateral} is not supported by the vault; skipping.`);
          continue;
        }

        const mintPaused = await issuer.assetMintingPaused(collateral);

        if (mintPaused) {
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
              to: issuerDeployment.address,
              value: "0",
              data: safeTxData,
            }),
          );

          if (!complete) {
            requirementsComplete = false;
            console.log(`   📝 Queued Safe transaction to pause minting for ${collateral}.`);
          }
        }

        const redemptionPaused = await redeemer.assetRedemptionPaused(collateral);
        if (redemptionPaused) {
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
              to: redeemerDeployment.address,
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
            to: issuerDeployment.address,
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
            to: redeemerDeployment.address,
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
