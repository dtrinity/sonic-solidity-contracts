import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { SDUSDRewardsFixture } from "./fixture";
import { IDStableConversionAdapter } from "../../typechain-types";
import { IERC20 } from "../../typechain-types";
import { deployments } from "hardhat";
import { DUSD_TOKEN_ID } from "../../typescript/deploy-ids";

describe("DStakeRewardManagerDLend", function () {
  let rewardManager: any;
  let rewardsController: any;
  let targetStaticATokenWrapper: string;
  let dLendAssetToClaimFor: string;
  let dStakeCollateralVault: any;
  let dStakeRouter: any;
  let underlyingDStableToken: any;
  let deployerSigner: any;
  let rewardToken: any;

  beforeEach(async function () {
    const fixtures = await SDUSDRewardsFixture();
    rewardManager = fixtures.rewardManager;
    rewardsController = fixtures.rewardsController;
    targetStaticATokenWrapper = fixtures.targetStaticATokenWrapper;
    dLendAssetToClaimFor = fixtures.dLendAssetToClaimFor;
    dStakeCollateralVault = fixtures.collateralVault;
    dStakeRouter = fixtures.router;
    const dusdAddress = fixtures.dStableInfo.address;
    underlyingDStableToken = await ethers.getContractAt(
      "ERC20StablecoinUpgradeable",
      dusdAddress
    );
    deployerSigner = fixtures.deployer;
    rewardToken = fixtures.rewardToken;
  });

  describe("Deployment and Initialization", function () {
    it("should deploy with valid constructor parameters", async function () {
      const zero = ethers.ZeroAddress;

      // Check the collateral vault is set
      const collateralVaultAddr = await rewardManager.dStakeCollateralVault();
      expect(collateralVaultAddr).to.not.equal(zero);

      // Check the router is set
      const routerAddr = await rewardManager.dStakeRouter();
      expect(routerAddr).to.not.equal(zero);

      // Check the rewards controller is set
      const controllerAddr = await rewardManager.dLendRewardsController();
      expect(controllerAddr).to.not.equal(zero);

      // Fixture returned values should also be non-zero
      expect(targetStaticATokenWrapper).to.not.equal(zero);
      expect(dLendAssetToClaimFor).to.not.equal(zero);
      // Verify exchangeAsset matches the underlying dStable address
      const exchangeAsset = await rewardManager.exchangeAsset();
      console.log("exchangeAsset:", exchangeAsset);
      console.log(
        "underlyingDStableToken.target:",
        underlyingDStableToken.target
      );
      console.log(
        "Type of underlyingDStableToken:",
        typeof underlyingDStableToken
      );
      if (underlyingDStableToken) {
        console.log(
          "underlyingDStableToken keys:",
          Object.keys(underlyingDStableToken)
        );
        // Check for .target explicitly being undefined if needed, though .address is the issue
        // if (underlyingDStableToken.target === undefined) {
        //   console.log("underlyingDStableToken.target is explicitly undefined");
        // }
      }
      expect(exchangeAsset).to.equal(underlyingDStableToken.target);

      // Verify roles are assigned correctly after deployment
      const { deployer, user1 } = await getNamedAccounts(); // Get the admin account
      const deployerSigner = await ethers.getSigner(deployer);
      const adminSigner = await ethers.getSigner(user1);

      // Get the DStakeRewardManagerDLend contract instance to check roles
      const rewardManagerContract = await ethers.getContractAt(
        "DStakeRewardManagerDLend",
        rewardManager.target!
      );

      // Check DEFAULT_ADMIN_ROLE for the admin account
      const defaultAdminRole = await rewardManagerContract.DEFAULT_ADMIN_ROLE();
      const hasDefaultAdminRole = await rewardManagerContract.hasRole(
        defaultAdminRole,
        adminSigner.address // Check admin instead of deployer
      );
      expect(hasDefaultAdminRole).to.be.true; // This is the updated assertion

      // Check that deployer no longer has DEFAULT_ADMIN_ROLE
      const deployerHasDefaultAdminRole = await rewardManagerContract.hasRole(
        defaultAdminRole,
        deployerSigner.address
      );
      expect(deployerHasDefaultAdminRole).to.be.false; // Deployer should not have the role

      // Check REWARDS_MANAGER_ROLE for the admin account
      // Add logging before the failing line
      console.log("Before REWARDS_MANAGER_ROLE check:");
      console.log("rewardManagerContract:", rewardManagerContract);
      console.log(
        "Type of rewardManagerContract:",
        typeof rewardManagerContract
      );
      console.log("rewardManager.target:", rewardManager.target);
      // Add logging immediately before REWARDS_MANAGER_ROLE call
      console.log(
        "Immediately before REWARDS_MANAGER_ROLE call:",
        rewardManagerContract
      );
      const rewardsManagerRole =
        await rewardManagerContract.REWARDS_MANAGER_ROLE();
      // Add logging immediately after REWARDS_MANAGER_ROLE call
      console.log(
        "Immediately after REWARDS_MANAGER_ROLE call. rewardsManagerRole:",
        rewardsManagerRole
      );
      // Add logging for adminSigner and its address
      console.log("Before hasRole check:");
      console.log("adminSigner:", adminSigner);
      if (adminSigner) {
        console.log("adminSigner.address:", adminSigner.address);
      }
      const hasRewardsManagerRole = await rewardManagerContract.hasRole(
        rewardsManagerRole,
        adminSigner.address // Check admin instead of deployer
      );
      expect(hasRewardsManagerRole).to.be.true; // This is the updated assertion

      // Check that deployer no longer has REWARDS_MANAGER_ROLE
      const deployerHasRewardsManagerRole = await rewardManagerContract.hasRole(
        rewardsManagerRole,
        deployerSigner.address
      );
      expect(deployerHasRewardsManagerRole).to.be.false; // Deployer should not have the role
    });
  });

  describe("Admin functions - setDLendRewardsController", function () {
    let adminSigner: any;
    let nonAdminSigner: any;
    before(async function () {
      const { user1, user2 } = await getNamedAccounts();
      adminSigner = await ethers.getSigner(user1);
      nonAdminSigner = await ethers.getSigner(user2);
    });

    it("allows DEFAULT_ADMIN_ROLE to update controller", async function () {
      const oldController = await rewardManager.dLendRewardsController();
      const newController = await ethers.Wallet.createRandom().getAddress();
      // user1 (adminSigner) holds DEFAULT_ADMIN_ROLE
      const tx = await rewardManager
        .connect(adminSigner)
        .setDLendRewardsController(newController);
      await tx.wait();
      expect(await rewardManager.dLendRewardsController()).to.equal(
        newController
      );
      await expect(tx)
        .to.emit(rewardManager, "DLendRewardsControllerUpdated")
        .withArgs(oldController, newController);
    });

    it("reverts when updating to zero address", async function () {
      // Admin signer setting to zero address should revert with ZeroAddress
      await expect(
        rewardManager
          .connect(adminSigner)
          .setDLendRewardsController(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(rewardManager, "ZeroAddress");
    });

    it("reverts when non-admin tries to update controller", async function () {
      const randomAddress = await ethers.Wallet.createRandom().getAddress();
      // nonAdminSigner does not have DEFAULT_ADMIN_ROLE
      await expect(
        rewardManager
          .connect(nonAdminSigner)
          .setDLendRewardsController(randomAddress)
      ).to.be.reverted; // missing role
    });
  });

  describe("Admin functions - parameters", function () {
    let adminSigner: any;
    let nonAdminSigner: any;
    before(async function () {
      const { user1, user2 } = await getNamedAccounts();
      adminSigner = await ethers.getSigner(user1);
      nonAdminSigner = await ethers.getSigner(user2);
    });

    it("allows REWARDS_MANAGER_ROLE to update treasury", async function () {
      const oldTreasury = await rewardManager.treasury();
      const signers = await ethers.getSigners();
      const newTreasury = signers[3].address;
      const tx = await rewardManager
        .connect(adminSigner)
        .setTreasury(newTreasury);
      await expect(tx)
        .to.emit(rewardManager, "TreasuryUpdated")
        .withArgs(oldTreasury, newTreasury);
      expect(await rewardManager.treasury()).to.equal(newTreasury);
    });

    it("reverts when non-admin tries to update treasury", async function () {
      const randomAddress = ethers.Wallet.createRandom().address;
      await expect(
        rewardManager.connect(nonAdminSigner).setTreasury(randomAddress)
      ).to.be.reverted;
    });

    it("allows REWARDS_MANAGER_ROLE to update treasuryFeeBps", async function () {
      const oldFee = await rewardManager.treasuryFeeBps();
      const maxFee = await rewardManager.maxTreasuryFeeBps();
      const newFee = maxFee - 1n;
      const tx = await rewardManager
        .connect(adminSigner)
        .setTreasuryFeeBps(newFee);
      await expect(tx)
        .to.emit(rewardManager, "TreasuryFeeBpsUpdated")
        .withArgs(oldFee, newFee);
      expect(await rewardManager.treasuryFeeBps()).to.equal(newFee);
    });

    it("reverts when setting treasuryFeeBps above max", async function () {
      const maxFee = await rewardManager.maxTreasuryFeeBps();
      const invalidFee = maxFee + 1n;
      await expect(
        rewardManager.connect(adminSigner).setTreasuryFeeBps(invalidFee)
      ).to.be.revertedWithCustomError(rewardManager, "TreasuryFeeTooHigh");
    });

    it("allows REWARDS_MANAGER_ROLE to update exchangeThreshold", async function () {
      const oldThreshold = await rewardManager.exchangeThreshold();
      const newThreshold = oldThreshold + 1n;
      const tx = await rewardManager
        .connect(adminSigner)
        .setExchangeThreshold(newThreshold);
      await expect(tx)
        .to.emit(rewardManager, "ExchangeThresholdUpdated")
        .withArgs(oldThreshold, newThreshold);
      expect(await rewardManager.exchangeThreshold()).to.equal(newThreshold);
    });

    it("reverts when setting exchangeThreshold to zero", async function () {
      await expect(
        rewardManager.connect(adminSigner).setExchangeThreshold(0)
      ).to.be.revertedWithCustomError(rewardManager, "ZeroExchangeThreshold");
    });
  });

  describe("Reward Claiming Integration", function () {
    let caller: any;
    let treasuryAddr: string;
    let threshold: bigint;
    const rewardAmount = ethers.parseUnits("50", 6); // 50 USDC

    beforeEach(async function () {
      // Get deployer and caller
      const { deployer, user2 } = await getNamedAccounts();
      const deployerSigner = await ethers.getSigner(deployer);
      caller = await ethers.getSigner(user2);

      // Override treasury to a distinct account to avoid conflict with incentives vault (user1)
      // Use user3 as treasury
      const { user1, user3 } = await getNamedAccounts();
      const adminSigner = await ethers.getSigner(user1);
      await rewardManager.connect(adminSigner).setTreasury(user3);
      treasuryAddr = user3;
      threshold = await rewardManager.exchangeThreshold();

      // Get the Issuer contract instance for dUSD
      const issuerDeployment = await deployments.get(
        DUSD_TOKEN_ID // Assuming DUSD_TOKEN_ID is the correct deployment ID for the real dUSD/Issuer
      );
      const issuer = await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        issuerDeployment.address
      );

      // Grant MINTER_ROLE to the deployer
      const minterRole = await issuer.MINTER_ROLE();
      await issuer.connect(deployerSigner).grantRole(minterRole, deployer);

      // Mint dStable tokens (dUSD) to the deployer
      // Mint a generous amount to ensure sufficient balance for transfers
      const amountToMint = threshold * 100n; // Mint threshold * 100
      await issuer.connect(deployerSigner).mint(deployer, amountToMint);

      // Fund caller with dStable and approve
      await underlyingDStableToken
        .connect(deployerSigner)
        .transfer(caller.address, threshold * 2n);
      await underlyingDStableToken
        .connect(caller)
        .approve(rewardManager.target, threshold * 2n);

      // Fund the reward manager contract with reward tokens for distribution
      await rewardToken
        .connect(deployerSigner)
        .transfer(rewardManager.target, rewardAmount);
    });

    it("Successfully claims a single reward token", async function () {
      const receiver = (await ethers.getSigners())[3].address;
      // Convert balances to JS numbers for test assertions
      const beforeReceiverRaw = await rewardToken.balanceOf(receiver);
      const beforeReceiver = Number(beforeReceiverRaw);
      const beforeTreasuryRaw = await rewardToken.balanceOf(treasuryAddr);
      const beforeTreasury = Number(beforeTreasuryRaw);

      // Fast-forward time to accrue rewards
      await hre.network.provider.request({
        method: "evm_increaseTime",
        params: [50],
      });
      await hre.network.provider.request({ method: "evm_mine", params: [] });
      await rewardManager
        .connect(caller)
        .compoundRewards(threshold, [rewardToken.target], receiver);

      const afterReceiverRaw = await rewardToken.balanceOf(receiver);
      const afterReceiver = Number(afterReceiverRaw);
      const afterTreasuryRaw = await rewardToken.balanceOf(treasuryAddr);
      const afterTreasury = Number(afterTreasuryRaw);

      // Compute actual deltas as numbers
      const deltaReceiver = afterReceiver - beforeReceiver;
      const deltaTreasury = afterTreasury - beforeTreasury;
      const rawClaimed = deltaReceiver + deltaTreasury;
      // Compute expected fee via on-chain logic
      const expectedFee = Number(
        await rewardManager.getTreasuryFee(rawClaimed)
      );

      // Treasury should receive the fee, receiver the remainder
      expect(deltaTreasury).to.equal(expectedFee);
      expect(deltaReceiver).to.equal(rawClaimed - expectedFee);
    });

    it("Successfully claims multiple reward tokens", async function () {
      const receiver = (await ethers.getSigners())[4].address;
      // Convert balances to numbers for test assertions
      const beforeReceiverRawMulti = await rewardToken.balanceOf(receiver);
      const beforeReceiverMulti = Number(beforeReceiverRawMulti);
      const beforeTreasuryRawMulti = await rewardToken.balanceOf(treasuryAddr);
      const beforeTreasuryMulti = Number(beforeTreasuryRawMulti);

      // Fast-forward time to accrue rewards
      await hre.network.provider.request({
        method: "evm_increaseTime",
        params: [50],
      });
      await hre.network.provider.request({ method: "evm_mine", params: [] });
      await rewardManager.connect(caller).compoundRewards(
        threshold,
        [rewardToken.target, rewardToken.target], // Claiming the same token twice
        receiver
      );

      const afterReceiverRawMulti = await rewardToken.balanceOf(receiver);
      const afterReceiverMulti = Number(afterReceiverRawMulti);
      const afterTreasuryRawMulti = await rewardToken.balanceOf(treasuryAddr);
      const afterTreasuryMulti = Number(afterTreasuryRawMulti);

      // Compute actual deltas for multiple claims
      const deltaReceiverMulti = afterReceiverMulti - beforeReceiverMulti;
      const deltaTreasuryMulti = afterTreasuryMulti - beforeTreasuryMulti;
      const rawClaimedMulti = deltaReceiverMulti + deltaTreasuryMulti;
      // Compute expected fee via on-chain logic
      const expectedFeeMulti = Number(
        await rewardManager.getTreasuryFee(rawClaimedMulti)
      );

      // Treasury should receive the fee, receiver the remainder
      expect(deltaTreasuryMulti).to.equal(expectedFeeMulti);
      expect(deltaReceiverMulti).to.equal(rawClaimedMulti - expectedFeeMulti);
    });
  });
});
