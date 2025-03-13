import { deployments } from "hardhat";

/**
 * Basic fixture that sets up the oracle aggregator and mock oracles
 * The mock Oracle setup is handled by the local-setup fixture
 */
export const oracleAggregatorMinimalFixture = deployments.createFixture(
  async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["oracle-aggregator", "local-setup"]); // Include local-setup to use the mock Oracle
  }
);

/**
 * Fixture that sets up the USD oracle aggregator and mock oracles
 */
export const usdOracleAggregatorFixture = deployments.createFixture(
  async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["usd-oracle-aggregator", "local-setup"]); // Include local-setup to use the mock Oracle
  }
);

/**
 * Fixture that sets up the S oracle aggregator and mock oracles
 */
export const sOracleAggregatorFixture = deployments.createFixture(
  async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["s-oracle-aggregator", "local-setup"]); // Include local-setup to use the mock Oracle
  }
);
