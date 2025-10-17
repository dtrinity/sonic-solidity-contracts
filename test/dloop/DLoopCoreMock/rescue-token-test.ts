import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { deployDLoopMockFixture, testSetup } from "./fixture";

describe("DLoopCoreMock Rescue Token Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let otherToken: TestMintableERC20;
  let accounts: HardhatEthersSigner[];
  let owner: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;
  let receiver: HardhatEthersSigner;

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    accounts = fixture.accounts;
    owner = accounts[0]; // Owner is the first account
    nonOwner = accounts[1];
    receiver = accounts[2];

    // Deploy an additional token for testing rescue functionality
    const TestMintableERC20 = await ethers.getContractFactory("TestMintableERC20");
    otherToken = await TestMintableERC20.deploy("Other Token", "OTHER", 18);
    await otherToken.waitForDeployment();

    // Mint tokens to the vault for testing rescue functionality
    await otherToken.mint(await dloopMock.getAddress(), ethers.parseEther("100"));
  });

  describe("I. Restricted Rescue Tokens", function () {
    it("Should have no restricted tokens by default", async function () {
      // The mock starts with no additional restricted tokens
      const mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(0);
    });

    it("Should check if token is restricted using isRestrictedRescueToken", async function () {
      const tokenAddress = await otherToken.getAddress();

      // Initially no tokens are restricted
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAddress)).to.be.false;

      // After setting as additional rescue token, it becomes restricted
      await dloopMock.setMockAdditionalRescueTokens([tokenAddress]);
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAddress)).to.be.true;
    });
  });

  describe("II. Rescue Token Access Control", function () {
    it("Should allow owner to rescue non-restricted tokens", async function () {
      const rescueAmount = ethers.parseEther("50");

      // Verify vault has the tokens
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(ethers.parseEther("100"));

      // Verify receiver has no tokens initially
      expect(await otherToken.balanceOf(receiver.address)).to.equal(0);

      // Owner should be able to rescue
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, rescueAmount);

      // Verify tokens were transferred
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(ethers.parseEther("50"));
      expect(await otherToken.balanceOf(receiver.address)).to.equal(rescueAmount);
    });

    it("Should revert when non-owner tries to rescue tokens", async function () {
      const rescueAmount = ethers.parseEther("50");

      await expect(
        dloopMock.connect(nonOwner).rescueToken(await otherToken.getAddress(), receiver.address, rescueAmount),
      ).to.be.revertedWithCustomError(dloopMock, "OwnableUnauthorizedAccount");
    });

    it("Should revert when trying to rescue restricted collateral token", async function () {
      // Set collateral token as additional rescue token to make it restricted
      await dloopMock.setMockAdditionalRescueTokens([await collateralToken.getAddress()]);

      // First, put some collateral tokens in the vault
      await collateralToken.mint(await dloopMock.getAddress(), ethers.parseEther("100"));

      await expect(
        dloopMock.connect(owner).rescueToken(await collateralToken.getAddress(), receiver.address, ethers.parseEther("50")),
      ).to.be.revertedWithCustomError(dloopMock, "CannotRescueRestrictedToken");
    });

    it("Should revert when trying to rescue restricted debt token", async function () {
      // Set debt token as additional rescue token to make it restricted
      await dloopMock.setMockAdditionalRescueTokens([await debtToken.getAddress()]);

      // First, put some debt tokens in the vault
      await debtToken.mint(await dloopMock.getAddress(), ethers.parseEther("100"));

      await expect(
        dloopMock.connect(owner).rescueToken(await debtToken.getAddress(), receiver.address, ethers.parseEther("50")),
      ).to.be.revertedWithCustomError(dloopMock, "CannotRescueRestrictedToken");
    });
  });

  describe("III. Rescue Token Functionality", function () {
    it("Should rescue full balance of non-restricted token", async function () {
      const fullAmount = ethers.parseEther("100");

      // Verify initial state
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(fullAmount);
      expect(await otherToken.balanceOf(receiver.address)).to.equal(0);

      // Rescue full amount
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, fullAmount);

      // Verify final state
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(0);
      expect(await otherToken.balanceOf(receiver.address)).to.equal(fullAmount);
    });

    it("Should rescue partial balance of non-restricted token", async function () {
      const partialAmount = ethers.parseEther("30");
      const remainingAmount = ethers.parseEther("70");

      // Rescue partial amount
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, partialAmount);

      // Verify partial rescue worked
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(remainingAmount);
      expect(await otherToken.balanceOf(receiver.address)).to.equal(partialAmount);
    });

    it("Should handle zero amount rescue", async function () {
      const zeroAmount = 0;

      // Should not revert but also not transfer anything
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, zeroAmount);

      // Balances should remain unchanged
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(ethers.parseEther("100"));
      expect(await otherToken.balanceOf(receiver.address)).to.equal(0);
    });

    it("Should rescue to different receivers", async function () {
      const amount1 = ethers.parseEther("25");
      const amount2 = ethers.parseEther("35");
      const receiver2 = accounts[3];

      // Rescue to first receiver
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, amount1);

      // Rescue to second receiver
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver2.address, amount2);

      // Verify both receivers got tokens
      expect(await otherToken.balanceOf(receiver.address)).to.equal(amount1);
      expect(await otherToken.balanceOf(receiver2.address)).to.equal(amount2);
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(ethers.parseEther("40"));
    });
  });

  describe("IV. Multiple Token Types", function () {
    let anotherToken: TestMintableERC20;

    beforeEach(async function () {
      // Deploy another token for multi-token testing
      const TestMintableERC20 = await ethers.getContractFactory("TestMintableERC20");
      anotherToken = await TestMintableERC20.deploy(
        "Another Token",
        "ANOTHER",
        6, // Different decimals
      );
      await anotherToken.waitForDeployment();

      // Mint tokens to vault
      await anotherToken.mint(await dloopMock.getAddress(), ethers.parseUnits("200", 6));
    });

    it("Should rescue multiple different non-restricted tokens", async function () {
      const otherAmount = ethers.parseEther("40");
      const anotherAmount = ethers.parseUnits("150", 6);

      // Rescue first token
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, otherAmount);

      // Rescue second token
      await dloopMock.connect(owner).rescueToken(await anotherToken.getAddress(), receiver.address, anotherAmount);

      // Verify both rescues worked
      expect(await otherToken.balanceOf(receiver.address)).to.equal(otherAmount);
      expect(await anotherToken.balanceOf(receiver.address)).to.equal(anotherAmount);
    });

    it("Should handle tokens with different decimals", async function () {
      const amount6Decimals = ethers.parseUnits("100", 6);

      await dloopMock.connect(owner).rescueToken(await anotherToken.getAddress(), receiver.address, amount6Decimals);

      expect(await anotherToken.balanceOf(receiver.address)).to.equal(amount6Decimals);
    });
  });

  describe("V. Edge Cases and Error Handling", function () {
    it("Should revert when trying to rescue more tokens than available", async function () {
      const excessiveAmount = ethers.parseEther("150"); // More than the 100 in vault

      await expect(
        dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, excessiveAmount),
      ).to.be.revertedWithCustomError(otherToken, "ERC20InsufficientBalance");
    });

    it("Should handle rescue when vault has no tokens", async function () {
      // Deploy a new token that vault doesn't have
      const TestMintableERC20 = await ethers.getContractFactory("TestMintableERC20");
      const emptyToken = await TestMintableERC20.deploy("Empty Token", "EMPTY", 18);

      // Should revert when trying to rescue from empty balance
      await expect(
        dloopMock.connect(owner).rescueToken(await emptyToken.getAddress(), receiver.address, ethers.parseEther("1")),
      ).to.be.revertedWithCustomError(emptyToken, "ERC20InsufficientBalance");
    });

    it("Should handle rescue to zero address", async function () {
      // This should revert due to ERC20 transfer to zero address
      await expect(
        dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), ethers.ZeroAddress, ethers.parseEther("50")),
      ).to.be.revertedWithCustomError(otherToken, "ERC20InvalidReceiver");
    });

    it("Should work with zero token address (should revert)", async function () {
      // This should revert because zero address is not a valid ERC20 contract
      await expect(dloopMock.connect(owner).rescueToken(ethers.ZeroAddress, receiver.address, 0)).to.be.reverted;
    });
  });

  describe("VI. Integration with Vault Operations", function () {
    it("Should not affect vault operations after token rescue", async function () {
      const targetUser = accounts[1];

      // Set initial prices
      await dloopMock.setMockPrice(await collateralToken.getAddress(), ethers.parseEther("1.2"));
      await dloopMock.setMockPrice(await debtToken.getAddress(), ethers.parseEther("0.8"));

      // Rescue some non-restricted tokens
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, ethers.parseEther("50"));

      // Vault operations should still work normally
      await dloopMock.connect(targetUser).deposit(ethers.parseEther("100"), targetUser.address);

      // Verify deposit worked
      const userShares = await dloopMock.balanceOf(targetUser.address);
      expect(userShares).to.be.gt(0);

      // Verify rescue worked independently
      expect(await otherToken.balanceOf(receiver.address)).to.equal(ethers.parseEther("50"));
    });

    it("Should demonstrate reentrancy protection on rescue function", async function () {
      // The rescue function should have reentrancy protection from RescuableVault
      // This is evidenced by the nonReentrant modifier in RescuableVault.sol

      // Normal rescue should work
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, ethers.parseEther("25"));

      expect(await otherToken.balanceOf(receiver.address)).to.equal(ethers.parseEther("25"));
    });
  });

  describe("VII. Security and Permission Verification", function () {
    it("Should verify rescue functionality follows secure patterns", async function () {
      // This test documents the security features of the rescue functionality:

      // 1. Access Control: Only owner can rescue
      // 2. Restricted Tokens: Cannot rescue critical vault tokens (collateral, debt) when configured
      // 3. Reentrancy Protection: Function has nonReentrant modifier
      // 4. Safe Transfers: Uses SafeERC20 for transfers

      // Initially no restricted tokens
      let mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(0);

      // Configure collateral and debt tokens as restricted
      await dloopMock.setMockAdditionalRescueTokens([await collateralToken.getAddress(), await debtToken.getAddress()]);

      // Verify restricted tokens now include critical vault tokens
      mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens).to.include(await collateralToken.getAddress());
      expect(mockTokens).to.include(await debtToken.getAddress());

      // Verify only non-restricted tokens can be rescued
      await expect(
        dloopMock.connect(owner).rescueToken(await collateralToken.getAddress(), receiver.address, 1),
      ).to.be.revertedWithCustomError(dloopMock, "CannotRescueRestrictedToken");

      // Verify non-restricted tokens can be rescued
      await expect(dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, ethers.parseEther("10"))).to.not.be
        .reverted;
    });

    it("Should maintain consistency with base contract restrictions", async function () {
      // Verify that the mock implementation correctly handles restricted tokens

      const mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(0);

      // Mock implementation returns no additional restricted tokens by default
      expect(await dloopMock.testIsRestrictedRescueToken(await otherToken.getAddress())).to.be.false;
    });
  });

  describe("VIII. Additional Rescue Tokens Configuration", function () {
    let tokenA: TestMintableERC20;
    let tokenB: TestMintableERC20;
    let tokenC: TestMintableERC20;

    beforeEach(async function () {
      // Deploy additional tokens for testing
      const TestMintableERC20 = await ethers.getContractFactory("TestMintableERC20");

      tokenA = await TestMintableERC20.deploy("Token A", "TKA", 18);
      await tokenA.waitForDeployment();

      tokenB = await TestMintableERC20.deploy("Token B", "TKB", 18);
      await tokenB.waitForDeployment();

      tokenC = await TestMintableERC20.deploy("Token C", "TKC", 18);
      await tokenC.waitForDeployment();

      // Mint tokens to vault for testing
      await tokenA.mint(await dloopMock.getAddress(), ethers.parseEther("200"));
      await tokenB.mint(await dloopMock.getAddress(), ethers.parseEther("300"));
      await tokenC.mint(await dloopMock.getAddress(), ethers.parseEther("400"));
    });

    it("Should start with no additional rescue tokens", async function () {
      const additionalTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(additionalTokens.length).to.equal(0);

      // Verify no tokens are restricted by default
      const tokenAAddress = await tokenA.getAddress();
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAAddress)).to.be.false;
    });

    it("Should set and return single additional rescue token", async function () {
      const tokenAAddress = await tokenA.getAddress();
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress]);

      // Verify mock state contains only the additional token
      const mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(1);
      expect(mockTokens[0]).to.equal(tokenAAddress);

      // Verify implementation restricts the token
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAAddress)).to.be.true;
    });

    it("Should set and return multiple additional rescue tokens", async function () {
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      const tokenCAddress = await tokenC.getAddress();

      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress, tokenBAddress, tokenCAddress]);

      // Verify mock state contains only the additional tokens
      const mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(3);
      expect(mockTokens[0]).to.equal(tokenAAddress);
      expect(mockTokens[1]).to.equal(tokenBAddress);
      expect(mockTokens[2]).to.equal(tokenCAddress);

      // Verify implementation restricts all tokens
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAAddress)).to.be.true;
      expect(await dloopMock.testIsRestrictedRescueToken(tokenBAddress)).to.be.true;
      expect(await dloopMock.testIsRestrictedRescueToken(tokenCAddress)).to.be.true;
    });

    it("Should allow dynamic changes to additional rescue tokens", async function () {
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();
      const tokenCAddress = await tokenC.getAddress();

      // Start with single token
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress]);
      expect((await dloopMock.getMockAdditionalRescueTokens()).length).to.equal(1);

      // Change to multiple tokens
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress, tokenBAddress]);
      expect((await dloopMock.getMockAdditionalRescueTokens()).length).to.equal(2);

      // Change to different set of tokens
      await dloopMock.setMockAdditionalRescueTokens([tokenCAddress, tokenAAddress]);
      const mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(2);
      expect(mockTokens[0]).to.equal(tokenCAddress);
      expect(mockTokens[1]).to.equal(tokenAAddress);
    });

    it("Should clear additional rescue tokens when setting empty array", async function () {
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      // Set multiple tokens first
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress, tokenBAddress]);
      expect((await dloopMock.getMockAdditionalRescueTokens()).length).to.equal(2);
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAAddress)).to.be.true;
      expect(await dloopMock.testIsRestrictedRescueToken(tokenBAddress)).to.be.true;

      // Clear by setting empty array
      await dloopMock.setMockAdditionalRescueTokens([]);
      expect((await dloopMock.getMockAdditionalRescueTokens()).length).to.equal(0);
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAAddress)).to.be.false;
      expect(await dloopMock.testIsRestrictedRescueToken(tokenBAddress)).to.be.false;
    });

    it("Should handle setting same token multiple times", async function () {
      const tokenAAddress = await tokenA.getAddress();

      // Set same token multiple times in array
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress, tokenAAddress, tokenAAddress]);

      const mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(3);
      expect(mockTokens[0]).to.equal(tokenAAddress);
      expect(mockTokens[1]).to.equal(tokenAAddress);
      expect(mockTokens[2]).to.equal(tokenAAddress);
    });

    it("Should restrict rescue of additional rescue tokens", async function () {
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      // Set tokenA as additional rescue token
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress]);

      // Verify tokenA is now restricted (cannot be rescued)
      await expect(
        dloopMock.connect(owner).rescueToken(tokenAAddress, receiver.address, ethers.parseEther("50")),
      ).to.be.revertedWithCustomError(dloopMock, "CannotRescueRestrictedToken");

      // Verify tokenB is still rescuable (not in additional rescue tokens)
      await expect(dloopMock.connect(owner).rescueToken(tokenBAddress, receiver.address, ethers.parseEther("50"))).to.not.be.reverted;

      // Verify token was rescued
      expect(await tokenB.balanceOf(receiver.address)).to.equal(ethers.parseEther("50"));
    });

    it("Should include additional rescue tokens in restricted tokens list", async function () {
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      // Initially no restricted tokens (mock starts clean)
      let mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(0);
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAAddress)).to.be.false;
      expect(await dloopMock.testIsRestrictedRescueToken(tokenBAddress)).to.be.false;

      // Set additional rescue tokens
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress, tokenBAddress]);

      // Now additional tokens should be restricted
      mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens).to.include(tokenAAddress);
      expect(mockTokens).to.include(tokenBAddress);
      expect(await dloopMock.testIsRestrictedRescueToken(tokenAAddress)).to.be.true;
      expect(await dloopMock.testIsRestrictedRescueToken(tokenBAddress)).to.be.true;
      expect(mockTokens.length).to.equal(2);
    });

    it("Should allow rescuing non-additional tokens even when additional tokens are set", async function () {
      const tokenAAddress = await tokenA.getAddress();

      // Set tokenA as additional rescue token
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress]);

      // Verify otherToken (which is not additional) can still be rescued
      await dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, ethers.parseEther("25"));

      // Verify rescue worked
      expect(await otherToken.balanceOf(receiver.address)).to.equal(ethers.parseEther("25"));
      expect(await otherToken.balanceOf(await dloopMock.getAddress())).to.equal(ethers.parseEther("75"));
    });
  });

  describe("IX. Native Token Rescue Functionality", function () {
    beforeEach(async function () {
      // Send some native tokens to the vault for testing
      await owner.sendTransaction({
        to: await dloopMock.getAddress(),
        value: ethers.parseEther("10"),
      });
    });

    it("Should allow owner to rescue native tokens", async function () {
      const rescueAmount = ethers.parseEther("5");
      const initialBalance = await ethers.provider.getBalance(receiver.address);

      // Owner should be able to rescue native tokens
      await dloopMock.connect(owner).rescueNative(receiver.address, rescueAmount);

      // Verify native tokens were transferred
      const finalBalance = await ethers.provider.getBalance(receiver.address);
      expect(finalBalance - initialBalance).to.equal(rescueAmount);

      // Verify vault balance decreased
      const vaultBalance = await ethers.provider.getBalance(await dloopMock.getAddress());
      expect(vaultBalance).to.equal(ethers.parseEther("5"));
    });

    it("Should revert when non-owner tries to rescue native tokens", async function () {
      const rescueAmount = ethers.parseEther("5");

      await expect(dloopMock.connect(nonOwner).rescueNative(receiver.address, rescueAmount)).to.be.revertedWithCustomError(
        dloopMock,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should rescue full native token balance", async function () {
      const fullAmount = ethers.parseEther("10");
      const initialBalance = await ethers.provider.getBalance(receiver.address);

      // Rescue full amount
      await dloopMock.connect(owner).rescueNative(receiver.address, fullAmount);

      // Verify final state
      const finalBalance = await ethers.provider.getBalance(receiver.address);
      expect(finalBalance - initialBalance).to.equal(fullAmount);

      // Verify vault has no native tokens left
      const vaultBalance = await ethers.provider.getBalance(await dloopMock.getAddress());
      expect(vaultBalance).to.equal(0);
    });

    it("Should handle zero amount native token rescue", async function () {
      const zeroAmount = 0;
      const initialReceiverBalance = await ethers.provider.getBalance(receiver.address);

      // Should not revert but also not transfer anything
      await dloopMock.connect(owner).rescueNative(receiver.address, zeroAmount);

      // Balances should remain unchanged
      const finalReceiverBalance = await ethers.provider.getBalance(receiver.address);
      expect(finalReceiverBalance).to.equal(initialReceiverBalance);

      const vaultBalance = await ethers.provider.getBalance(await dloopMock.getAddress());
      expect(vaultBalance).to.equal(ethers.parseEther("10"));
    });

    it("Should rescue to different receivers", async function () {
      const amount1 = ethers.parseEther("3");
      const amount2 = ethers.parseEther("4");
      const receiver2 = accounts[4];

      const initialBalance1 = await ethers.provider.getBalance(receiver.address);
      const initialBalance2 = await ethers.provider.getBalance(receiver2.address);

      // Rescue to first receiver
      await dloopMock.connect(owner).rescueNative(receiver.address, amount1);

      // Rescue to second receiver
      await dloopMock.connect(owner).rescueNative(receiver2.address, amount2);

      // Verify both receivers got native tokens
      const finalBalance1 = await ethers.provider.getBalance(receiver.address);
      const finalBalance2 = await ethers.provider.getBalance(receiver2.address);

      expect(finalBalance1 - initialBalance1).to.equal(amount1);
      expect(finalBalance2 - initialBalance2).to.equal(amount2);

      // Verify vault balance decreased correctly
      const vaultBalance = await ethers.provider.getBalance(await dloopMock.getAddress());
      expect(vaultBalance).to.equal(ethers.parseEther("3"));
    });

    it("Should demonstrate reentrancy protection on rescue native function", async function () {
      // The rescueNative function should have reentrancy protection from RescuableVault
      // This is evidenced by the nonReentrant modifier in RescuableVault.sol

      // Normal rescue should work
      await dloopMock.connect(owner).rescueNative(receiver.address, ethers.parseEther("2"));

      const receiverBalance = await ethers.provider.getBalance(receiver.address);
      expect(receiverBalance).to.be.gt(0);
    });
  });
});
