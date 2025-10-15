import { expect } from "chai";
import { ethers } from "hardhat";
import { TestPausable } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Pausable - Emergency Pause Functionality", function () {
  async function deployPausableFixture() {
    const [owner, user, attacker] = await ethers.getSigners();

    // Deploy pausable contract
    const PausableFactory = await ethers.getContractFactory("TestPausable");
    const pausable = await PausableFactory.connect(owner).deploy();

    return { pausable, owner, user, attacker };
  }

  describe("Deployment", function () {
    it("✅ should deploy with correct owner", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      expect(await pausable.owner()).to.equal(owner.address);
    });

    it("✅ should initialize in unpaused state", async function () {
      const { pausable } = await loadFixture(deployPausableFixture);

      expect(await pausable.paused()).to.equal(false);
    });
  });

  describe("Pause Functionality", function () {
    it("✅ should allow owner to pause contract", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      await expect(pausable.connect(owner).pause()).to.emit(pausable, "Paused").withArgs(owner.address);

      expect(await pausable.paused()).to.equal(true);
    });

    it("✅ should allow owner to unpause contract", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      // First pause
      await pausable.connect(owner).pause();
      expect(await pausable.paused()).to.equal(true);

      // Then unpause
      await expect(pausable.connect(owner).unpause()).to.emit(pausable, "Unpaused").withArgs(owner.address);

      expect(await pausable.paused()).to.equal(false);
    });

    it("❌ should revert when owner tries to pause already paused contract", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      await pausable.connect(owner).pause();

      await expect(pausable.connect(owner).pause()).to.be.revertedWithCustomError(pausable, "EnforcedPause");
    });

    it("❌ should revert when owner tries to unpause non-paused contract", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      await expect(pausable.connect(owner).unpause()).to.be.revertedWithCustomError(pausable, "ExpectedPause");
    });

    it("✅ should allow multiple pause/unpause cycles", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      // Cycle 1
      await pausable.connect(owner).pause();
      expect(await pausable.paused()).to.equal(true);
      await pausable.connect(owner).unpause();
      expect(await pausable.paused()).to.equal(false);

      // Cycle 2
      await pausable.connect(owner).pause();
      expect(await pausable.paused()).to.equal(true);
      await pausable.connect(owner).unpause();
      expect(await pausable.paused()).to.equal(false);
    });
  });

  describe("Access Control", function () {
    it("❌ should revert when non-owner tries to pause", async function () {
      const { pausable, attacker } = await loadFixture(deployPausableFixture);

      await expect(pausable.connect(attacker).pause()).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("❌ should revert when non-owner tries to unpause", async function () {
      const { pausable, owner, attacker } = await loadFixture(deployPausableFixture);

      // Owner pauses first
      await pausable.connect(owner).pause();

      // Attacker tries to unpause
      await expect(pausable.connect(attacker).unpause()).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("✅ should allow new owner to pause/unpause after ownership transfer", async function () {
      const { pausable, owner, user } = await loadFixture(deployPausableFixture);

      // Transfer ownership
      await pausable.connect(owner).transferOwnership(user.address);

      // Old owner cannot pause
      await expect(pausable.connect(owner).pause()).to.be.revertedWith("Ownable: caller is not the owner");

      // New owner can pause
      await expect(pausable.connect(user).pause()).to.emit(pausable, "Paused").withArgs(user.address);

      expect(await pausable.paused()).to.equal(true);

      // New owner can unpause
      await expect(pausable.connect(user).unpause()).to.emit(pausable, "Unpaused").withArgs(user.address);

      expect(await pausable.paused()).to.equal(false);
    });
  });

  describe("whenNotPaused Modifier", function () {
    it("✅ should allow operation when not paused", async function () {
      const { pausable, user } = await loadFixture(deployPausableFixture);

      expect(await pausable.paused()).to.equal(false);

      await expect(pausable.connect(user).performOperation(100)).to.emit(pausable, "OperationPerformed").withArgs(user.address, 100);

      expect(await pausable.operationCount()).to.equal(1);
    });

    it("❌ should revert operation when paused", async function () {
      const { pausable, owner, user } = await loadFixture(deployPausableFixture);

      // Pause the contract
      await pausable.connect(owner).pause();

      // Operation should fail
      await expect(pausable.connect(user).performOperation(100)).to.be.revertedWithCustomError(pausable, "EnforcedPause");

      expect(await pausable.operationCount()).to.equal(0);
    });

    it("✅ should allow operation again after unpause", async function () {
      const { pausable, owner, user } = await loadFixture(deployPausableFixture);

      // Pause and try operation
      await pausable.connect(owner).pause();
      await expect(pausable.connect(user).performOperation(100)).to.be.revertedWithCustomError(pausable, "EnforcedPause");

      // Unpause and retry
      await pausable.connect(owner).unpause();
      await expect(pausable.connect(user).performOperation(100)).to.emit(pausable, "OperationPerformed").withArgs(user.address, 100);

      expect(await pausable.operationCount()).to.equal(1);
    });
  });

  describe("whenPaused Modifier", function () {
    it("✅ should allow emergency operation only when paused", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      // Should fail when not paused
      await expect(pausable.emergencyOperation()).to.be.revertedWithCustomError(pausable, "ExpectedPause");

      // Pause and retry
      await pausable.connect(owner).pause();
      expect(await pausable.emergencyOperation()).to.equal(true);
    });

    it("❌ should revert emergency operation when not paused", async function () {
      const { pausable } = await loadFixture(deployPausableFixture);

      expect(await pausable.paused()).to.equal(false);

      await expect(pausable.emergencyOperation()).to.be.revertedWithCustomError(pausable, "ExpectedPause");
    });
  });

  describe("Functions Without Pause Modifier", function () {
    it("✅ should work regardless of pause state", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      // Works when not paused
      expect(await pausable.alwaysWorkingFunction()).to.equal(true);

      // Pause contract
      await pausable.connect(owner).pause();

      // Still works when paused
      expect(await pausable.alwaysWorkingFunction()).to.equal(true);
    });
  });

  describe("Event Emissions", function () {
    it("✅ should emit Paused event with correct parameters", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      await expect(pausable.connect(owner).pause()).to.emit(pausable, "Paused").withArgs(owner.address);
    });

    it("✅ should emit Unpaused event with correct parameters", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      await pausable.connect(owner).pause();

      await expect(pausable.connect(owner).unpause()).to.emit(pausable, "Unpaused").withArgs(owner.address);
    });
  });

  describe("Security Scenarios", function () {
    it("🛡️ should stop all pausable operations during attack", async function () {
      const { pausable, owner, user, attacker } = await loadFixture(deployPausableFixture);

      // Normal operations work
      await pausable.connect(user).performOperation(100);
      expect(await pausable.operationCount()).to.equal(1);

      // Attack detected - owner pauses
      await pausable.connect(owner).pause();

      // All pausable operations are blocked
      await expect(pausable.connect(user).performOperation(200)).to.be.revertedWithCustomError(pausable, "EnforcedPause");

      await expect(pausable.connect(attacker).performOperation(300)).to.be.revertedWithCustomError(pausable, "EnforcedPause");

      // Operation count unchanged
      expect(await pausable.operationCount()).to.equal(1);

      // After issue resolved, unpause
      await pausable.connect(owner).unpause();

      // Operations work again
      await pausable.connect(user).performOperation(200);
      expect(await pausable.operationCount()).to.equal(2);
    });

    it("🛡️ should allow immediate pause in emergency", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      // Emergency detected - pause immediately
      const tx = await pausable.connect(owner).pause();
      await tx.wait();

      // Contract is paused in the next block
      expect(await pausable.paused()).to.equal(true);

      // All operations blocked immediately
      await expect(pausable.performOperation(100)).to.be.revertedWithCustomError(pausable, "EnforcedPause");
    });

    it("🛡️ should maintain pause state across multiple transactions", async function () {
      const { pausable, owner, user } = await loadFixture(deployPausableFixture);

      // Pause
      await pausable.connect(owner).pause();

      // Multiple failed attempts
      for (let i = 0; i < 5; i++) {
        await expect(pausable.connect(user).performOperation(i)).to.be.revertedWithCustomError(pausable, "EnforcedPause");
      }

      // Still paused
      expect(await pausable.paused()).to.equal(true);
      expect(await pausable.operationCount()).to.equal(0);
    });
  });

  describe("State Consistency", function () {
    it("✅ should maintain correct pause state", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      // Initial state
      expect(await pausable.paused()).to.equal(false);

      // After pause
      await pausable.connect(owner).pause();
      expect(await pausable.paused()).to.equal(true);

      // After unpause
      await pausable.connect(owner).unpause();
      expect(await pausable.paused()).to.equal(false);
    });

    it("✅ should query pause state without side effects", async function () {
      const { pausable, owner } = await loadFixture(deployPausableFixture);

      const initialState = await pausable.paused();

      // Multiple queries
      for (let i = 0; i < 10; i++) {
        expect(await pausable.paused()).to.equal(initialState);
      }

      // State unchanged
      expect(await pausable.paused()).to.equal(initialState);
    });
  });
});
