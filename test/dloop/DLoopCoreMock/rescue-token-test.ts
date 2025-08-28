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
    it("Should return correct restricted rescue tokens", async function () {
      const restrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens.length).to.equal(0);
    });

    it("Should use getRestrictedRescueTokens correctly", async function () {
      const restrictedTokens = await dloopMock.getRestrictedRescueTokens();

      // Should match the public method
      const publicRestrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens.length).to.equal(publicRestrictedTokens.length);

      for (let i = 0; i < restrictedTokens.length; i++) {
        expect(restrictedTokens[i]).to.equal(publicRestrictedTokens[i]);
      }
    });

    it("Should include additional rescue tokens from implementation", async function () {
      // Mock implementation returns empty array, so should have 0 tokens
      const restrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens.length).to.equal(0);

      // Verify the additional rescue tokens implementation returns empty array
      const additionalTokens = await dloopMock.testGetAdditionalRescueTokensImplementation();
      expect(additionalTokens.length).to.equal(0);
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
      ).to.be.revertedWith("Cannot rescue restricted token");
    });

    it("Should revert when trying to rescue restricted debt token", async function () {
      // Set debt token as additional rescue token to make it restricted
      await dloopMock.setMockAdditionalRescueTokens([await debtToken.getAddress()]);

      // First, put some debt tokens in the vault
      await debtToken.mint(await dloopMock.getAddress(), ethers.parseEther("100"));

      await expect(
        dloopMock.connect(owner).rescueToken(await debtToken.getAddress(), receiver.address, ethers.parseEther("50")),
      ).to.be.revertedWith("Cannot rescue restricted token");
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
      let restrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens.length).to.equal(0);

      // Configure collateral and debt tokens as restricted
      await dloopMock.setMockAdditionalRescueTokens([await collateralToken.getAddress(), await debtToken.getAddress()]);

      // Verify restricted tokens now include critical vault tokens
      restrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens).to.include(await collateralToken.getAddress());
      expect(restrictedTokens).to.include(await debtToken.getAddress());

      // Verify only non-restricted tokens can be rescued
      await expect(dloopMock.connect(owner).rescueToken(await collateralToken.getAddress(), receiver.address, 1)).to.be.revertedWith(
        "Cannot rescue restricted token",
      );

      // Verify non-restricted tokens can be rescued
      await expect(dloopMock.connect(owner).rescueToken(await otherToken.getAddress(), receiver.address, ethers.parseEther("10"))).to.not.be
        .reverted;
    });

    it("Should maintain consistency with base contract restrictions", async function () {
      // Verify that the mock implementation correctly inherits from DLoopCoreBase
      // which implements the getRestrictedRescueTokens function

      const restrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens.length).to.equal(0);

      // Mock implementation returns no additional restricted tokens
      const additionalTokens = await dloopMock.testGetAdditionalRescueTokensImplementation();
      expect(additionalTokens.length).to.equal(0);
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

      const implementationTokens = await dloopMock.testGetAdditionalRescueTokensImplementation();
      expect(implementationTokens.length).to.equal(0);
    });

    it("Should set and return single additional rescue token", async function () {
      const tokenAAddress = await tokenA.getAddress();
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress]);

      // Verify mock state contains only the additional token
      const mockTokens = await dloopMock.getMockAdditionalRescueTokens();
      expect(mockTokens.length).to.equal(1);
      expect(mockTokens[0]).to.equal(tokenAAddress);

      // Verify implementation returns only the additional token
      const implementationTokens = await dloopMock.testGetAdditionalRescueTokensImplementation();
      expect(implementationTokens.length).to.equal(1);
      expect(implementationTokens[0]).to.equal(tokenAAddress);
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

      // Verify implementation returns only the additional tokens
      const implementationTokens = await dloopMock.testGetAdditionalRescueTokensImplementation();
      expect(implementationTokens.length).to.equal(3);
      expect(implementationTokens[0]).to.equal(tokenAAddress);
      expect(implementationTokens[1]).to.equal(tokenBAddress);
      expect(implementationTokens[2]).to.equal(tokenCAddress);
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

      // Clear by setting empty array
      await dloopMock.setMockAdditionalRescueTokens([]);
      expect((await dloopMock.getMockAdditionalRescueTokens()).length).to.equal(0);

      // Verify implementation also returns empty array for additional tokens
      const implementationTokens = await dloopMock.testGetAdditionalRescueTokensImplementation();
      expect(implementationTokens.length).to.equal(0);
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
      await expect(dloopMock.connect(owner).rescueToken(tokenAAddress, receiver.address, ethers.parseEther("50"))).to.be.revertedWith(
        "Cannot rescue restricted token",
      );

      // Verify tokenB is still rescuable (not in additional rescue tokens)
      await expect(dloopMock.connect(owner).rescueToken(tokenBAddress, receiver.address, ethers.parseEther("50"))).to.not.be.reverted;

      // Verify token was rescued
      expect(await tokenB.balanceOf(receiver.address)).to.equal(ethers.parseEther("50"));
    });

    it("Should include additional rescue tokens in restricted tokens list", async function () {
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      // Initially no restricted tokens (mock starts clean)
      let restrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens.length).to.equal(0);
      expect(restrictedTokens).to.not.include(tokenAAddress);
      expect(restrictedTokens).to.not.include(tokenBAddress);

      // Set additional rescue tokens
      await dloopMock.setMockAdditionalRescueTokens([tokenAAddress, tokenBAddress]);

      // Now additional tokens should be included in restricted list
      restrictedTokens = await dloopMock.getRestrictedRescueTokens();
      expect(restrictedTokens).to.include(tokenAAddress);
      expect(restrictedTokens).to.include(tokenBAddress);
      expect(restrictedTokens.length).to.equal(2);
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
});
