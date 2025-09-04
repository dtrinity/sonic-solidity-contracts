import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { ERC20StablecoinUpgradeable } from "../../typechain-types";
import { createDStableFixture, DUSD_CONFIG } from "./fixtures";

describe("ERC20StablecoinUpgradeable", () => {
  let stablecoinContract: ERC20StablecoinUpgradeable;
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  // Set up fixture for dUSD configuration only
  const fixture = createDStableFixture(DUSD_CONFIG);

  beforeEach(async function () {
    await fixture();

    ({ deployer, user1, user2 } = await getNamedAccounts());

    // Get the deployed dUSD contract
    const dUSDAddress = (await hre.deployments.get(DUSD_CONFIG.symbol)).address;
    stablecoinContract = await hre.ethers.getContractAt(
      "ERC20StablecoinUpgradeable",
      dUSDAddress,
      await hre.ethers.getSigner(deployer),
    );
  });

  describe("Initialization", () => {
    it("should initialize with correct name and symbol", async function () {
      const name = await stablecoinContract.name();
      const symbol = await stablecoinContract.symbol();

      assert.equal(name, "dTRINITY USD");
      assert.equal(symbol, "dUSD");
    });

    it("should have 18 decimals", async function () {
      const decimals = await stablecoinContract.decimals();
      assert.equal(decimals, 18n);
    });

    it("should set deployer as default admin", async function () {
      const DEFAULT_ADMIN_ROLE = await stablecoinContract.DEFAULT_ADMIN_ROLE();
      const hasRole = await stablecoinContract.hasRole(
        DEFAULT_ADMIN_ROLE,
        deployer,
      );
      assert.isTrue(hasRole);
    });

    it("should set deployer as pauser", async function () {
      const PAUSER_ROLE = await stablecoinContract.PAUSER_ROLE();
      const hasRole = await stablecoinContract.hasRole(PAUSER_ROLE, deployer);
      assert.isTrue(hasRole);
    });
  });

  describe("Role-based functionality", () => {
    it("should allow minting only by minter role", async function () {
      const MINTER_ROLE = await stablecoinContract.MINTER_ROLE();
      const mintAmount = hre.ethers.parseUnits("1000", 18);

      // Grant minter role to user1
      await stablecoinContract.grantRole(MINTER_ROLE, user1);

      // User1 should be able to mint
      await stablecoinContract
        .connect(await hre.ethers.getSigner(user1))
        .mint(user2, mintAmount);

      // User2 should not be able to mint
      await expect(
        stablecoinContract
          .connect(await hre.ethers.getSigner(user2))
          .mint(user1, mintAmount),
      ).to.be.revertedWithCustomError(
        stablecoinContract,
        "AccessControlUnauthorizedAccount",
      );

      // Verify minted amount
      const balance = await stablecoinContract.balanceOf(user2);
      assert.equal(balance, mintAmount);
    });

    it("should allow pausing only by pauser role", async function () {
      const PAUSER_ROLE = await stablecoinContract.PAUSER_ROLE();

      // Grant pauser role to user1
      await stablecoinContract.grantRole(PAUSER_ROLE, user1);

      // User1 should be able to pause
      await stablecoinContract
        .connect(await hre.ethers.getSigner(user1))
        .pause();

      // Verify paused state
      assert.isTrue(await stablecoinContract.paused());

      // User2 should not be able to unpause
      await expect(
        stablecoinContract.connect(await hre.ethers.getSigner(user2)).unpause(),
      ).to.be.revertedWithCustomError(
        stablecoinContract,
        "AccessControlUnauthorizedAccount",
      );

      // User1 should be able to unpause
      await stablecoinContract
        .connect(await hre.ethers.getSigner(user1))
        .unpause();

      // Verify unpaused state
      assert.isFalse(await stablecoinContract.paused());
    });

    it("should prevent transfers when paused", async function () {
      const MINTER_ROLE = await stablecoinContract.MINTER_ROLE();
      const mintAmount = hre.ethers.parseUnits("1000", 18);
      const transferAmount = hre.ethers.parseUnits("100", 18);

      // Setup: mint some tokens to user1
      await stablecoinContract.grantRole(MINTER_ROLE, deployer);
      await stablecoinContract.mint(user1, mintAmount);

      // Pause the contract
      await stablecoinContract.pause();

      // Attempt transfer while paused
      await expect(
        stablecoinContract
          .connect(await hre.ethers.getSigner(user1))
          .transfer(user2, transferAmount),
      ).to.be.revertedWithCustomError(stablecoinContract, "EnforcedPause");

      // Unpause and verify transfer works
      await stablecoinContract.unpause();
      await stablecoinContract
        .connect(await hre.ethers.getSigner(user1))
        .transfer(user2, transferAmount);

      const balance = await stablecoinContract.balanceOf(user2);
      assert.equal(balance, transferAmount);
    });
  });

  describe("Name and Symbol Update Functionality", () => {
    const newName = "New Token Name";
    const newSymbol = "NTN";

    it("should allow default admin to update name and symbol", async function () {
      await stablecoinContract.setNameAndSymbol(newName, newSymbol);

      const updatedName = await stablecoinContract.name();
      const updatedSymbol = await stablecoinContract.symbol();

      assert.equal(updatedName, newName);
      assert.equal(updatedSymbol, newSymbol);
    });

    it("should prevent non-admin from updating name and symbol", async function () {
      await expect(
        stablecoinContract
          .connect(await hre.ethers.getSigner(user1))
          .setNameAndSymbol("Fail", "FL"),
      ).to.be.revertedWithCustomError(
        stablecoinContract,
        "AccessControlUnauthorizedAccount",
      );
    });
  });
});
