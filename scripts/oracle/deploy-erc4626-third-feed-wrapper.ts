import { ethers } from "hardhat";

/**
 * Example helper for deploying the 3-leg ERC4626 wrapper used for wstkscUSD-style assets:
 * ERC4626 vault conversion -> rate provider -> third USD feed.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const factory = await ethers.getContractFactory("ERC4626RateProviderThirdFeedWrapperWithThresholding");
  const wrapper = await factory.deploy(ethers.ZeroAddress, ethers.parseUnits("1", 8));
  await wrapper.waitForDeployment();

  console.log("ERC4626RateProviderThirdFeedWrapperWithThresholding:", await wrapper.getAddress());
  console.log("Example setFeed arguments for wstkscUSD:");
  console.log("  asset / erc4626Vault:", "0x9fb76f7ce5FCeAA2C42887ff441D46095E494206");
  console.log("  rateProvider:", "0x13cCc810DfaA6B71957F2b87060aFE17e6EB8034");
  console.log("  thirdFeed:", "0x55bCa887199d5520B3Ce285D41e6dC10C08716C9");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
