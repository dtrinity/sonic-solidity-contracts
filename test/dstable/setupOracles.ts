// Test helper to ensure oracles are properly set up for dStable tokens
import hre from "hardhat";

import { ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../typescript/token/utils";

/**
 * Verifies and fixes oracle setup for dStable tokens in tests.
 * The initial oracle setup happens in deploy-mocks/02_mock_oracle_setup.ts,
 * but this function will fix any issues found, particularly for the dS token.
 */
export async function setupOraclesForTesting() {
  // Get deployer account
  const { deployer } = await hre.getNamedAccounts();

  // Get Oracle Aggregator
  const { address: oracleAggregatorAddress } =
    await hre.deployments.get(ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer)
  );

  try {
    // Check all tokens to verify they have oracles
    const tokensToCheck = ["dUSD", "dS", "wS", "wOS", "stS", "frxUSD", "USDC"];

    console.log("Verifying oracle setup for tokens:");

    // First get dS token info - we'll need this for fixing
    let dSInfo;
    try {
      const dSResult = await getTokenContractForSymbol(hre, deployer, "dS");
      dSInfo = dSResult.tokenInfo;
    } catch (e) {
      console.log("Could not get dS token info, it may not exist yet");
    }

    // Special handling for dS token to fix proxy issues
    if (dSInfo) {
      const dSOracleAddress = await oracleAggregator.assetOracles(
        dSInfo.address
      );
      console.log(`✓ Verified oracle for dS: ${dSOracleAddress}`);

      if (dSOracleAddress !== "0x0000000000000000000000000000000000000000") {
        // Get the API3Wrapper contract
        const api3Wrapper = await hre.ethers.getContractAt(
          "API3Wrapper",
          dSOracleAddress,
          await hre.ethers.getSigner(deployer)
        );

        // Check if the proxy is set
        try {
          const dSProxy = await api3Wrapper.assetToProxy(dSInfo.address);

          if (dSProxy === "0x0000000000000000000000000000000000000000") {
            console.log(
              `  - Issue detected: Proxy not set for dS in API3Wrapper. Will fix...`
            );

            // Find a working proxy from another token (like wS)
            try {
              const { tokenInfo: wSInfo } = await getTokenContractForSymbol(
                hre,
                deployer,
                "wS"
              );

              const wSProxy = await api3Wrapper.assetToProxy(wSInfo.address);

              if (wSProxy !== "0x0000000000000000000000000000000000000000") {
                // Deploy a new MockAPI3OracleAlwaysAlive specifically for dS
                const mockAPI3ServerV1 =
                  await hre.deployments.get("MockAPI3ServerV1");
                const mockDSOracleName = `MockAPI3Oracle_dS_${Date.now()}`;
                const mockDSOracle = await hre.deployments.deploy(
                  mockDSOracleName,
                  {
                    from: deployer,
                    args: [mockAPI3ServerV1.address],
                    contract: "MockAPI3OracleAlwaysAlive",
                    log: false,
                  }
                );

                // Set price to 1.1 (yield bearing asset price)
                const mockDSOracleContract = await hre.ethers.getContractAt(
                  "MockAPI3OracleAlwaysAlive",
                  mockDSOracle.address,
                  await hre.ethers.getSigner(deployer)
                );

                const dsPrice = 1.1;
                const dsPriceInWei = hre.ethers.parseUnits(
                  dsPrice.toString(),
                  18
                ); // API3 uses 18 decimals
                await mockDSOracleContract.setMock(dsPriceInWei);

                // Set the proxy for dS in the API3Wrapper
                await api3Wrapper.setProxy(
                  dSInfo.address,
                  mockDSOracle.address
                );
                console.log(
                  `  ✓ Fixed dS proxy by setting it to new mock oracle: ${mockDSOracle.address}`
                );

                // Verify we can now read the price
                try {
                  const price = await oracleAggregator.getAssetPrice(
                    dSInfo.address
                  );
                  console.log(
                    `  ✓ Successfully read price for dS after fixing proxy: ${price}`
                  );
                } catch (e) {
                  console.error(
                    `  ✗ Still failed to read dS price after fixing proxy: ${e}`
                  );
                }
              } else {
                console.error(
                  `  ✗ Could not find a working proxy for wS to use as reference`
                );
              }
            } catch (e) {
              console.error(`  ✗ Failed to set up proxy for dS: ${e}`);
            }
          } else {
            console.log(`  ✓ dS token proxy is set to: ${dSProxy}`);

            // Verify we can read the price
            try {
              const price = await oracleAggregator.getAssetPrice(
                dSInfo.address
              );
              console.log(`  ✓ Successfully read price for dS: ${price}`);
            } catch (e) {
              console.error(
                `  ✗ Failed to read dS price despite proxy being set: ${e}`
              );
              console.log(`  - Will attempt to fix dS proxy...`);

              // Deploy a new MockAPI3OracleAlwaysAlive specifically for dS
              const mockAPI3ServerV1 =
                await hre.deployments.get("MockAPI3ServerV1");
              const mockDSOracleName = `MockAPI3Oracle_dS_fixed_${Date.now()}`;
              const mockDSOracle = await hre.deployments.deploy(
                mockDSOracleName,
                {
                  from: deployer,
                  args: [mockAPI3ServerV1.address],
                  contract: "MockAPI3OracleAlwaysAlive",
                  log: false,
                }
              );

              // Set price to 1.1 (yield bearing asset price)
              const mockDSOracleContract = await hre.ethers.getContractAt(
                "MockAPI3OracleAlwaysAlive",
                mockDSOracle.address,
                await hre.ethers.getSigner(deployer)
              );

              const dsPrice = 1.1;
              const dsPriceInWei = hre.ethers.parseUnits(
                dsPrice.toString(),
                18
              ); // API3 uses 18 decimals
              await mockDSOracleContract.setMock(dsPriceInWei);

              // Set the proxy for dS in the API3Wrapper
              await api3Wrapper.setProxy(dSInfo.address, mockDSOracle.address);
              console.log(
                `  ✓ Fixed dS proxy by setting it to new mock oracle: ${mockDSOracle.address}`
              );

              // Verify we can now read the price
              try {
                const price = await oracleAggregator.getAssetPrice(
                  dSInfo.address
                );
                console.log(
                  `  ✓ Successfully read price for dS after fixing proxy: ${price}`
                );
              } catch (e) {
                console.error(
                  `  ✗ Still failed to read dS price after fixing proxy: ${e}`
                );
              }
            }
          }
        } catch (proxyError) {
          console.error(`  ✗ Failed to check proxy for dS: ${proxyError}`);
        }
      } else {
        console.error(`  ✗ No oracle found for dS in OracleAggregator`);
      }
    }

    // Check all other tokens
    for (const symbol of tokensToCheck) {
      if (symbol === "dS") continue; // Already handled dS specially above

      try {
        const { tokenInfo } = await getTokenContractForSymbol(
          hre,
          deployer,
          symbol
        );

        const oracleAddress = await oracleAggregator.assetOracles(
          tokenInfo.address
        );

        if (oracleAddress === "0x0000000000000000000000000000000000000000") {
          console.log(
            `Warning: No oracle found for ${symbol} (${tokenInfo.address})`
          );
        } else {
          console.log(`✓ Verified oracle for ${symbol}: ${oracleAddress}`);

          // Double check price read
          try {
            const price = await oracleAggregator.getAssetPrice(
              tokenInfo.address
            );
            console.log(`  ✓ Successfully read price for ${symbol}: ${price}`);
          } catch (e) {
            console.error(`  ✗ Failed to read ${symbol} price: ${e}`);
          }
        }
      } catch (e) {
        console.log(
          `Could not check oracle for ${symbol} - token may not exist`
        );
      }
    }
  } catch (e) {
    console.error(`Error in setupOraclesForTesting: ${e}`);
  }
}
