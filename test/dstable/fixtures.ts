import hre, { deployments } from "hardhat";

import {
  DS_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_ISSUER_V2_CONTRACT_ID,
  DS_REDEEMER_CONTRACT_ID,
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_V2_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../typescript/token/utils";

export interface DStableFixtureConfig {
  symbol: "dUSD" | "dS";
  issuerContractId: string;
  redeemerContractId: string;
  collateralVaultContractId: string;
  amoManagerId: string;
  oracleAggregatorId: string;
  peggedCollaterals: string[];
  yieldBearingCollaterals: string[];
}

// Create a fixture factory for any dstable based on its configuration
export const createDStableFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["local-setup", config.symbol.toLowerCase()]); // Include local-setup to use the mock Oracle
    // Ensure IssuerV2 and RedeemerV2 are deployed and roles migrated to mirror mainnet
    await deployments.fixture(["setup-issuerv2", "setup-redeemerv2"]);
  });
};

// Create an AMO fixture factory for any dstable based on its configuration
export const createDStableAmoFixture = (config: DStableFixtureConfig) => {
  return deployments.createFixture(async ({ deployments }) => {
    const standaloneMinimalFixture = createDStableFixture(config);
    await standaloneMinimalFixture(deployments);

    const { deployer } = await hre.getNamedAccounts();
    const { address: amoManagerAddress } = await deployments.get(
      config.amoManagerId,
    );

    const { tokenInfo: dstableInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      config.symbol,
    );

    const { address: oracleAggregatorAddress } = await deployments.get(
      config.oracleAggregatorId,
    );

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
  issuerContractId: DUSD_ISSUER_V2_CONTRACT_ID,
  redeemerContractId: DUSD_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: DUSD_AMO_MANAGER_ID,
  oracleAggregatorId: USD_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["frxUSD", "USDC", "USDS"], // USDC is interesting due to 6 decimals
  yieldBearingCollaterals: ["sfrxUSD", "sUSDS"],
};

export const DS_CONFIG: DStableFixtureConfig = {
  symbol: "dS",
  issuerContractId: DS_ISSUER_V2_CONTRACT_ID,
  redeemerContractId: DS_REDEEMER_CONTRACT_ID,
  collateralVaultContractId: DS_COLLATERAL_VAULT_CONTRACT_ID,
  amoManagerId: DS_AMO_MANAGER_ID,
  oracleAggregatorId: S_ORACLE_AGGREGATOR_ID,
  peggedCollaterals: ["wS"],
  yieldBearingCollaterals: ["wOS", "stS"],
};
