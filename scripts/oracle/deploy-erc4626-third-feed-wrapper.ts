import { ethers } from "hardhat";

/**
 * @title Deploy ERC4626RateProviderThirdFeedWrapperWithThresholding
 * @notice Example deployment script for the three-feed oracle wrapper
 * 
 * Use case: wstkscUSD -> stkscUSD -> scUSD -> USD
 * 1. ERC4626: wstkscUSD -> stkscUSD (vault conversion)
 * 2. Rate Provider: stkscUSD -> scUSD (custom rate logic)
 * 3. Third Feed: scUSD -> USD (Chainlink or other oracle)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", await ethers.provider.getBalance(deployer.address));

  // Deploy the three-feed wrapper
  const ERC4626ThirdFeedWrapper = await ethers.getContractFactory(
    "ERC4626RateProviderThirdFeedWrapperWithThresholding"
  );
  
  // Example: USD as base currency with 8 decimals (like Chainlink)
  const baseCurrency = ethers.ZeroAddress; // 0x0 for USD
  const baseCurrencyUnit = ethers.parseUnits("1", 8); // 1e8
  
  const wrapper = await ERC4626ThirdFeedWrapper.deploy(baseCurrency, baseCurrencyUnit);
  await wrapper.waitForDeployment();
  
  const wrapperAddress = await wrapper.getAddress();
  console.log("ERC4626RateProviderThirdFeedWrapperWithThresholding deployed to:", wrapperAddress);
  
  // Example configuration for wstkscUSD
  console.log("\nExample configuration for wstkscUSD:");
  console.log("1. Deploy or identify your ERC4626 vault (wstkscUSD -> stkscUSD)");
  console.log("2. Deploy or identify your rate provider (stkscUSD -> scUSD)");
  console.log("3. Deploy or identify your third feed (scUSD -> USD)");
  console.log("4. Call setFeed() with all three addresses and threshold parameters");
  
  console.log("\nExample setFeed() call:");
  console.log("await wrapper.setFeed(");
  console.log("  wstkscUSDAddress,        // asset");
  console.log("  erc4626VaultAddress,     // ERC4626 vault");
  console.log("  rateProviderAddress,     // rate provider");
  console.log("  thirdFeedAddress,        // third feed (Chainlink)");
  console.log("  0, 0,                    // primary threshold (disabled)");
  console.log("  0, 0,                    // secondary threshold (disabled)");
  console.log("  0, 0                     // tertiary threshold (disabled)");
  console.log(");");
  
  console.log("\nTo enable thresholding, set non-zero values:");
  console.log("- lowerThresholdInBase: price threshold to trigger fixed price");
  console.log("- fixedPriceInBase: fixed price to use when threshold is exceeded");
  
  console.log("\nStale timeout configuration:");
  console.log("await wrapper.setStaleTimeout(24 * 3600); // Set to 1 day");
  console.log("await wrapper.setStaleTimeout(0);         // Disable stale checks");
  console.log("// Default is 1 hour (3600 seconds)");
  
  return wrapperAddress;
}

main()
  .then((address) => {
    console.log("\nDeployment completed successfully!");
    console.log("Contract address:", address);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
