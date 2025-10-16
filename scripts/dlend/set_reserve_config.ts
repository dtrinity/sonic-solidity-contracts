import { BigNumberish } from "ethers";
import hre, { ethers } from "hardhat";

import { POOL_ADDRESSES_PROVIDER_ID, POOL_CONFIGURATOR_PROXY_ID, RESERVES_SETUP_HELPER_ID } from "../../typescript/deploy-ids";
import { getConfig } from "../../config/config";
import { eContractid, IInterestRateStrategyParams, IReserveParams } from "../../config/dlend/types";
import { chunk } from "../../typescript/dlend/helpers";
import { rateStrategyDUSD } from "../../config/dlend/interest-rate-strategies";
import { strategyDUSD } from "../../config/dlend/reserves-params";

// const rateStrategyEncourageClose: IInterestRateStrategyParams = {
//   name: "rateStrategyEncourageClose",
//   optimalUsageRatio: ethers.parseUnits("0.5", 27).toString(),
//   baseVariableBorrowRate: ethers.parseUnits("0", 27).toString(),
//   variableRateSlope1: ethers.parseUnits("0.2", 27).toString(),
//   variableRateSlope2: ethers.parseUnits("1.5", 27).toString(),
//   stableRateSlope1: ethers.parseUnits("0", 27).toString(),
//   stableRateSlope2: ethers.parseUnits("0", 27).toString(),
//   baseStableRateOffset: ethers.parseUnits("0", 27).toString(),
//   stableRateExcessOffset: ethers.parseUnits("0", 27).toString(),
//   optimalStableToTotalDebtRatio: ethers.parseUnits("0", 27).toString(),
// };

// const strategyDisable: IReserveParams = {
//   strategy: rateStrategyEncourageClose,
//   baseLTVAsCollateral: "0", // Disable collateral
//   liquidationThreshold: "7500",
//   liquidationBonus: "10500",
//   liquidationProtocolFee: "7000",
//   borrowingEnabled: false,
//   stableBorrowRateEnabled: false,
//   flashLoanEnabled: true,
//   reserveDecimals: "18", // Don't forget to change this
//   aTokenImpl: eContractid.AToken,
//   reserveFactor: "1000",
//   supplyCap: "0",
//   borrowCap: "0",
//   debtCeiling: "0",
//   borrowableIsolation: false,
// };

