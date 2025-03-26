import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ZeroAddress } from "ethers";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER_ID,
  TREASURY_PROXY_ID,
  ATOKEN_IMPL_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../../typescript/deploy-ids";
import { getConfig } from "../../../config/config";
import { chunk } from "../../../utils/lending/utils";

interface IERC20Extended {
  name(): Promise<string>;
  symbol(): Promise<string>;
  decimals(): Promise<number>;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { lendingDeployer } = await hre.getNamedAccounts();
  const deployer = await hre.ethers.getSigner(lendingDeployer);

  const config = await getConfig(hre);
  const { rateStrategies, reservesConfig } = config.lending;

  const addressProviderDeployedResult = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  // Deploy Rate Strategies
  for (const strategy of rateStrategies) {
    const args = [
      addressProviderDeployedResult.address,
      strategy.optimalUsageRatio,
      strategy.baseVariableBorrowRate,
      strategy.variableRateSlope1,
      strategy.variableRateSlope2,
      strategy.stableRateSlope1,
      strategy.stableRateSlope2,
      strategy.baseStableRateOffset,
      strategy.stableRateExcessOffset,
      strategy.optimalStableToTotalDebtRatio,
    ];

    await hre.deployments.deploy(`ReserveStrategy-${strategy.name}`, {
      contract: "DefaultReserveInterestRateStrategy",
      from: deployer.address,
      args,
      log: true,
    });
  }

  // Get treasury address
  const { address: treasuryAddress } =
    await hre.deployments.get(TREASURY_PROXY_ID);

