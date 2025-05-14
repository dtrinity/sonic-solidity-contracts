import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { isMainnet } from "../typescript/hardhat/deploy";
import { ONE_HUNDRED_PERCENT_BPS } from "../typescript/common/bps_constants";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  if (isMainnet(hre.network.name)) {
    throw new Error("WARNING - should not deploy mock contracts on mainnet");
  }

  // Dummy/mock addresses for ERC20s (should be replaced with actual deployed mocks in a real setup)
  const underlyingAsset = (await hre.deployments.getOrNull("USDC"))?.address || "0x0000000000000000000000000000000000000001";
  const dStable = (await hre.deployments.getOrNull("dUSD"))?.address || "0x0000000000000000000000000000000000000002";

  const deployed = await hre.deployments.deploy("DLoopCoreMock", {
    contract: "DLoopCoreMock",
    from: deployer,
    args: [
      "Mock dLOOP Vault",
      "mdLOOP",
      underlyingAsset,
      dStable,
      3 * ONE_HUNDRED_PERCENT_BPS, // 3x leverage
      2 * ONE_HUNDRED_PERCENT_BPS, // lower bound
      4 * ONE_HUNDRED_PERCENT_BPS, // upper bound
      1000   // max subsidy bps
    ],
    autoMine: true,
    log: false,
  });

  console.log(`Deployed DLoopCoreMock at ${deployed.address}`);
  console.log(`🏗️  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "mock-dloop-core"];
func.dependencies = ["tokens"];
func.id = "local_mock_dloop_core_setup";

export default func; 