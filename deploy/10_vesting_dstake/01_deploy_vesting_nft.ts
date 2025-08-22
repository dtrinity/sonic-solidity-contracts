import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DSTAKE_NFT_VESTING_DEPLOYMENT_TAG, ERC20_VESTING_NFT_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.vesting) {
    console.log("No vesting configuration found for this network. Skipping vesting NFT deployment.");
    return;
  }

  // Validate configuration
  if (!config.vesting.name || config.vesting.name.trim() === "") {
    throw new Error("Missing or invalid name in vesting configuration");
  }

  if (!config.vesting.symbol || config.vesting.symbol.trim() === "") {
    throw new Error("Missing or invalid symbol in vesting configuration");
  }

  if (!config.vesting.dstakeToken || config.vesting.dstakeToken === ethers.ZeroAddress) {
    throw new Error("Missing or invalid dstakeToken address in vesting configuration");
  }

  if (!config.vesting.initialOwner || config.vesting.initialOwner === ethers.ZeroAddress) {
    throw new Error("Missing or invalid initialOwner address in vesting configuration");
  }

  if (config.vesting.vestingPeriod <= 0) {
    throw new Error("Invalid vesting period in configuration");
  }

  if (!config.vesting.maxTotalSupply || config.vesting.maxTotalSupply === "0") {
    throw new Error("Invalid maxTotalSupply in configuration");
  }

  // Deploy the ERC20VestingNFT contract
  await deploy(ERC20_VESTING_NFT_ID, {
    from: deployer,
    contract: "ERC20VestingNFT",
    args: [
      config.vesting.name,
      config.vesting.symbol,
      config.vesting.dstakeToken,
      config.vesting.vestingPeriod,
      config.vesting.maxTotalSupply,
      config.vesting.minDepositThreshold,
      config.vesting.initialOwner,
    ],
    log: false,
  });

  console.log(`🔒 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = ERC20_VESTING_NFT_ID;
func.tags = [DSTAKE_NFT_VESTING_DEPLOYMENT_TAG];
func.dependencies = ["dStake"]; // Depends on dSTAKE tokens being deployed

export default func;
