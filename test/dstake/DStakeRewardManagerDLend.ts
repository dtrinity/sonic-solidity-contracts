import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { SDUSDRewardsFixture as fixture } from "./fixture";
import { IDStableConversionAdapter } from "../../typechain-types";
import { IERC20 } from "../../typechain-types";

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
    const fixtures = await fixture();
    rewardManager = fixtures.rewardManager;
    rewardsController = fixtures.rewardsController;
    targetStaticATokenWrapper = fixtures.targetStaticATokenWrapper;
    dLendAssetToClaimFor = fixtures.dLendAssetToClaimFor;
    dStakeCollateralVault = fixtures.collateralVault;
    dStakeRouter = fixtures.router;
    underlyingDStableToken = fixtures.dStableToken;
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
      expect(exchangeAsset).to.equal(underlyingDStableToken.address);
      // Verify deployer has DEFAULT_ADMIN_ROLE and REWARDS_MANAGER_ROLE
      const signers = await ethers.getSigners();
      const deployer = signers[0].address;
      const DEFAULT_ADMIN_ROLE = await rewardManager.DEFAULT_ADMIN_ROLE();
      expect(await rewardManager.hasRole(DEFAULT_ADMIN_ROLE, deployer)).to.be
        .true;
      const REWARDS_MANAGER_ROLE = await rewardManager.REWARDS_MANAGER_ROLE();
      expect(await rewardManager.hasRole(REWARDS_MANAGER_ROLE, deployer)).to.be
        .true;
    });
  });

  describe("Admin functions - setDLendRewardsController", function () {
    let adminSigner: any;
    let nonAdminSigner: any;
    before(async function () {
      const signers = await ethers.getSigners();
      // NamedAccounts: deployer is signers[0], user1 (initial admin) is signers[1]
      adminSigner = signers[1];
      // nonAdmin is a signer without DEFAULT_ADMIN_ROLE
      nonAdminSigner = signers[2];
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
      const signers = await ethers.getSigners();
      // NamedAccounts: user1 holds both DEFAULT_ADMIN_ROLE and REWARDS_MANAGER_ROLE
      adminSigner = signers[1];
      // nonAdmin is a signer without these roles
      nonAdminSigner = signers[2];
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
    let mockController: any;
    let deployer: string;
    let caller: any;
    let treasuryAddr: string;
    let threshold: bigint;
    const rewardAmount = ethers.parseUnits("50", 6); // 50 USDC

    before(async function () {
      // Get deployer and caller
      const { deployer: deployerAddr } = await getNamedAccounts();
      deployer = deployerAddr;
      const deployerSigner = await ethers.getSigner(deployer);
      const signers = await ethers.getSigners();
      caller = signers[2];

      // Deploy mock rewards controller
      const MockFactory = await ethers.getContractFactory(
        "MockLendRewardsController",
        deployerSigner
      );
      mockController = await MockFactory.deploy(rewardAmount);
      await mockController.deployed();

      // Fund mock controller with reward tokens
      await rewardToken
        .connect(deployerSigner)
        .transfer(mockController.address, rewardAmount * 10n);

      // Replace the controller in reward manager
      await rewardManager
        .connect(deployerSigner)
        .setDLendRewardsController(mockController.address);

      treasuryAddr = await rewardManager.treasury();
      threshold = await rewardManager.exchangeThreshold();

      // Fund caller with dStable and approve
      await underlyingDStableToken
        .connect(deployerSigner)
        .transfer(caller.address, threshold * 2n);
      await underlyingDStableToken
        .connect(caller)
        .approve(rewardManager.address, threshold * 2n);
    });

    it("Successfully claims a single reward token", async function () {
      const receiver = (await ethers.getSigners())[3].address;
      const beforeReceiver = await rewardToken.balanceOf(receiver);
      const beforeTreasury = await rewardToken.balanceOf(treasuryAddr);

      await rewardManager
        .connect(caller)
        .compoundRewards(threshold, [rewardToken.address], receiver);

      const afterReceiver = await rewardToken.balanceOf(receiver);
      const afterTreasury = await rewardToken.balanceOf(treasuryAddr);

      // Compute expected fee and net
      const feeBps = await rewardManager.treasuryFeeBps();
      const expectedFee = (rewardAmount * feeBps) / 10000n;
      const expectedNet = rewardAmount - expectedFee;

      expect(afterReceiver - beforeReceiver).to.equal(expectedNet);
      expect(afterTreasury - beforeTreasury).to.equal(expectedFee);
    });

    it("Successfully claims multiple reward tokens", async function () {
      const receiver = (await ethers.getSigners())[4].address;
      const before = await rewardToken.balanceOf(receiver);

      await rewardManager
        .connect(caller)
        .compoundRewards(
          threshold,
          [rewardToken.address, rewardToken.address],
          receiver
        );

      const after = await rewardToken.balanceOf(receiver);
      const feeBps = await rewardManager.treasuryFeeBps();
      const expectedPer = rewardAmount - (rewardAmount * feeBps) / 10000n;

      expect(after - before).to.equal(expectedPer * 2n);
    });

    it("No rewards earned/claimed", async function () {
      // Set mock to zero rewards
      await mockController.setRewardAmount(0);
      const receiver = (await ethers.getSigners())[5].address;
      const before = await rewardToken.balanceOf(receiver);

      await rewardManager
        .connect(caller)
        .compoundRewards(threshold, [rewardToken.address], receiver);

      const after = await rewardToken.balanceOf(receiver);
      expect(after).to.equal(before);
    });

    describe("ProcessExchangeAssetDeposit via compoundRewards", function () {
      it("should convert and deposit dStable into default vault asset", async function () {
        // Ensure mock controller returns zero rewards
        await mockController.setRewardAmount(0);
        // Determine default deposit asset and adapter
        const defaultAsset = await dStakeRouter.defaultDepositVaultAsset();
        const adapterAddress =
          await dStakeRouter.vaultAssetToAdapter(defaultAsset);
        const adapter = await ethers.getContractAt(
          "IDStableConversionAdapter",
          adapterAddress
        );
        // Preview expected vault amount
        const [vaultAsset, expectedVaultAmt] =
          await adapter.previewConvertToVaultAsset(threshold);
        // Get ERC20 interface for vault asset
        const vaultERC20 = await ethers.getContractAt(
          "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
          vaultAsset
        );
        const initialVaultBalance = await vaultERC20.balanceOf(
          dStakeCollateralVault.address
        );
        // Compound rewards (deposit dStable)
        const receiver = caller.address;
        await rewardManager
          .connect(caller)
          .compoundRewards(threshold, [rewardToken.address], receiver);
        const finalVaultBalance = await vaultERC20.balanceOf(
          dStakeCollateralVault.address
        );
        expect(finalVaultBalance - initialVaultBalance).to.equal(
          expectedVaultAmt
        );
      });
    });
  });
});
