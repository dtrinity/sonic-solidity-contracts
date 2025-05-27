import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ERC20_VESTING_NFT_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.vesting) {
    console.log(
      "No vesting configuration found for this network. Skipping vesting NFT deployment.",
    );
    return;
  }

  // Validate configuration
  if (
    !config.vesting.dstakeToken ||
    config.vesting.dstakeToken === ethers.ZeroAddress
  ) {
    throw new Error(
      "Missing or invalid dstakeToken address in vesting configuration",
    );
  }

  if (
    !config.vesting.initialOwner ||
    config.vesting.initialOwner === ethers.ZeroAddress
  ) {
    throw new Error(
      "Missing or invalid initialOwner address in vesting configuration",
    );
  }

  if (config.vesting.vestingPeriod <= 0) {
    throw new Error("Invalid vesting period in configuration");
  }

  if (!config.vesting.maxTotalSupply || config.vesting.maxTotalSupply === "0") {
    throw new Error("Invalid maxTotalSupply in configuration");
  }

  // Deploy the ERC20VestingNFT contract
  const vestingNFT = await deploy(ERC20_VESTING_NFT_ID, {
    from: deployer,
    contract: "ERC20VestingNFT",
    args: [
      config.vesting.dstakeToken,
      config.vesting.vestingPeriod,
      config.vesting.maxTotalSupply,
      config.vesting.initialOwner,
    ],
    log: false,
  });

  console.log(`🔒 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  console.log(`   ERC20VestingNFT: ${vestingNFT.address}`);
  console.log(`   dSTAKE Token: ${config.vesting.dstakeToken}`);
  console.log(
    `   Vesting Period: ${config.vesting.vestingPeriod} seconds (${Math.round(config.vesting.vestingPeriod / (24 * 60 * 60))} days)`,
  );
  console.log(
    `   Max Total Supply: ${ethers.formatUnits(config.vesting.maxTotalSupply, 18)} dSTAKE`,
  );
  console.log(`   Initial Owner: ${config.vesting.initialOwner}`);
};

export default func;
func.tags = ["ERC20VestingNFT", "vesting"];
func.dependencies = ["dStake"]; // Depends on dSTAKE tokens being deployed
