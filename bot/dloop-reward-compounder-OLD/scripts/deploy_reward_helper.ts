import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());

  const POOL = process.env.POOL!;
  const REWARD_CONTROLLER = process.env.REWARD_CONTROLLER!;
  const ADDRESS_PROVIDER = process.env.ADDRESS_PROVIDER!;

  const Helper = await ethers.getContractFactory("RewardHelper");
  const helper = await Helper.deploy(POOL, REWARD_CONTROLLER, ADDRESS_PROVIDER);
  await helper.waitForDeployment();
  console.log("RewardHelper:", await helper.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });

