import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Signer, parseEther, ZeroAddress } from "ethers";
import { Address } from "hardhat-deploy/types";

import {
  NativeMintingGateway,
  Issuer,
  ERC20StablecoinUpgradeable, // Actual dStable type
  ERC20 // Added generic ERC20 type
} from "../../typechain-types"; // Adjust path if necessary

// Import the fixture and config
import { createDStableFixture, DS_CONFIG } from "./fixtures"; // Use DS config for dS/wS
import { getTokenContractForSymbol, TokenInfo } from "../../typescript/token/utils";
import { DS_ISSUER_CONTRACT_ID, DS_TOKEN_ID } from "../../typescript/deploy-ids"; // Specific IDs for dS


describe("NativeMintingGateway (Integration)", () => { // Indicate integration tests
  let deployer: Signer;
  let user1: Signer;
  let deployerAddress: Address;
  let user1Address: Address;

  let gateway: NativeMintingGateway;
  let issuerContract: Issuer;
  let dStableContract: ERC20StablecoinUpgradeable; // Use actual type
  let wNativeContract: ERC20; // Use generic ERC20 type
  let wNativeInfo: TokenInfo;

  // Use the dS fixture
  const fixture = createDStableFixture(DS_CONFIG);

  const WNATIVE_DECIMALS = 18; // Standard decimals
  const DSTABLE_DECIMALS = 18; // Standard decimals

  beforeEach(async () => {
    await fixture(); // Run the fixture to deploy Issuer, dS, Vault, Oracle, Collaterals (including wS)

    ({ deployerAddress, user1Address } = await getNamedAccounts());
    deployer = await ethers.getSigner(deployerAddress);
    user1 = await ethers.getSigner(user1Address);

    // Get deployed Issuer contract
    const issuerAddress = (await hre.deployments.get(DS_ISSUER_CONTRACT_ID)).address;
    issuerContract = await hre.ethers.getContractAt("Issuer", issuerAddress, deployer);

    // Get deployed dS token contract
    const dStableAddress = (await hre.deployments.get(DS_TOKEN_ID)).address;
    dStableContract = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", dStableAddress, deployer);

    // Get deployed wS token contract (assuming 'wS' is the symbol used in fixtures/config)
    // This assumes the fixture deploys wS and makes it available via getTokenContractForSymbol
    try {
        const wNativeResult = await getTokenContractForSymbol(hre, deployerAddress, 'wS'); // Use the correct symbol for wrapped Sonic
        wNativeContract = wNativeResult.contract as ERC20; // Cast to generic ERC20 type
        wNativeInfo = wNativeResult.tokenInfo;

        // Small check - Ensure vault allows wS (fixture should handle this, but good practice)
        const collateralVaultAddress = await issuerContract.collateralVault();
        const collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress); // Use CollateralVault interface/contract
        const isSupported = await collateralVault.isCollateralSupported(wNativeInfo.address);
         if (!isSupported) {
             console.warn(`Warning: ${wNativeInfo.symbol} collateral not supported in vault by default. Attempting to allow.`);
             await collateralVault.connect(deployer).allowCollateral(wNativeInfo.address);
         }

    } catch (e) {
        console.error("Failed to get wS token from fixture. Ensure 'wS' is configured correctly.");
        throw e;
    }


    // Deploy Gateway with actual contract addresses
    const gatewayFactory = await ethers.getContractFactory("NativeMintingGateway", deployer);
    gateway = await gatewayFactory.deploy(
      wNativeInfo.address, // Use address from fixture
      issuerAddress,
      dStableAddress
    );
    await gateway.waitForDeployment();

    // Ensure user1 has some Ether (though fixture might provide some)
    // You might want to add more Ether specifically for these tests if needed
    await hre.network.provider.send("hardhat_setBalance", [
        user1Address,
        "0x56BC75E2D63100000", // 100 ETH
      ]);

  });

  // --- Deployment Tests ---
  describe("Deployment", () => {
     it("Should revert if wNative address is zero", async () => {
      const gatewayFactory = await ethers.getContractFactory("NativeMintingGateway", deployer);
      await expect(
        gatewayFactory.deploy(ZeroAddress, await issuerContract.getAddress(), await dStableContract.getAddress())
      ).to.be.revertedWithCustomError(gatewayFactory, "ZeroAddress");
    });

    it("Should revert if issuer address is zero", async () => {
        const gatewayFactory = await ethers.getContractFactory("NativeMintingGateway", deployer);
        await expect(
          gatewayFactory.deploy(wNativeInfo.address, ZeroAddress, await dStableContract.getAddress())
        ).to.be.revertedWithCustomError(gatewayFactory, "ZeroAddress");
      });

    it("Should revert if dStable address is zero", async () => {
      const gatewayFactory = await ethers.getContractFactory("NativeMintingGateway", deployer);
      await expect(
        gatewayFactory.deploy(wNativeInfo.address, await issuerContract.getAddress(), ZeroAddress)
      ).to.be.revertedWithCustomError(gatewayFactory, "ZeroAddress");
    });

     it("Should set the correct addresses", async () => {
      expect(await gateway.W_NATIVE_TOKEN()).to.equal(wNativeInfo.address);
      expect(await gateway.DSTABLE_ISSUER()).to.equal(await issuerContract.getAddress());
      expect(await gateway.DSTABLE_TOKEN()).to.equal(await dStableContract.getAddress());
    });
  });


  // --- depositNativeAndMintStable Tests ---
  describe("depositNativeAndMintStable", () => {
    const depositAmount = parseEther("1.0"); // 1 Native token (e.g., Ether)
    // Calculate minDStable dynamically or use a reasonable low value for testing success
    // We need the oracle price to calculate accurately. For simplicity, start low.
    const minDStableLow = parseEther("0.5"); // Low minimum to likely succeed
    const minDStableHigh = parseEther("10000"); // High minimum to likely fail (test slippage)


    it("Should successfully deposit native, wrap, issue, and transfer dStable", async () => {
      const gatewayAddress = await gateway.getAddress();
      const issuerAddress = await issuerContract.getAddress();

      const userNativeBalanceBefore = await ethers.provider.getBalance(user1Address);
      const userDStableBalanceBefore = await dStableContract.balanceOf(user1Address);
      const gatewayWNativeBalanceBefore = await wNativeContract.balanceOf(gatewayAddress);
      const gatewayDStableBalanceBefore = await dStableContract.balanceOf(gatewayAddress);
      const issuerWNativeAllowanceBefore = await wNativeContract.allowance(gatewayAddress, issuerAddress);

      // --- Action ---
      const tx = await gateway.connect(user1).depositNativeAndMintStable(minDStableLow, { value: depositAmount });
      const receipt = await tx.wait();
      const gasUsed = receipt ? receipt.gasUsed * receipt.gasPrice : 0n;


      // --- Assertions ---
      const userNativeBalanceAfter = await ethers.provider.getBalance(user1Address);
      const userDStableBalanceAfter = await dStableContract.balanceOf(user1Address);
      const gatewayWNativeBalanceAfter = await wNativeContract.balanceOf(gatewayAddress);
      const gatewayDStableBalanceAfter = await dStableContract.balanceOf(gatewayAddress);
      const issuerWNativeAllowanceAfter = await wNativeContract.allowance(gatewayAddress, issuerAddress);

      // Calculate expected dS issued (can be tricky without exact oracle state during test)
      // For now, check that *some* dS was received. A more precise check would involve reading oracle price.
      const dStableReceived = userDStableBalanceAfter - userDStableBalanceBefore;
      expect(dStableReceived).to.be.gt(0, "User should receive some dStable"); // Check > 0

      // Check balances
      expect(userNativeBalanceBefore - userNativeBalanceAfter - gasUsed).to.equal(depositAmount, "User native balance change mismatch");
      expect(gatewayWNativeBalanceAfter).to.equal(gatewayWNativeBalanceBefore, "Gateway wNative balance should end at 0"); // Should wrap then transfer out
      expect(gatewayDStableBalanceAfter).to.equal(gatewayDStableBalanceBefore, "Gateway dStable balance should end at 0"); // Should receive then transfer out
      expect(issuerWNativeAllowanceAfter).to.equal(issuerWNativeAllowanceBefore, "Issuer allowance should be consumed"); // Approve then transferFrom

      // Check Events (check that they emitted, args can be complex with real values)
      await expect(tx).to.emit(gateway, "NativeWrapped");
      await expect(tx).to.emit(gateway, "TokenIssued")
         .withArgs(user1Address, wNativeInfo.address, depositAmount, dStableReceived); // Check issued amount matches received
    });

    it("Should revert if zero value is sent", async () => {
      await expect(
        gateway.connect(user1).depositNativeAndMintStable(minDStableLow, { value: 0 })
      ).to.be.revertedWithCustomError(gateway, "ZeroDeposit");
    });

    it("Should revert if issuer.issue fails (e.g., Slippage)", async () => {
      // Use a very high minDStable to trigger issuer's internal slippage check
      const highMinDStable = ethers.parseUnits("1000000000", DSTABLE_DECIMALS); // Unrealistic minimum

      // The Issuer contract itself should revert, likely with its own error
      // Need to know the exact error from Issuer.sol (e.g., SlippageTooHigh)
      const issuerFactory = await ethers.getContractFactory("Issuer"); // Need factory to get error selector

      await expect(
        gateway.connect(user1).depositNativeAndMintStable(highMinDStable, { value: depositAmount })
      ).to.be.revertedWithCustomError(issuerFactory, "SlippageTooHigh"); // Check for the Issuer's specific error
    });
  });

   // --- Receive Fallback Test ---
  describe("receive", () => {
    it("Should allow the contract to receive native tokens", async () => {
      const sendAmount = parseEther("0.5");
      const gatewayAddress = await gateway.getAddress();
      const initialBalance = await ethers.provider.getBalance(gatewayAddress);

      await expect(
        user1.sendTransaction({
          to: gatewayAddress,
          value: sendAmount,
        })
      ).to.not.be.reverted;

      const finalBalance = await ethers.provider.getBalance(gatewayAddress);
      expect(finalBalance - initialBalance).to.equal(sendAmount);
    });
  });

}); 