import { ZeroAddress } from "ethers";
import hre, { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  ORACLE_AGGREGATOR_ID,
  DUSD_AMO_MANAGER_ID,
} from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";

export const standaloneMinimalFixture = deployments.createFixture(
  async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["dusd", "local-setup"]); // Include local-setup to use the mock Oracle

    // The mock Oracle setup is now handled by the local-setup fixture
    // No need to deploy or configure the mock Oracle here
  }
);

export const standaloneAmoFixture = deployments.createFixture(
  async ({ deployments }) => {
    await standaloneMinimalFixture(deployments);

    const { deployer } = await hre.getNamedAccounts();
    const { address: amoManagerAddress } =
      await deployments.get(DUSD_AMO_MANAGER_ID);
    const { tokenInfo: dusdInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "dUSD"
    );
    const { address: oracleAggregatorAddress } =
      await deployments.get(ORACLE_AGGREGATOR_ID);

    // Deploy MockAmoVault using standard deployment
    await hre.deployments.deploy("MockAmoVault", {
      from: deployer,
      args: [
        dusdInfo.address,
        amoManagerAddress,
        deployer,
        deployer,
        deployer,
        oracleAggregatorAddress,
      ],
      autoMine: true,
      log: false,
    });
  }
);
