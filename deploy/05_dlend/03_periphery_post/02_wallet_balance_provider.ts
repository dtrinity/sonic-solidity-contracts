import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { WALLET_BALANCE_PROVIDER_ID } from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const _walletBalanceProvider = await deploy(WALLET_BALANCE_PROVIDER_ID, {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: 1,
  });

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.tags = ["dlend", "dlend-periphery-post"];
func.id = "dLend:WalletBalanceProvider";

export default func;
