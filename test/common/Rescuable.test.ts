import { expect } from "chai";
import { ethers } from "hardhat";
import { TestRescuable, TestMintableERC20 } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Rescuable - Emergency Token Recovery", function () {
  async function deployRescueFixture() {
    const [owner, user, recipient, attacker] = await ethers.getSigners();

    // Deploy test token
    const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
    const token = await TokenFactory.deploy("Test Token", "TEST", 18);

    // Deploy second test token for multi-token tests
    const token2 = await TokenFactory.deploy("Test Token 2", "TEST2", 18);

    // Deploy rescuable contract
    const RescuableFactory = await ethers.getContractFactory("TestRescuable");
    const rescuable = await RescuableFactory.connect(owner).deploy();

    return { rescuable, token, token2, owner, user, recipient, attacker };
  }

  describe("Deployment", function () {
    it("✅ should deploy with correct owner", async function () {
      const { rescuable, owner } = await loadFixture(deployRescueFixture);

      expect(await rescuable.owner()).to.equal(owner.address);
    });
  });

  describe("rescueTokens - Basic Functionality", function () {
    it("✅ should rescue tokens stuck in contract to owner", async function () {
      const { rescuable, token, owner, user } = await loadFixture(deployRescueFixture);

      const stuckAmount = ethers.parseUnits("1000", 18);

      // Mint tokens to user and approve rescuable contract
      await token.mint(user.address, stuckAmount);
      await token.connect(user).approve(await rescuable.getAddress(), stuckAmount);

      // Simulate tokens getting stuck
      await rescuable.connect(user).receiveTokens(await token.getAddress(), stuckAmount);

      // Verify tokens are in the contract
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(stuckAmount);

      const ownerBalanceBefore = await token.balanceOf(owner.address);

      // Rescue tokens
      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      // Verify tokens were transferred to owner
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);
      expect(await token.balanceOf(owner.address)).to.equal(ownerBalanceBefore + stuckAmount);
    });

    it("✅ should rescue all balance of token", async function () {
      const { rescuable, token, owner, user } = await loadFixture(deployRescueFixture);

      const amount1 = ethers.parseUnits("500", 18);
      const amount2 = ethers.parseUnits("300", 18);
      const totalAmount = amount1 + amount2;

      // Simulate multiple deposits getting stuck
      await token.mint(user.address, totalAmount);
      await token.connect(user).approve(await rescuable.getAddress(), totalAmount);

      await rescuable.connect(user).receiveTokens(await token.getAddress(), amount1);
      await rescuable.connect(user).receiveTokens(await token.getAddress(), amount2);

      // Verify total stuck amount
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(totalAmount);

      // Rescue all tokens
      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      // Verify all tokens rescued
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);
      expect(await token.balanceOf(owner.address)).to.equal(totalAmount);
    });

    it("✅ should handle rescue when balance is zero", async function () {
      const { rescuable, token, owner } = await loadFixture(deployRescueFixture);

      // No tokens in contract
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);

      // Should not revert, just transfer zero
      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);
    });

    it("✅ should rescue multiple different tokens independently", async function () {
      const { rescuable, token, token2, owner, user } = await loadFixture(deployRescueFixture);

      const amount1 = ethers.parseUnits("1000", 18);
      const amount2 = ethers.parseUnits("2000", 18);

      // Setup: stick both tokens
      await token.mint(user.address, amount1);
      await token.connect(user).approve(await rescuable.getAddress(), amount1);
      await rescuable.connect(user).receiveTokens(await token.getAddress(), amount1);

      await token2.mint(user.address, amount2);
      await token2.connect(user).approve(await rescuable.getAddress(), amount2);
      await rescuable.connect(user).receiveTokens(await token2.getAddress(), amount2);

      // Rescue first token
      await rescuable.connect(owner).rescueTokens(await token.getAddress());
      expect(await token.balanceOf(owner.address)).to.equal(amount1);
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);

      // Second token still stuck
      expect(await token2.balanceOf(await rescuable.getAddress())).to.equal(amount2);

      // Rescue second token
      await rescuable.connect(owner).rescueTokens(await token2.getAddress());
      expect(await token2.balanceOf(owner.address)).to.equal(amount2);
      expect(await token2.balanceOf(await rescuable.getAddress())).to.equal(0);
    });
  });

  describe("Access Control", function () {
    it("❌ should revert when non-owner tries to rescue", async function () {
      const { rescuable, token, attacker } = await loadFixture(deployRescueFixture);

      await expect(rescuable.connect(attacker).rescueTokens(await token.getAddress()))
        .to.be.revertedWithCustomError(rescuable, "OwnableUnauthorizedAccount")
        .withArgs(attacker.address);
    });

    it("✅ should allow new owner to rescue after ownership transfer", async function () {
      const { rescuable, token, owner, user, recipient } = await loadFixture(deployRescueFixture);

      const stuckAmount = ethers.parseUnits("1000", 18);

      // Setup: stick tokens
      await token.mint(user.address, stuckAmount);
      await token.connect(user).approve(await rescuable.getAddress(), stuckAmount);
      await rescuable.connect(user).receiveTokens(await token.getAddress(), stuckAmount);

      // Transfer ownership
      await rescuable.connect(owner).transferOwnership(recipient.address);

      // Old owner cannot rescue
      await expect(rescuable.connect(owner).rescueTokens(await token.getAddress()))
        .to.be.revertedWithCustomError(rescuable, "OwnableUnauthorizedAccount")
        .withArgs(owner.address);

      // New owner can rescue
      await rescuable.connect(recipient).rescueTokens(await token.getAddress());

      expect(await token.balanceOf(recipient.address)).to.equal(stuckAmount);
    });
  });

  describe("Real-world Scenarios", function () {
    it("✅ should rescue tokens sent by mistake", async function () {
      const { rescuable, token, owner, user } = await loadFixture(deployRescueFixture);

      const mistakenlySent = ethers.parseUnits("10000", 18);

      // User accidentally sends tokens to contract
      await token.mint(user.address, mistakenlySent);
      await token.connect(user).transfer(await rescuable.getAddress(), mistakenlySent);

      // Owner can rescue to owner
      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      expect(await token.balanceOf(owner.address)).to.equal(mistakenlySent);
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);
    });

    it("✅ should handle rescue after contract operations", async function () {
      const { rescuable, token, owner, user } = await loadFixture(deployRescueFixture);

      // Simulate normal operations
      const operationAmount = ethers.parseUnits("500", 18);
      await token.mint(user.address, operationAmount);
      await token.connect(user).approve(await rescuable.getAddress(), operationAmount);
      await rescuable.connect(user).receiveTokens(await token.getAddress(), operationAmount);

      // Some dust remains after operations (common in DEX/DeFi contracts)
      const dustAmount = ethers.parseUnits("0.001", 18);
      await token.mint(await rescuable.getAddress(), dustAmount);

      const totalStuck = operationAmount + dustAmount;
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(totalStuck);

      // Rescue all stuck tokens
      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      expect(await token.balanceOf(owner.address)).to.equal(totalStuck);
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);
    });
  });

  describe("Edge Cases", function () {
    it("✅ should handle very small amounts", async function () {
      const { rescuable, token, owner, user } = await loadFixture(deployRescueFixture);

      const tinyAmount = 1n; // 1 wei

      await token.mint(user.address, tinyAmount);
      await token.connect(user).approve(await rescuable.getAddress(), tinyAmount);
      await rescuable.connect(user).receiveTokens(await token.getAddress(), tinyAmount);

      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      expect(await token.balanceOf(owner.address)).to.equal(tinyAmount);
    });

    it("✅ should handle maximum uint256 amounts", async function () {
      const { rescuable, token, owner } = await loadFixture(deployRescueFixture);

      const maxAmount = ethers.MaxUint256;

      // Mint max amount directly to contract (simulate stuck tokens)
      await token.mint(await rescuable.getAddress(), maxAmount);

      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(maxAmount);

      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      expect(await token.balanceOf(owner.address)).to.equal(maxAmount);
      expect(await token.balanceOf(await rescuable.getAddress())).to.equal(0);
    });

    it("✅ should rescue same token multiple times", async function () {
      const { rescuable, token, owner, user } = await loadFixture(deployRescueFixture);

      // First batch
      const amount1 = ethers.parseUnits("100", 18);
      await token.mint(user.address, amount1);
      await token.connect(user).approve(await rescuable.getAddress(), amount1);
      await rescuable.connect(user).receiveTokens(await token.getAddress(), amount1);
      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      // Second batch
      const amount2 = ethers.parseUnits("200", 18);
      await token.mint(user.address, amount2);
      await token.connect(user).approve(await rescuable.getAddress(), amount2);
      await rescuable.connect(user).receiveTokens(await token.getAddress(), amount2);
      await rescuable.connect(owner).rescueTokens(await token.getAddress());

      expect(await token.balanceOf(owner.address)).to.equal(amount1 + amount2);
    });
  });
});
