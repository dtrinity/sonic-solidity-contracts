import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { isSonicTestnet } from "../typescript/hardhat/deploy";

// Import shared config from script 02
import { oracleFeeds, OracleFeedConfig } from "./02_mock_oracle_setup";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // Only run this script on sonic_testnet
  if (!isSonicTestnet(hre.network.name)) {
    return;
  }

  // Find the wS_USD configuration from the shared array
  const wSUsdConfig = oracleFeeds.find((feed) => feed.name === "wS_USD");

  if (!wSUsdConfig) {
    throw new Error(
      "wS_USD configuration not found in shared oracleFeeds array."
    );
  }

  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  // Get the deployed MockAPI3ServerV1
  const mockAPI3ServerV1 = await hre.deployments.get("MockAPI3ServerV1");
  if (!mockAPI3ServerV1) {
    throw new Error("MockAPI3ServerV1 deployment not found.");
  }

  // Deploy the MockAPI3OracleAlwaysAlive for wS_USD
  const mockOracleName = `MockAPI3OracleAlwaysAlive_${wSUsdConfig.name}`;
  const mockOracle = await hre.deployments.deploy(mockOracleName, {
    from: deployer,
    args: [mockAPI3ServerV1.address],
    contract: "MockAPI3OracleAlwaysAlive",
    autoMine: true,
    log: false, // Set to true for debugging if needed
  });

  // Get the deployed mock oracle contract
  const mockOracleContract = await hre.ethers.getContractAt(
    "MockAPI3OracleAlwaysAlive",
    mockOracle.address,
    signer
  );

  // Set the mock price
  const priceInWei = hre.ethers.parseUnits(wSUsdConfig.price, 18); // API3 uses 18 decimals
  await mockOracleContract.setMock(priceInWei);

  console.log(
    `Deployed ${mockOracleName} at ${mockOracle.address} with price ${wSUsdConfig.price}`
  );

  // --- Update MockOracleNameToAddress Deployment Data ---

  // Load the existing MockOracleNameToAddress data
  const mockOracleNameToAddressDeployment = await hre.deployments.getOrNull(
    "MockOracleNameToAddress"
  );
  let mockOracleNameToAddress = mockOracleNameToAddressDeployment
    ? mockOracleNameToAddressDeployment.linkedData || {}
    : {};

  // Add or update the wS_USD mapping
  mockOracleNameToAddress[wSUsdConfig.name] = mockOracle.address;

  // Save the updated mapping
  await hre.deployments.save("MockOracleNameToAddress", {
    address: ZeroAddress, // Not a real contract, just storing data
    abi: [],
    linkedData: mockOracleNameToAddress,
  });

  console.log(`Updated MockOracleNameToAddress with ${wSUsdConfig.name}`);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["sonic-testnet-setup", "oracle"];
func.dependencies = ["local_oracle_setup"]; // Depends on 02 script deploying MockAPI3ServerV1 and MockOracleNameToAddress
func.id = "sonic_testnet_wS_oracle_setup";

export default func;
