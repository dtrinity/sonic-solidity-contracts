import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../config/config";
import { isMainnet } from "../typescript/hardhat/deploy";
import { TestERC20 } from "../typechain-types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - should not deploy mock router on mainnet");
  }

  // Deploy OdosRouterV2Mock
  const deployed = await hre.deployments.deploy("OdosRouterV2Mock", {
    contract: "OdosRouterV2Mock",
    from: deployer,
    args: [],
    autoMine: true,
    log: false,
  });

  console.log(`Deployed OdosRouterV2Mock at ${deployed.address}`);

  // Get all mock tokens and deposit 5% to the router
  if (config.MOCK_ONLY?.tokens) {
    for (const [symbol, _tokenConfig] of Object.entries(
      config.MOCK_ONLY.tokens
    )) {
      // Get the deployed token contract
      const tokenDeployment = await hre.deployments.get(symbol);
      const token = (await hre.ethers.getContractAt(
        "TestERC20",
        tokenDeployment.address
      )) as TestERC20;

      // Calculate 5% of total supply
      const totalSupply = await token.totalSupply();
      const amountToDeposit = (totalSupply * BigInt(5)) / BigInt(100); // 5%

      // Transfer tokens to the router
      await token.transfer(deployed.address, amountToDeposit);

      console.log(
        `Deposited ${amountToDeposit.toString()} ${symbol} to OdosRouterV2Mock`
      );
    }
  }

  console.log(`🔄  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

// Make sure this runs after the mock tokens are deployed
func.dependencies = ["local_token_setup"];
func.tags = ["local-setup", "odos-router"];
func.id = "local_odos_router_setup";

export default func;
