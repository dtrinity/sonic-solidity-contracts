import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());

  const CORE = process.env.CORE!;
  const DUSD = process.env.DUSD!;
  const COLLATERAL = process.env.COLLATERAL!;
  const FLASH_LENDER = process.env.FLASH_LENDER!;
  const ODOS_ROUTER = process.env.ODOS_ROUTER!;

  const Periphery = await ethers.getContractFactory("RewardCompounderDLendOdos");
  const periphery = await Periphery.deploy(DUSD, COLLATERAL, FLASH_LENDER, CORE, ODOS_ROUTER);
  await periphery.waitForDeployment();
  console.log("RewardCompounderDLendOdos:", await periphery.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });

