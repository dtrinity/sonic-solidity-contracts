import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import {
  ATOKEN_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER_ID,
  RESERVES_SETUP_HELPER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  TREASURY_PROXY_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../../typescript/deploy-ids";
import { chunk } from "../../../typescript/dlend/helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  const config = await getConfig(hre);
  const { rateStrategies, reservesConfig } = config.dLend;

  const addressProviderDeployedResult = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID,
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
      from: deployer,
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
    signer,
  );

  // Add debug logs for roles
  const aclManagerAddress = await addressesProviderContract.getACLManager();
  console.log("ACL Manager address:", aclManagerAddress);

  const aclManager = await hre.ethers.getContractAt(
    "ACLManager",
    aclManagerAddress,
    signer,
  );

  const poolConfiguratorAddress =
    await addressesProviderContract.getPoolConfigurator();
  const poolConfiguratorContract = await hre.ethers.getContractAt(
    "PoolConfigurator",
    poolConfiguratorAddress,
    signer,
  );

  // Initialize reserves
  const reserveTokens: string[] = [];
  const reserveSymbols: string[] = [];
  const initInputParams: {
    aTokenImpl: string;
    stableDebtTokenImpl: string;
    variableDebtTokenImpl: string;
    underlyingAssetDecimals: number;
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
        `- Skipping init of ${symbol} due token address is not set at markets config`,
      );
      continue;
    }

    const poolReserve = await poolContract.getReserveData(tokenAddress);

    if (poolReserve.aTokenAddress !== ZeroAddress) {
      console.log(
        `- Skipping init of ${symbol} due reserve is already initialized`,
      );
      continue;
    }

    const strategyAddress = (
      await hre.deployments.get(`ReserveStrategy-${params.strategy.name}`)
    ).address;

    const tokenContract = await hre.ethers.getContractAt(
      "IERC20Detailed",
      tokenAddress,
    );
    const tokenName = await tokenContract.name();
    const tokenSymbol = await tokenContract.symbol();
    const tokenDecimals = Number(await tokenContract.decimals());

    reserveTokens.push(tokenAddress);
    reserveSymbols.push(symbol);

    initInputParams.push({
      aTokenImpl: aTokenImplementationAddress,
      stableDebtTokenImpl: stableDebtTokenImplementationAddress,
      variableDebtTokenImpl: variableDebtTokenImplementationAddress,
      underlyingAssetDecimals: tokenDecimals,
      interestRateStrategyAddress: strategyAddress,
      underlyingAsset: tokenAddress,
      treasury: treasuryAddress,
      incentivesController: ZeroAddress,
      underlyingAssetName: tokenName,
      aTokenName: `dLEND ${tokenName}`,
      aTokenSymbol: `dLEND-${tokenSymbol}`,
      variableDebtTokenName: `dLEND Variable Debt ${tokenSymbol}`,
      variableDebtTokenSymbol: `dLEND-variableDebt-${tokenSymbol}`,
      stableDebtTokenName: `dLEND Stable Debt ${tokenSymbol}`,
      stableDebtTokenSymbol: `dLEND-stableDebt-${tokenSymbol}`,
      params: "0x10",
    });
  }

  // Initialize reserves in chunks
  const initChunks = 3;
  const _chunkedSymbols = chunk(reserveSymbols, initChunks);
  const chunkedInitInputParams = chunk(initInputParams, initChunks);

  for (
    let chunkIndex = 0;
    chunkIndex < chunkedInitInputParams.length;
    chunkIndex++
  ) {
    const _tx = await poolConfiguratorContract.initReserves(
      chunkedInitInputParams[chunkIndex],
    );
  }

  // Get reserves setup helper for configuration
  const reservesSetupHelper = await hre.ethers.getContractAt(
    "ReservesSetupHelper",
    (await hre.deployments.get(RESERVES_SETUP_HELPER_ID)).address,
    signer,
  );

  // Add ReservesSetupHelper as a risk admin temporarily
  const reserveHelperAddress = await reservesSetupHelper.getAddress();
  await aclManager.addRiskAdmin(reserveHelperAddress);

  // Configure reserves using the helper
  for (const [symbol, params] of Object.entries(reservesConfig)) {
    const tokenAddress =
      config.tokenAddresses[symbol as keyof typeof config.tokenAddresses];

    if (!tokenAddress) {
      console.log(`- Skipping config of ${symbol} due missing token address`);
      continue;
    }

    const configInputParams = {
      asset: tokenAddress,
      baseLTV: params.baseLTVAsCollateral,
      liquidationThreshold: params.liquidationThreshold,
      liquidationBonus: params.liquidationBonus,
      reserveFactor: params.reserveFactor,
      borrowCap: params.borrowCap,
      supplyCap: params.supplyCap,
      stableBorrowingEnabled: params.stableBorrowRateEnabled,
      borrowingEnabled: params.borrowingEnabled,
      flashLoanEnabled: true,
    };

    const _configTx = await reservesSetupHelper.configureReserves(
      poolConfiguratorAddress,
      [configInputParams],
    );
  }

  // Remove ReservesSetupHelper from risk admins
  await aclManager.removeRiskAdmin(reserveHelperAddress);

  // Save pool tokens
  const dataProvider = await hre.deployments.get(POOL_DATA_PROVIDER_ID);
  const poolDataProviderContract = await hre.ethers.getContractAt(
    "AaveProtocolDataProvider",
    dataProvider.address,
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

    console.log(`Configured dLEND reserve: ${symbol}`);
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:init_reserves";
func.tags = ["dlend", "dlend-market"];
func.dependencies = [
  "dlend-core",
  "dlend-periphery-pre",
  "PoolAddressesProvider",
  "PoolConfigurator",
  "tokens_implementations",
];

export default func;