  // Get token implementations
  const aTokenImplementationAddress = (
    await hre.deployments.get(ATOKEN_IMPL_ID)
  ).address;
  const stableDebtTokenImplementationAddress = (
    await hre.deployments.get(STABLE_DEBT_TOKEN_IMPL_ID)
  ).address;
  const variableDebtTokenImplementationAddress = (
    await hre.deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID)
  ).address;

  // Get pool configurator
  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressProviderDeployedResult.address,
    deployer
  );

  const poolConfiguratorAddress =
    await addressesProviderContract.getPoolConfigurator();
  const poolConfiguratorContract = await hre.ethers.getContractAt(
    "PoolConfigurator",
    poolConfiguratorAddress,
    deployer
  );

  // Initialize reserves
  const reserveTokens: string[] = [];
  const reserveSymbols: string[] = [];
  const initInputParams: {
    aTokenImpl: string;
    stableDebtTokenImpl: string;
    variableDebtTokenImpl: string;
    underlyingAssetDecimals: string;
    interestRateStrategyAddress: string;
    underlyingAsset: string;
    treasury: string;
    incentivesController: string;
    underlyingAssetName: string;
    aTokenName: string;
    aTokenSymbol: string;
    variableDebtTokenName: string;
    variableDebtTokenSymbol: string;
    stableDebtTokenName: string;
    stableDebtTokenSymbol: string;
    params: string;
  }[] = [];

  // Get pool contract
  const poolAddress = await addressesProviderContract.getPool();
  const poolContract = await hre.ethers.getContractAt("Pool", poolAddress);

  // Process each reserve
  for (const [symbol, params] of Object.entries(reservesConfig)) {
    const tokenAddress =
      config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];
    if (!tokenAddress) {
      console.log(
        `- Skipping init of ${symbol} due token address is not set at markets config`
      );
      continue;
    }

    const poolReserve = await poolContract.getReserveData(tokenAddress);
    if (poolReserve.aTokenAddress !== ZeroAddress) {
      console.log(
        `- Skipping init of ${symbol} due reserve is already initialized`
      );
      continue;
    }

    const strategyAddress = (
      await hre.deployments.get(`ReserveStrategy-${params.strategy.name}`)
    ).address;

    const tokenContract = (await hre.ethers.getContractAt(
      "IERC20Extended",
      tokenAddress
    )) as unknown as IERC20Extended;
    const tokenName = await tokenContract.name();
    const tokenSymbol = await tokenContract.symbol();
    const tokenDecimals = await tokenContract.decimals();

    reserveTokens.push(tokenAddress);
    reserveSymbols.push(symbol);

    initInputParams.push({
      aTokenImpl: aTokenImplementationAddress,
      stableDebtTokenImpl: stableDebtTokenImplementationAddress,
      variableDebtTokenImpl: variableDebtTokenImplementationAddress,
      underlyingAssetDecimals: tokenDecimals.toString(),
      interestRateStrategyAddress: strategyAddress,
      underlyingAsset: tokenAddress,
      treasury: treasuryAddress,
      incentivesController: ZeroAddress,
      underlyingAssetName: tokenName,
      aTokenName: `Sonic ${tokenName}`,
      aTokenSymbol: `s${tokenSymbol}`,
      variableDebtTokenName: `Sonic Variable Debt ${tokenSymbol}`,
      variableDebtTokenSymbol: `variableDebt${tokenSymbol}`,
      stableDebtTokenName: `Sonic Stable Debt ${tokenSymbol}`,
      stableDebtTokenSymbol: `stableDebt${tokenSymbol}`,
      params: "0x",
    });
  }

  // Initialize reserves in chunks
  const initChunks = 3;
  const chunkedSymbols = chunk(reserveSymbols, initChunks);
  const chunkedInitInputParams = chunk(initInputParams, initChunks);

  console.log(
    `- Reserves initialization in ${chunkedInitInputParams.length} txs`
  );

  for (
    let chunkIndex = 0;
    chunkIndex < chunkedInitInputParams.length;
    chunkIndex++
  ) {
    const tx = await poolConfiguratorContract.initReserves(
      chunkedInitInputParams[chunkIndex]
    );
    console.log(
      `  - Reserve ready for: ${chunkedSymbols[chunkIndex].join(", ")}`
    );
    console.log(`    * TxHash: ${tx.hash}`);
  }

  // Configure reserves
  console.log(`\nConfiguring reserves`);
  for (const [symbol, params] of Object.entries(reservesConfig)) {
    const tokenAddress =
      config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];
    if (!tokenAddress) {
      console.log(`- Skipping config of ${symbol} due missing token address`);
      continue;
    }

    console.log(`- Configuring reserve ${symbol}`);
    const tx = await poolConfiguratorContract.configureReserveAsCollateral(
      tokenAddress,
      params.baseLTVAsCollateral,
      params.liquidationThreshold,
      params.liquidationBonus
    );
    console.log(`  * TxHash: ${tx.hash}`);

    if (params.borrowingEnabled) {
      console.log(`  * Enabling borrowing on ${symbol}`);
      const tx = await (
        poolConfiguratorContract as any
      ).enableBorrowingOnReserve(tokenAddress, params.stableBorrowRateEnabled);
      console.log(`    * TxHash: ${tx.hash}`);
    }

    console.log(
      `  * Setting reserve factor for ${symbol} to ${params.reserveFactor}`
    );
    const reserveFactorTx = await poolConfiguratorContract.setReserveFactor(
      tokenAddress,
      params.reserveFactor
    );
    console.log(`    * TxHash: ${reserveFactorTx.hash}`);

    if (params.borrowCap !== "0") {
      console.log(
        `  * Setting borrow cap for ${symbol} to ${params.borrowCap}`
      );
      const borrowCapTx = await poolConfiguratorContract.setBorrowCap(
        tokenAddress,
        params.borrowCap
      );
      console.log(`    * TxHash: ${borrowCapTx.hash}`);
    }

    if (params.supplyCap !== "0") {
      console.log(
        `  * Setting supply cap for ${symbol} to ${params.supplyCap}`
      );
      const supplyCapTx = await poolConfiguratorContract.setSupplyCap(
        tokenAddress,
        params.supplyCap
      );
      console.log(`    * TxHash: ${supplyCapTx.hash}`);
    }
  }

  // Save pool tokens
  const dataProvider = await hre.deployments.get(POOL_DATA_PROVIDER_ID);
  const poolDataProviderContract = await hre.ethers.getContractAt(
    "AaveProtocolDataProvider",
    dataProvider.address
  );

  for (const [symbol, tokenAddress] of Object.entries(config.tokenAddresses)) {
    if (!tokenAddress) continue;

    const tokenData =
      await poolDataProviderContract.getReserveTokensAddresses(tokenAddress);

    await hre.deployments.save(`${symbol}AToken`, {
      abi: (await hre.deployments.get(ATOKEN_IMPL_ID)).abi,
      address: tokenData.aTokenAddress,
    });

    await hre.deployments.save(`${symbol}StableDebtToken`, {
      abi: (await hre.deployments.get(STABLE_DEBT_TOKEN_IMPL_ID)).abi,
      address: tokenData.stableDebtTokenAddress,
    });

    await hre.deployments.save(`${symbol}VariableDebtToken`, {
      abi: (await hre.deployments.get(VARIABLE_DEBT_TOKEN_IMPL_ID)).abi,
      address: tokenData.variableDebtTokenAddress,
    });
  }

  return true;
};

func.id = "init_reserves";
func.tags = ["market", "reserves"];
func.dependencies = [
  "addresses-provider",
  "pool",
  "pool-configurator",
  "tokens",
  "oracles",
];

export default func;
