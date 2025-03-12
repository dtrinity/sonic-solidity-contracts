import { HardhatRuntimeEnvironment } from "hardhat/types";

import { Config } from "../types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { ZeroAddress } from "ethers";

/**
 * Get the configuration for the network
 *
 * @param _hre - Hardhat Runtime Environment
 * @returns The configuration for the network
 */
export async function getConfig(
  _hre: HardhatRuntimeEnvironment
): Promise<Config> {
  // Token info will only be populated after their deployment
  const dUSDDeployment = await _hre.deployments.getOrNull("dUSD");
  const dSDeployment = await _hre.deployments.getOrNull("dS");
  const USDCDeployment = await _hre.deployments.getOrNull("USDC");
  const USDSDeployment = await _hre.deployments.getOrNull("USDS");
  const sUSDSDeployment = await _hre.deployments.getOrNull("sUSDS");
  const frxUSDDeployment = await _hre.deployments.getOrNull("frxUSD");
  const sfrxUSDDeployment = await _hre.deployments.getOrNull("sfrxUSD");
  const wSTokenDeployment = await _hre.deployments.getOrNull("wS");
  const wOSTokenDeployment = await _hre.deployments.getOrNull("wOS");
  const stSTokenDeployment = await _hre.deployments.getOrNull("stS");

  // Get mock oracle deployments
  const mockOracleDeploymentsData = await _hre.deployments.getOrNull(
    "MockOracleDeployments"
  );
  const mockOracleDeployments =
    (mockOracleDeploymentsData?.linkedData as Record<string, string>) || {};

  return {
    MOCK_ONLY: {
      tokens: {
        USDC: {
          name: "USD Coin",
          address: USDCDeployment?.address,
          decimals: 6,
          initialSupply: 1e6,
        },
        USDS: {
          name: "USDS Stablecoin",
          address: USDSDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sUSDS: {
          name: "Savings USDS",
          address: sUSDSDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        frxUSD: {
          name: "Frax USD",
          address: frxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        sfrxUSD: {
          name: "Staked Frax USD",
          address: sfrxUSDDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        wS: {
          name: "Wrapped S",
          address: wSTokenDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        wOS: {
          name: "Wrapped Origin S",
          address: wOSTokenDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
        stS: {
          name: "Staked S",
          address: stSTokenDeployment?.address,
          decimals: 18,
          initialSupply: 1e6,
        },
      },
    },
    tokenAddresses: {
      dUSD: emptyStringIfUndefined(dUSDDeployment?.address),
      dS: emptyStringIfUndefined(dSDeployment?.address),
      wS: emptyStringIfUndefined(wSTokenDeployment?.address),
    },
    oracleAggregator: {
      hardDStablePeg: 10 ** ORACLE_AGGREGATOR_PRICE_DECIMALS,
      priceDecimals: ORACLE_AGGREGATOR_PRICE_DECIMALS,
      api3OracleAssets: {
        plainApi3OracleWrappers: {
          // For local testing, we'll use the individual mock API3 oracles for each token
          // The keys are token addresses, the values are mock oracle addresses
          ...Object.entries(mockOracleDeployments).reduce(
            (acc, [tokenAddress, oracleAddress]) => {
              if (tokenAddress && oracleAddress) {
                acc[tokenAddress] = oracleAddress;
              }
              return acc;
            },
            {} as Record<string, string>
          ),
        },
        api3OracleWrappersWithThresholding: {},
        compositeApi3OracleWrappersWithThresholding: {},
      },
    },
  };
}

function emptyStringIfUndefined(value: string | undefined): string {
  return value ?? "";
}
