import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { assert, expect } from "chai";
import hre from "hardhat";

describe("TestERC20FlashMintable", () => {
  let token: any;
  let user1: any;
  let user2: any;

  /**
   * Deploy test token fixture for testing
   */
  async function deployTestTokenFixture(): Promise<{
    token: any;
    deployer: any;
    user1: any;
    user2: any;
  }> {
    const [deployerSigner, user1Signer, user2Signer] = await hre.ethers.getSigners();

    const TestERC20FlashMintableFactory = await hre.ethers.getContractFactory("TestERC20FlashMintable");
    const testToken = await TestERC20FlashMintableFactory.deploy("Test Flash Mintable Token", "TFMT", 18);
    await testToken.waitForDeployment();

    return {
      token: testToken,
      deployer: deployerSigner,
      user1: user1Signer,
      user2: user2Signer,
    };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployTestTokenFixture);
    token = fixture.token;
    user1 = fixture.user1;
    user2 = fixture.user2;
  });

  describe("Basic ERC20 functionality", () => {
    it("should have correct name, symbol, and decimals", async function () {
      const name = await token.name();
      const symbol = await token.symbol();
      const decimals = await token.decimals();

      assert.equal(name, "Test Flash Mintable Token");
      assert.equal(symbol, "TFMT");
      assert.equal(decimals, 18);
    });

    it("should start with zero total supply", async function () {
      const totalSupply = await token.totalSupply();
      assert.equal(totalSupply, 0n);
    });
  });

  describe("Minting functionality", () => {
    it("should allow minting tokens", async function () {
      const mintAmount = hre.ethers.parseUnits("1000", 18);

      await token.mint(user1.address, mintAmount);

      const balance = await token.balanceOf(user1.address);
      const totalSupply = await token.totalSupply();

      assert.equal(balance, mintAmount);
      assert.equal(totalSupply, mintAmount);
    });

    it("should allow multiple mints", async function () {
      const mintAmount1 = hre.ethers.parseUnits("500", 18);
      const mintAmount2 = hre.ethers.parseUnits("300", 18);

      await token.mint(user1.address, mintAmount1);
      await token.mint(user2.address, mintAmount2);

      const balance1 = await token.balanceOf(user1.address);
      const balance2 = await token.balanceOf(user2.address);
      const totalSupply = await token.totalSupply();

      assert.equal(balance1, mintAmount1);
      assert.equal(balance2, mintAmount2);
      assert.equal(totalSupply, mintAmount1 + mintAmount2);
    });
  });

  describe("Burning functionality", () => {
    beforeEach(async function () {
      const mintAmount = hre.ethers.parseUnits("1000", 18);
      await token.mint(user1.address, mintAmount);
    });

    it("should allow burning own tokens", async function () {
      const burnAmount = hre.ethers.parseUnits("300", 18);
      const initialBalance = await token.balanceOf(user1.address);

      await token.connect(user1).burn(burnAmount);

      const finalBalance = await token.balanceOf(user1.address);
      assert.equal(finalBalance, initialBalance - burnAmount);
    });

    it("should allow burning from approved account", async function () {
      const burnAmount = hre.ethers.parseUnits("200", 18);
      const initialBalance = await token.balanceOf(user1.address);

      // Approve user2 to spend user1's tokens
      await token.connect(user1).approve(user2.address, burnAmount);

      // user2 burns from user1's account
      await token.connect(user2).burnFrom(user1.address, burnAmount);

      const finalBalance = await token.balanceOf(user1.address);
      assert.equal(finalBalance, initialBalance - burnAmount);
    });

    it("should revert when burning more than balance", async function () {
      const burnAmount = hre.ethers.parseUnits("2000", 18); // More than minted

      await expect(token.connect(user1).burn(burnAmount)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });

  describe("Flash loan functionality", () => {
    it("should support flash loans for the token itself", async function () {
      const flashAmount = hre.ethers.parseUnits("1000", 18);

      const maxLoan = await token.maxFlashLoan(await token.getAddress());
      assert.isTrue(maxLoan >= flashAmount);
    });

    it("should return zero max loan for other tokens", async function () {
      const maxLoan = await token.maxFlashLoan(user1.address); // Random address
      assert.equal(maxLoan, 0n);
    });

    it("should return zero flash fee", async function () {
      const flashAmount = hre.ethers.parseUnits("1000", 18);
      const fee = await token.flashFee(await token.getAddress(), flashAmount);
      assert.equal(fee, 0n);
    });

    it("should revert flash fee for unsupported token", async function () {
      const flashAmount = hre.ethers.parseUnits("1000", 18);

      await expect(token.flashFee(user1.address, flashAmount)).to.be.revertedWithCustomError(token, "ERC3156UnsupportedToken");
    });

    it("should successfully execute flash loan", async function () {
      // Deploy a simple flash borrower contract
      const FlashBorrowerFactory = await hre.ethers.getContractFactory("TestFlashBorrower");
      const flashBorrower = await FlashBorrowerFactory.deploy();
      await flashBorrower.waitForDeployment();

      const flashAmount = hre.ethers.parseUnits("1000", 18);
      const tokenAddress = await token.getAddress();

      // Execute flash loan
      const tx = await token.flashLoan(await flashBorrower.getAddress(), tokenAddress, flashAmount, "0x");

      // Wait for transaction to complete
      await tx.wait();

      // Check that total supply is back to zero (no fee)
      const totalSupply = await token.totalSupply();
      assert.equal(totalSupply, 0n);
    });

    it("should revert if flash loan amount exceeds max loan", async function () {
      const FlashBorrowerFactory = await hre.ethers.getContractFactory("TestFlashBorrower");
      const flashBorrower = await FlashBorrowerFactory.deploy();
      await flashBorrower.waitForDeployment();

      // Try to flash loan more than max (type(uint256).max - totalSupply)
      const maxAmount = 2n ** 256n - 1n; // This should exceed max loan
      const tokenAddress = await token.getAddress();

      // First mint some tokens to reduce max loan
      await token.mint(user1.address, hre.ethers.parseUnits("1", 18));

      await expect(token.flashLoan(await flashBorrower.getAddress(), tokenAddress, maxAmount, "0x")).to.be.revertedWithCustomError(
        token,
        "ERC3156ExceededMaxLoan",
      );
    });
  });

  describe("Transfer functionality", () => {
    beforeEach(async function () {
      const mintAmount = hre.ethers.parseUnits("1000", 18);
      await token.mint(user1.address, mintAmount);
    });

    it("should allow transfers", async function () {
      const transferAmount = hre.ethers.parseUnits("200", 18);

      await token.connect(user1).transfer(user2.address, transferAmount);

      const balance1 = await token.balanceOf(user1.address);
      const balance2 = await token.balanceOf(user2.address);

      assert.equal(balance1, hre.ethers.parseUnits("800", 18));
      assert.equal(balance2, transferAmount);
    });
  });
});
