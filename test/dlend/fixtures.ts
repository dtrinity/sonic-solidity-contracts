import { deployments } from "hardhat";
import hre, { ethers } from "hardhat";
import {
  Pool,
  AToken,
  StableDebtToken,
  VariableDebtToken,
  AaveProtocolDataProvider,
  TestERC20,
  ACLManager,
  PoolAddressesProvider,
  PoolConfigurator,
  IPoolDataProvider,
  ERC20StablecoinUpgradeable,
  Issuer,
  OracleAggregator,
} from "../../typechain-types";
import {
  POOL_PROXY_ID,
  POOL_DATA_PROVIDER_ID,
  DUSD_TOKEN_ID,
  DS_TOKEN_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DS_ISSUER_CONTRACT_ID,
  USD_ORACLE_AGGREGATOR_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Return type for dLEND test fixtures
 */
export interface DLendFixtureResult {
  contracts: {
    pool: Pool;
    dataProvider: AaveProtocolDataProvider;
    aTokens: { [asset: string]: AToken };
    stableDebtTokens: { [asset: string]: StableDebtToken };
    variableDebtTokens: { [asset: string]: VariableDebtToken };
  };
  assets: {
    [asset: string]: {
      address: string;
      aToken: string;
      stableDebtToken: string;
      variableDebtToken: string;
      borrowingEnabled: boolean;
      ltv: BigInt;
      liquidationThreshold: BigInt;
      symbol?: string;
      isDStable?: boolean;
    };
  };
  dStables: {
    dUSD: string;
    dS: string;
  };
}

/**
 * The actual fixture function that sets up the dLEND test environment
 */
async function setupDLendFixture(): Promise<DLendFixtureResult> {
  // Deploy all contracts
  await deployments.fixture(); // Start from a fresh deployment
  // Ensure all necessary setup scripts run, including oracle configurations
  await deployments.fixture([
    "local-setup",
    "dlend",
    "dlend-prepare",
    "oracles",
    "usd-oracle", // Ensure USD oracle pointing runs
  ]);

  const { deployer } = await hre.getNamedAccounts();

  // Get dStable token addresses first
  const { address: dUsdAddress } = await deployments.get(DUSD_TOKEN_ID);
  const { address: dSAddress } = await deployments.get(DS_TOKEN_ID);
  console.log("dUSD address:", dUsdAddress);
  console.log("dS address:", dSAddress);

  // Get the Pool contract
  const { address: poolAddress } = await deployments.get(POOL_PROXY_ID);
  const pool = await hre.ethers.getContractAt("Pool", poolAddress);

  // Get the PoolDataProvider contract
  const { address: dataProviderAddress } = await deployments.get(
    POOL_DATA_PROVIDER_ID
  );
  const dataProvider = await hre.ethers.getContractAt(
    "AaveProtocolDataProvider",
    dataProviderAddress
  );

  // Get all reserves
  const reservesList = await pool.getReservesList();
  console.log("Available reserves:", reservesList);

  // Initialize result objects
  const aTokens: { [asset: string]: AToken } = {};
  const stableDebtTokens: { [asset: string]: StableDebtToken } = {};
  const variableDebtTokens: { [asset: string]: VariableDebtToken } = {};
  const assets: DLendFixtureResult["assets"] = {};

  // Get contract instances and configuration for each reserve
  for (const asset of reservesList) {
    const reserveData = await pool.getReserveData(asset);
    const config = await dataProvider.getReserveConfigurationData(asset);

    // Try to get token symbol for debugging
    let symbol = "";
    try {
      const tokenContract = await hre.ethers.getContractAt("TestERC20", asset);
      symbol = await tokenContract.symbol();
    } catch (e) {
      symbol = "unknown";
    }

    console.log(`Reserve ${asset} (${symbol}):`, {
      borrowingEnabled: config.borrowingEnabled,
      ltv: config.ltv.toString(),
      liquidationThreshold: config.liquidationThreshold.toString(),
    });

    // Get token contracts
    aTokens[asset] = await hre.ethers.getContractAt(
      "AToken",
      reserveData.aTokenAddress
    );
    stableDebtTokens[asset] = await hre.ethers.getContractAt(
      "StableDebtToken",
      reserveData.stableDebtTokenAddress
    );
    variableDebtTokens[asset] = await hre.ethers.getContractAt(
      "VariableDebtToken",
      reserveData.variableDebtTokenAddress
    );

    // Store asset configuration
    assets[asset] = {
      address: asset,
      aToken: reserveData.aTokenAddress,
      stableDebtToken: reserveData.stableDebtTokenAddress,
      variableDebtToken: reserveData.variableDebtTokenAddress,
      borrowingEnabled: config.borrowingEnabled,
      ltv: config.ltv,
      liquidationThreshold: config.liquidationThreshold,
      symbol,
      isDStable: asset === dUsdAddress || asset === dSAddress,
    };
  }

  // Ensure dStables are in the reserves
  if (!reservesList.includes(dUsdAddress)) {
    console.warn("dUSD not found in reserves:", dUsdAddress);
  }
  if (!reservesList.includes(dSAddress)) {
    console.warn("dS not found in reserves:", dSAddress);
  }

  // Mint dUSD and dS through their respective Issuers
  // First mint dUSD
  const dusdIssuerAddress = (await hre.deployments.get(DUSD_ISSUER_CONTRACT_ID))
    .address;
  const dusdIssuer = await hre.ethers.getContractAt(
    "Issuer",
    dusdIssuerAddress
  );
  const usdOracleAddress = (await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID))
    .address;
  const usdOracle = await hre.ethers.getContractAt(
    "OracleAggregator",
    usdOracleAddress
  );

  // Get collateral token (sfrxUSD) for dUSD
  const { contract: usdCollateralToken, tokenInfo: usdCollateralInfo } =
    await getTokenContractForSymbol(hre, deployer, "sfrxUSD");
  const { contract: dUsdToken, tokenInfo: dUsdInfo } =
    await getTokenContractForSymbol(hre, deployer, "dUSD");

  // Mint dUSD
  const usdCollateralAmount = ethers.parseUnits(
    "10000",
    usdCollateralInfo.decimals
  );
  const usdCollateralPrice = await usdOracle.getAssetPrice(
    usdCollateralInfo.address
  );
  const dUsdPrice = await usdOracle.getAssetPrice(dUsdInfo.address);
  const usdBaseValue =
    (usdCollateralAmount * usdCollateralPrice) /
    BigInt(10 ** usdCollateralInfo.decimals);
  const expectedDusdAmount =
    (usdBaseValue * BigInt(10 ** dUsdInfo.decimals)) / dUsdPrice;

  await usdCollateralToken.approve(
    await dusdIssuer.getAddress(),
    usdCollateralAmount
  );
  await dusdIssuer.issue(
    usdCollateralAmount,
    usdCollateralInfo.address,
    expectedDusdAmount
  );

  // Supply some initial dUSD liquidity from deployer
  const initialDusdLiquidity = expectedDusdAmount / 2n; // Supply half of the minted amount
  console.log(
    `Supplying initial dUSD liquidity: ${ethers.formatUnits(initialDusdLiquidity, dUsdInfo.decimals)} dUSD`
  );
  await dUsdToken.approve(poolAddress, initialDusdLiquidity);
  await pool.supply(dUsdAddress, initialDusdLiquidity, deployer, 0);

  // Then mint dS
  const dsIssuerAddress = (await hre.deployments.get(DS_ISSUER_CONTRACT_ID))
    .address;
  const dsIssuer = await hre.ethers.getContractAt("Issuer", dsIssuerAddress);
  const sOracleAddress = (await hre.deployments.get(S_ORACLE_AGGREGATOR_ID))
    .address;
  const sOracle = await hre.ethers.getContractAt(
    "OracleAggregator",
    sOracleAddress
  );

  // Get collateral token (stS) for dS
  const { contract: sCollateralToken, tokenInfo: sCollateralInfo } =
    await getTokenContractForSymbol(hre, deployer, "stS");
  const { contract: dSToken, tokenInfo: dSInfo } =
    await getTokenContractForSymbol(hre, deployer, "dS");

  // Mint dS
  const sCollateralAmount = ethers.parseUnits(
    "10000",
    sCollateralInfo.decimals
  );
  const sCollateralPrice = await sOracle.getAssetPrice(sCollateralInfo.address);
  const dSPrice = await sOracle.getAssetPrice(dSInfo.address);
  const sBaseValue =
    (sCollateralAmount * sCollateralPrice) /
    BigInt(10 ** sCollateralInfo.decimals);
  const expectedDsAmount =
    (sBaseValue * BigInt(10 ** dSInfo.decimals)) / dSPrice;

  await sCollateralToken.approve(
    await dsIssuer.getAddress(),
    sCollateralAmount
  );
  await dsIssuer.issue(
    sCollateralAmount,
    sCollateralInfo.address,
    expectedDsAmount
  );

  return {
    contracts: {
      pool,
      dataProvider,
      aTokens,
      stableDebtTokens,
      variableDebtTokens,
    },
    assets,
    dStables: {
      dUSD: dUsdAddress,
      dS: dSAddress,
    },
  };
}

/**
 * Creates a fixture for testing dLEND functionality
 */
export const dLendFixture = deployments.createFixture(setupDLendFixture);
