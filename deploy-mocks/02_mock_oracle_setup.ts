import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isMainnet } from "../typescript/hardhat/deploy";
import { getTokenContractForSymbol } from "../typescript/token/utils";

// Define the oracle feed structure
interface OracleFeedConfig {
  name: string; // Name of the oracle feed (e.g., "USDC/USD")
  symbol: string; // Token symbol
  price: string; // Default price
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - should not deploy mock oracles on mainnet");
  }

  // Deploy a mock API3 server V1 (this would be the actual API3 server on mainnet)
  const mockAPI3ServerV1 = await hre.deployments.deploy("MockAPI3ServerV1", {
    from: deployer,
    args: [],
    contract: "MockAPI3ServerV1",
    autoMine: true,
    log: false,
  });

  // Define oracle feeds with their names and prices
  const oracleFeeds: OracleFeedConfig[] = [
    // USD price feeds
    { name: "frxUSD_USD", symbol: "frxUSD", price: "1" },
    { name: "USDC_USD", symbol: "USDC", price: "1" },
    { name: "USDS_USD", symbol: "USDS", price: "1" },
    { name: "wS_USD", symbol: "wS", price: "4.2" },

    // Vault feeds
    { name: "sfrxUSD_frxUSD", symbol: "sfrxUSD", price: "1.1" },
    { name: "sUSDS_USDS", symbol: "sUSDS", price: "1.1" },
    { name: "stS_S", symbol: "stS", price: "1.1" },
    { name: "wOS_S", symbol: "wOS", price: "1.1" },
  ];

  // Track deployed mock oracles for each asset
  const mockOracleDeployments: Record<string, string> = {};
  const mockOracleNameToAddress: Record<string, string> = {};

  // Deploy individual MockAPI3OracleAlwaysAlive instances for each feed
  for (const feed of oracleFeeds) {
    try {
      const { tokenInfo } = await getTokenContractForSymbol(
        hre,
        deployer,
        feed.symbol
      );

      // Deploy a MockAPI3OracleAlwaysAlive for this feed
      // Use the new naming convention: MockAPI3OracleAlwaysAlive_TOKEN_QUOTE
      const mockOracleName = `MockAPI3OracleAlwaysAlive_${feed.name}`;
      const mockOracle = await hre.deployments.deploy(mockOracleName, {
        from: deployer,
        args: [mockAPI3ServerV1.address],
        contract: "MockAPI3OracleAlwaysAlive",
        autoMine: true,
        log: false,
      });

      // Get the deployed mock oracle contract
      const mockOracleContract = await hre.ethers.getContractAt(
        "MockAPI3OracleAlwaysAlive",
        mockOracle.address,
        signer
      );

      // Convert price to int224 format expected by API3
      const priceInWei = hre.ethers.parseUnits(feed.price, 18); // API3 uses 18 decimals
      await mockOracleContract.setMock(priceInWei);

      // Store the deployment for config
      mockOracleDeployments[tokenInfo.address] = mockOracle.address;
      mockOracleNameToAddress[feed.name] = mockOracle.address;

      console.log(
        `Deployed ${mockOracleName} at ${mockOracle.address} with price ${feed.price}`
      );
    } catch (error) {
      console.log(`Token ${feed.symbol} not found, skipping`);
    }
  }

  // Store the mock oracle deployments in a JSON file for the config to use
  await hre.deployments.save("MockOracleDeployments", {
    address: ZeroAddress, // Not a real contract, just storing data
    abi: [],
    linkedData: mockOracleDeployments,
  });

  // Store the mock oracle name to address mapping for easier reference
  await hre.deployments.save("MockOracleNameToAddress", {
    address: ZeroAddress, // Not a real contract, just storing data
    abi: [],
    linkedData: mockOracleNameToAddress,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "oracle"];
func.dependencies = ["tokens"];
func.id = "local_oracle_setup";

export default func;
