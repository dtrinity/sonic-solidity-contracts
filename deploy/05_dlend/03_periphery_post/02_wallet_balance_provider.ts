import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Deploying WalletBalanceProvider...");
  const walletBalanceProvider = await deploy("WalletBalanceProvider", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: 1,
  });

  console.log(
    `WalletBalanceProvider deployed at: ${walletBalanceProvider.address}`
  );
  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.id = "WalletBalanceProvider";

export default func;
