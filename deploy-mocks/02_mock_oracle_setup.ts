import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { isMainnet } from "../typescript/hardhat/deploy";
import { getTokenContractForSymbol } from "../typescript/token/utils";

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

  // Get token addresses
  const tokenSymbols = [
    // dUSD ecosystem tokens
    "frxUSD",
    "sfrxUSD",
    "USDC",
    "USDS",
    "sUSDS",
    // dS ecosystem tokens
    "stS",
    "wOS",
  ];

  // Track deployed mock oracles for each asset
  const mockOracleDeployments: Record<string, string> = {};

  // Deploy individual MockAPI3OracleAlwaysAlive instances for each token
  for (const symbol of tokenSymbols) {
    try {
      const { tokenInfo } = await getTokenContractForSymbol(
        hre,
        deployer,
        symbol
      );

      // Deploy a MockAPI3OracleAlwaysAlive for this token
      const mockOracleName = `MockAPI3Oracle_${symbol}`;
      const mockOracle = await hre.deployments.deploy(mockOracleName, {
        from: deployer,
        args: [mockAPI3ServerV1.address],
        contract: "MockAPI3OracleAlwaysAlive",
        autoMine: true,
        log: false,
      });

      // Set default prices (can be customized as needed)
      let price = "1"; // Default price for stable assets

      if (
        symbol === "sfrxUSD" ||
        symbol === "stS" ||
        symbol === "wOS" ||
        symbol === "wS"
      ) {
        price = "1.1"; // Higher price for yield-bearing assets
      }

      // Get the deployed mock oracle contract
      const mockOracleContract = await hre.ethers.getContractAt(
        "MockAPI3OracleAlwaysAlive",
        mockOracle.address,
        signer
      );

      // Convert price to int224 format expected by API3
      const priceInWei = hre.ethers.parseUnits(price, 18); // API3 uses 18 decimals
      await mockOracleContract.setMock(priceInWei);

      // Store the deployment for config
      mockOracleDeployments[tokenInfo.address] = mockOracle.address;

      console.log(
        `Deployed ${mockOracleName} at ${mockOracle.address} with price ${price}`
      );
    } catch (error) {
      console.log(`Token ${symbol} not found, skipping`);
    }
  }

  // Store the mock oracle deployments in a JSON file for the config to use
  await hre.deployments.save("MockOracleDeployments", {
    address: ZeroAddress, // Not a real contract, just storing data
    abi: [],
    linkedData: mockOracleDeployments,
  });

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "oracle"];
func.dependencies = ["tokens"];
func.id = "local_oracle_setup";

export default func;