const main = async (): Promise<void> => {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);
  const reservesAddresses = config.tokenAddresses;

  /* Set up rate strategies */

  const newRateStrategies: IInterestRateStrategyParams[] = [rateStrategyDUSD];
  const newReserveConfigs: { [symbol: string]: IReserveParams } = {
    dUSD: strategyDUSD,
  };

  const addressProviderDeployedResult = await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Deploy Rate Strategies
  for (const strategy in newRateStrategies) {
    const strategyData = newRateStrategies[strategy];
    const args = [
      addressProviderDeployedResult.address,
      strategyData.optimalUsageRatio,
      strategyData.baseVariableBorrowRate,
      strategyData.variableRateSlope1,
      strategyData.variableRateSlope2,
      strategyData.stableRateSlope1,
      strategyData.stableRateSlope2,
      strategyData.baseStableRateOffset,
      strategyData.stableRateExcessOffset,
      strategyData.optimalStableToTotalDebtRatio,
    ];
    await hre.deployments.deploy(`ReserveStrategy-${strategyData.name}`, {
      contract: "DefaultReserveInterestRateStrategy",
      from: deployer,
      args,
      log: true,
    });
  }

  // Deploy Reserves ATokens
  if (Object.keys(reservesAddresses).length == 0) {
    console.error("[WARNING] Skipping initialization. Empty asset list.");
    return;
  }

  const addressProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressProviderDeployedResult.address,
    await hre.ethers.getSigner(deployer),
  );

  const proxyDeployedResult = await hre.deployments.get(POOL_CONFIGURATOR_PROXY_ID);
  const configuratorContract = await hre.ethers.getContractAt(
    "PoolConfigurator",
    proxyDeployedResult.address,
    await hre.ethers.getSigner(deployer),
  );

  for (const reserve in newReserveConfigs) {
    const reserveData = newReserveConfigs[reserve];

    const { address: newReserveDeploymentAddress } = await hre.deployments.get(`ReserveStrategy-${reserveData.strategy.name}`);

    await configuratorContract.setReserveInterestRateStrategyAddress(reservesAddresses[reserve], newReserveDeploymentAddress);
  }

  /*  Set up reserve configs */

  const reservesSetupArtifact = await hre.deployments.get(RESERVES_SETUP_HELPER_ID);
  const reservesSetupHelper = await hre.ethers.getContractAt(
    "ReservesSetupHelper",
    reservesSetupArtifact.address,
    await hre.ethers.getSigner(deployer),
  );

  const tokens: string[] = [];
  const symbols: string[] = [];

  const inputParams: {
    asset: string;
    baseLTV: BigNumberish;
    liquidationThreshold: BigNumberish;
    liquidationBonus: BigNumberish;
    reserveFactor: BigNumberish;
    borrowCap: BigNumberish;
    supplyCap: BigNumberish;
    stableBorrowingEnabled: boolean;
    borrowingEnabled: boolean;
    flashLoanEnabled: boolean;
  }[] = [];

  for (const [
    assetSymbol,
    {
      baseLTVAsCollateral,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      borrowCap,
      supplyCap,
      stableBorrowRateEnabled,
      borrowingEnabled,
      flashLoanEnabled,
    },
  ] of Object.entries(newReserveConfigs) as [string, IReserveParams][]) {
    if (!reservesAddresses[assetSymbol]) {
      console.log(`- Skipping init of ${assetSymbol} due token address is not set at markets config`);
      continue;
    }

    if (baseLTVAsCollateral === "-1") {
      continue;
    }

    const assetAddressIndex = Object.keys(reservesAddresses).findIndex((value) => value === assetSymbol);
    const [, tokenAddress] = (Object.entries(reservesAddresses) as [string, string][])[assetAddressIndex];

    // Push data
    inputParams.push({
      asset: tokenAddress,
      baseLTV: baseLTVAsCollateral,
      liquidationThreshold,
      liquidationBonus,
      reserveFactor,
      borrowCap,
      supplyCap,
      stableBorrowingEnabled: stableBorrowRateEnabled,
      borrowingEnabled: borrowingEnabled,
      flashLoanEnabled: flashLoanEnabled,
    });

    tokens.push(tokenAddress);
    symbols.push(assetSymbol);
  }

  if (tokens.length) {
    // Set aTokenAndRatesDeployer as temporal admin
    const aclAdminAddress = await addressProviderContract.getACLAdmin();
    const aclAdmin = await hre.ethers.getSigner(aclAdminAddress);

    console.log(`------------------------`);
    console.log(`Add Risk Admin`);
    console.log(`  - Risk Admin: ${aclAdminAddress}`);
    let aclManager = await hre.ethers.getContractAt(
      "ACLManager",
      await addressProviderContract.getACLManager(),
      // deployer
    );
    const tx = await aclManager.addRiskAdmin(await reservesSetupHelper.getAddress());
    const receipt = await tx.wait();
    console.log(`  - TxHash : ${receipt?.hash}`);
    console.log(`  - From   : ${receipt?.from}`);
    console.log(`  - GasUsed: ${receipt?.gasUsed.toString()}`);
    console.log(`------------------------`);

    // Deploy init per chunks
    const enableChunks = 20;
    const chunkedSymbols = chunk(symbols, enableChunks);
    const chunkedInputParams = chunk(inputParams, enableChunks);
    const poolConfiguratorAddress = await addressProviderContract.getPoolConfigurator();

    console.log(`- Configure reserves in ${chunkedInputParams.length} txs`);

    for (let chunkIndex = 0; chunkIndex < chunkedInputParams.length; chunkIndex++) {
      console.log(`------------------------`);
      console.log(`Configure reserves chunk ${chunkIndex + 1}`);
      console.log(`  - Configurator: ${poolConfiguratorAddress}`);
      console.log(`  - Reserves    : ${chunkedSymbols[chunkIndex].join(", ")}`);
      const tx = await reservesSetupHelper.configureReserves(poolConfiguratorAddress, chunkedInputParams[chunkIndex]);
      const receipt = await tx.wait();
      console.log(`  - Tx hash: ${receipt?.hash}`);
      console.log(`  - From: ${receipt?.from}`);
      console.log(`  - Gas used: ${receipt?.gasUsed.toString()}`);
    }
    console.log(`------------------------`);

    // Remove ReservesSetupHelper from risk admins
    const reserveHelperAddress = await reservesSetupHelper.getAddress();
    console.log(`------------------------`);
    console.log(`Remove ReservesSetupHelper from risk admins`);
    console.log(`  - Risk Admin          : ${await aclAdmin.getAddress()}`);
    console.log(`  - ReservesSetupHelper : ${reserveHelperAddress}`);
    console.log(`  - ACL Manager         : ${await aclManager.getAddress()}`);
    aclManager = await hre.ethers.getContractAt(
      "ACLManager",
      await addressProviderContract.getACLManager(),
      await hre.ethers.getSigner(deployer),
    );
    const removeRiskAdminResponse = await aclManager.removeRiskAdmin(reserveHelperAddress);
    const removeRiskAdminReceipt = await removeRiskAdminResponse.wait();
    console.log(`  - TxHash : ${removeRiskAdminReceipt?.hash}`);
    console.log(`  - From   : ${removeRiskAdminReceipt?.from}`);
    console.log(`  - GasUsed: ${removeRiskAdminReceipt?.gasUsed.toString()}`);
    console.log(`------------------------`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
