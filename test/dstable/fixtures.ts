import { ZeroAddress } from "ethers";
import hre, { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  ORACLE_AGGREGATOR_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_AMO_MANAGER_ID,
  DS_ISSUER_CONTRACT_ID,
  DS_REDEEMER_CONTRACT_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_AMO_MANAGER_ID,
} from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { setupOraclesForTesting } from "./setupOracles";

export interface DStableFixtureConfig {
  symbol: string;
  issuerContractId: string;
  redeemerContractId: string;
  collateralVaultContractId: string;
  amoManagerId: string;
  collateralSymbols: string[];
}

// Create a fixture factory for any dstable based on its configuration
export const createDStableFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture([config.symbol.toLowerCase(), "local-setup"]); // Include local-setup to use the mock Oracle

    // Ensure oracles are properly configured - this fixes ProxyNotSet errors
    await setupOraclesForTesting();
  });
};

// Create an AMO fixture factory for any dstable based on its configuration
export const createDStableAmoFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    const standaloneMinimalFixture = createDStableFixture(config);
    await standaloneMinimalFixture(deployments);

    const { deployer } = await hre.getNamedAccounts();
    const { address: amoManagerAddress } = await deployments.get(
      config.amoManagerId
    );

    const { tokenInfo: dstableInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      config.symbol
    );

    const { address: oracleAggregatorAddress } =
      await deployments.get(ORACLE_AGGREGATOR_ID);

    // Deploy MockAmoVault using standard deployment
    await hre.deployments.deploy("MockAmoVault", {
      from: deployer,
      args: [
        dstableInfo.address,
        amoManagerAddress,
        deployer,
        deployer,
        deployer,
        oracleAggregatorAddress,
      ],
      autoMine: true,
      log: false,
    });
  });
};

// Predefined configurations
export const DUSD_CONFIG: DStableFixtureConfig = {
  symbol: "dUSD",
  issuerContractId: DUSD_ISSUER_CONTRACT_ID,
  redeemerContractId: DUSD_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: DUSD_AMO_MANAGER_ID,
  collateralSymbols: ["frxUSD", "USDC"],
};

export const DS_CONFIG: DStableFixtureConfig = {
  symbol: "dS",
  issuerContractId: DS_ISSUER_CONTRACT_ID,
  redeemerContractId: DS_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DS_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: DS_AMO_MANAGER_ID,
  collateralSymbols: ["wS", "wOS", "stS"],
};
