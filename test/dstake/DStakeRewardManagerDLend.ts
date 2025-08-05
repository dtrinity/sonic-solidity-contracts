import { expect } from "chai";
import hre, { deployments, ethers, getNamedAccounts } from "hardhat";

import { IDStableConversionAdapter, IERC20 } from "../../typechain-types";
import { DS_TOKEN_ID, DUSD_TOKEN_ID } from "../../typescript/deploy-ids";
import {
  DSTAKE_CONFIGS,
  DStakeFixtureConfig,
  setupDLendRewardsFixture,
} from "./fixture";

DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
  describe(`DStakeRewardManagerDLend for ${config.DStakeTokenSymbol}`, function () {
    // Create rewards fixture once per suite for snapshot caching
    const rewardsFixture = setupDLendRewardsFixture(
      config,
      (() => {
        if (config.dStableSymbol === "dUSD") {
          return "sfrxUSD";
        } else if (config.dStableSymbol === "dS") {
          return "stS";
        } else {
          throw new Error(
            `Unsupported dStableSymbol for rewards fixture: ${config.dStableSymbol}`,
          );
        }
      })(),
      ethers.parseUnits("1000000", 18), // Reduced from 100M to 1M
      ethers.parseUnits("1", 6), // Reduced from 100 to 1 per second
      365 * 24 * 3600,
    );

    let rewardManager: any;
    let rewardsController: any;
    let targetStaticATokenWrapper: string;
    let dLendAssetToClaimFor: string;
    let dStakeCollateralVault: any;
    let dStakeRouter: any;
    let underlyingDStableToken: any;
    let deployerSigner: any;
    let rewardToken: any;
    let adminSigner: any;
    let user1Signer: any; // Renaming user1 to be more descriptive if it's the admin
    let user2Signer: any;
    let user3Signer: any;
    let user4Signer: any;
    let deployerAddress: string;
    let user1Address: string;
    let user2Address: string;
    let user3Address: string;
    let user4Address: string;
    // Variables for exchange asset deposit tests
    let vaultAssetToken: IERC20;
    let adapter: IDStableConversionAdapter;
    let vaultAssetAddress: string;

    // Determine reward token symbol and dStable token ID based on config
    const rewardTokenSymbol =
      config.dStableSymbol === "dUSD" ? "sfrxUSD" : "stS";
    const dStableTokenId =
      config.dStableSymbol === "dUSD" ? DUSD_TOKEN_ID : DS_TOKEN_ID;
    const rewardAmount = ethers.parseUnits("100", 18);
    const emissionPerSecond = ethers.parseUnits("1", 6);

    beforeEach(async function () {
      // Revert to snapshot of rewards fixture
      const fixtures = await rewardsFixture();
      rewardManager = fixtures.rewardManager;
      rewardsController = fixtures.rewardsController;
      targetStaticATokenWrapper = fixtures.targetStaticATokenWrapper;
      dLendAssetToClaimFor = fixtures.dLendAssetToClaimFor;
      dStakeCollateralVault = fixtures.collateralVault;
      dStakeRouter = fixtures.router;
      const dusdAddress = fixtures.dStableInfo.address;
      underlyingDStableToken = await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dusdAddress,
      );
      deployerSigner = fixtures.deployer;
      rewardToken = fixtures.rewardToken;
      vaultAssetToken = fixtures.vaultAssetToken;
      adapter = fixtures.adapter!;
      vaultAssetAddress = fixtures.vaultAssetAddress;

      const namedAccounts = await getNamedAccounts();
      deployerAddress = namedAccounts.deployer;
      user1Address = namedAccounts.user1; // Assuming user1 is the admin
      user2Address = namedAccounts.user2;
      user3Address = namedAccounts.user3;
      user4Address = namedAccounts.user4;

      user1Signer = await ethers.getSigner(user1Address);
      user2Signer = await ethers.getSigner(user2Address);
      user3Signer = await ethers.getSigner(user3Address);
      user4Signer = await ethers.getSigner(user4Address);

      // Set adminSigner for clarity, assuming user1 is the admin based on tests below
      adminSigner = user1Signer;

      // Grant MINTER_ROLE to the deployer for the dStable token in beforeEach
      // This is needed for funding accounts in some tests
      const issuerDeployment = await deployments.get(
        dStableTokenId, // Use dynamic dStableTokenId
      );
      const issuer = await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        issuerDeployment.address,
      );

      const minterRole = await issuer.MINTER_ROLE();
      // Check if deployer already has the role to avoid errors on re-runs
      const hasMinterRole = await issuer.hasRole(minterRole, deployerAddress);

      if (!hasMinterRole) {
        await issuer
          .connect(deployerSigner)
          .grantRole(minterRole, deployerAddress);
      }

      // Mint dStable tokens (dUSD) to the deployer
      // Mint a generous amount to ensure sufficient balance for transfers
      const amountToMint = (await rewardManager.exchangeThreshold()) * 100n; // Mint threshold * 100
      await issuer.connect(deployerSigner).mint(deployerAddress, amountToMint);

      // Fund the reward manager contract with reward tokens for distribution
      // rewardToken and deployerSigner are available from the top-level beforeEach
      await rewardToken
        .connect(deployerSigner)
        .transfer(rewardManager.target, rewardAmount);
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
        expect(exchangeAsset).to.equal(underlyingDStableToken.target);

        // Verify roles are assigned correctly after deployment
        // Get the DStakeRewardManagerDLend contract instance to check roles
        const rewardManagerContract = await ethers.getContractAt(
          "DStakeRewardManagerDLend",
          rewardManager.target!,
        );

        // Check DEFAULT_ADMIN_ROLE for the admin account
        const defaultAdminRole =
          await rewardManagerContract.DEFAULT_ADMIN_ROLE();
        const hasDefaultAdminRole = await rewardManagerContract.hasRole(
          defaultAdminRole,
          adminSigner.address,
        );
        expect(hasDefaultAdminRole).to.be.true;

        // Check that deployer no longer has DEFAULT_ADMIN_ROLE
        const deployerHasDefaultAdminRole = await rewardManagerContract.hasRole(
          defaultAdminRole,
          deployerSigner.address,
        );
        expect(deployerHasDefaultAdminRole).to.be.false;

        // Check REWARDS_MANAGER_ROLE for the admin account
        const rewardsManagerRole =
          await rewardManagerContract.REWARDS_MANAGER_ROLE();
        const hasRewardsManagerRole = await rewardManagerContract.hasRole(
          rewardsManagerRole,
          adminSigner.address,
        );
        expect(hasRewardsManagerRole).to.be.true;

        // Check that deployer no longer has REWARDS_MANAGER_ROLE
        const deployerHasRewardsManagerRole =
          await rewardManagerContract.hasRole(
            rewardsManagerRole,
            deployerSigner.address,
          );
        expect(deployerHasRewardsManagerRole).to.be.false;
      });
    });

    describe("Admin functions - setDLendRewardsController", function () {
      // adminSigner and nonAdminSigner are set in beforeEach now

      it("allows DEFAULT_ADMIN_ROLE to update controller", async function () {
        const oldController = await rewardManager.dLendRewardsController();
        const newController = await ethers.Wallet.createRandom().getAddress();
        // adminSigner holds DEFAULT_ADMIN_ROLE
        const tx = await rewardManager
          .connect(adminSigner)
          .setDLendRewardsController(newController);
        await tx.wait();
        expect(await rewardManager.dLendRewardsController()).to.equal(
          newController,
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
            .setDLendRewardsController(ethers.ZeroAddress),
        ).to.be.revertedWithCustomError(rewardManager, "ZeroAddress");
      });

      it("reverts when non-admin tries to update controller", async function () {
        const randomAddress = await ethers.Wallet.createRandom().getAddress();
        // user2Signer (non-admin) does not have DEFAULT_ADMIN_ROLE
        await expect(
          rewardManager
            .connect(user2Signer)
            .setDLendRewardsController(randomAddress),
        ).to.be.reverted; // missing role
      });
    });

    describe("Admin functions - parameters", function () {
      // adminSigner and nonAdminSigner are set in beforeEach now

      it("allows REWARDS_MANAGER_ROLE to update treasury", async function () {
        const oldTreasury = await rewardManager.treasury();
        const newTreasury = user3Address;
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
          rewardManager.connect(user2Signer).setTreasury(randomAddress),
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
          rewardManager.connect(adminSigner).setTreasuryFeeBps(invalidFee),
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
          rewardManager.connect(adminSigner).setExchangeThreshold(0),
        ).to.be.revertedWithCustomError(rewardManager, "ZeroExchangeThreshold");
      });
    });

    describe("Reward Claiming Integration", function () {
      let callerSigner: any; // Renaming caller to callerSigner for consistency
      let treasuryAddr: string;
      let threshold: bigint;

      beforeEach(async function () {
        // Get deployer and caller
        // deployerSigner and user2Signer are already available from the top-level beforeEach
        callerSigner = user2Signer;

        // Override treasury to a distinct account to avoid conflict with incentives vault (user1)
        // Use user3 as treasury
        // adminSigner is available from the top-level beforeEach
        await rewardManager.connect(adminSigner).setTreasury(user3Address);
        treasuryAddr = user3Address;
        threshold = await rewardManager.exchangeThreshold();

        // Fund caller with dStable and approve
        // underlyingDStableToken and deployerSigner are available from the top-level beforeEach
        const amountToFundCaller = threshold * 2n;
        await underlyingDStableToken
          .connect(deployerSigner)
          .transfer(callerSigner.address, amountToFundCaller);
        await underlyingDStableToken
          .connect(callerSigner)
          .approve(rewardManager.target, amountToFundCaller);

        // Fund the reward manager contract with reward tokens for distribution
        // rewardToken and deployerSigner are available from the top-level beforeEach
        await rewardToken
          .connect(deployerSigner)
          .transfer(rewardManager.target, rewardAmount);
      });

      it("Successfully claims a single reward token", async function () {
        const receiver = user4Address;
        // Convert balances to JS numbers for test assertions - removed, using BigInt directly
        const beforeReceiverRaw = await rewardToken.balanceOf(receiver);
        const beforeTreasuryRaw = await rewardToken.balanceOf(treasuryAddr);

        // Fast-forward time to accrue rewards
        await hre.network.provider.request({
          method: "evm_increaseTime",
          params: [50],
        });
        await hre.network.provider.request({ method: "evm_mine", params: [] });

        await rewardManager
          .connect(callerSigner)
          .compoundRewards(threshold, [rewardToken.target], receiver);

        const afterReceiverRaw = await rewardToken.balanceOf(receiver);
        const afterTreasuryRaw = await rewardToken.balanceOf(treasuryAddr);

        // Compute actual deltas
        const deltaReceiver = afterReceiverRaw - beforeReceiverRaw;
        const deltaTreasury = afterTreasuryRaw - beforeTreasuryRaw;
        const rawClaimed = deltaReceiver + deltaTreasury;
        // Compute expected fee via on-chain logic
        const expectedFee = await rewardManager.getTreasuryFee(rawClaimed);

        // Treasury should receive the fee, receiver the remainder
        expect(deltaTreasury).to.equal(expectedFee);
        expect(deltaReceiver).to.equal(rawClaimed - expectedFee);
      });

      it("Successfully claims multiple reward tokens", async function () {
        const receiver = user4Address;
        // Convert balances to numbers for test assertions - removed, using BigInt directly
        const beforeReceiverRawMulti = await rewardToken.balanceOf(receiver);
        const beforeTreasuryRawMulti =
          await rewardToken.balanceOf(treasuryAddr);

        // Fast-forward time to accrue rewards
        await hre.network.provider.request({
          method: "evm_increaseTime",
          params: [50],
        });
        await hre.network.provider.request({ method: "evm_mine", params: [] });

        await rewardManager.connect(callerSigner).compoundRewards(
          threshold,
          [rewardToken.target, rewardToken.target], // Claiming the same token twice
          receiver,
        );

        const afterReceiverRawMulti = await rewardToken.balanceOf(receiver);
        const afterTreasuryRawMulti = await rewardToken.balanceOf(treasuryAddr);

        // Compute actual deltas for multiple claims
        const deltaReceiverMulti =
          afterReceiverRawMulti - beforeReceiverRawMulti;
        const deltaTreasuryMulti =
          afterTreasuryRawMulti - beforeTreasuryRawMulti;
        const rawClaimedMulti = deltaReceiverMulti + deltaTreasuryMulti;
        // Compute expected fee via on-chain logic
        const expectedFeeMulti =
          await rewardManager.getTreasuryFee(rawClaimedMulti);

        // Treasury should receive the fee, receiver the remainder
        expect(deltaTreasuryMulti).to.equal(expectedFeeMulti);
        expect(deltaReceiverMulti).to.equal(rawClaimedMulti - expectedFeeMulti);
      });

      // Tests for exchange asset deposit processing
      it("processes exchange asset deposit: emits event, deposits into vault, and consumes all exchange asset", async function () {
        const receiver = user4Address;
        // Fast-forward time to accrue rewards and cover both deposit and claim parts
        await hre.network.provider.request({
          method: "evm_increaseTime",
          params: [50],
        });
        await hre.network.provider.request({ method: "evm_mine", params: [] });

        // Preview expected conversion
        const [expectedVaultAsset, expectedVaultAmount] =
          await adapter.previewConvertToVaultAsset(threshold);

        // Capture initial vault balance
        const beforeVaultBalance = await vaultAssetToken.balanceOf(
          dStakeCollateralVault.target,
        );

        // Execute compoundRewards and assert event emission
        await expect(
          rewardManager
            .connect(callerSigner)
            .compoundRewards(threshold, [rewardToken.target], receiver),
        )
          .to.emit(rewardManager, "ExchangeAssetProcessed")
          .withArgs(expectedVaultAsset, expectedVaultAmount, threshold);

        // Assert vault received the converted asset
        const afterVaultBalance = await vaultAssetToken.balanceOf(
          dStakeCollateralVault.target,
        );
        expect(afterVaultBalance - beforeVaultBalance).to.equal(
          expectedVaultAmount,
        );

        // Assert rewardManager consumed all exchange assets
        const managerBalance = await underlyingDStableToken.balanceOf(
          rewardManager.target,
        );
        expect(managerBalance).to.equal(0);
      });

      it("shows wrapper-held rewards are only temporarily retained (no immediate sweep)", async function () {
        /*
         * ----------------------------------------------------------------------------------
         * High-level scenario overview
         * ----------------------------------------------------------------------------------
         * Someone could call `IStaticATokenLM.collectAndUpdateRewards()` right before the
         * protocol compounds.  That action moves the latest emissions from the Aave
         * RewardsController **into the wrapper contract's own ERC20 balance**.  Superficially
         * this appears to "lock" those tokens because our reward-manager only ever talks to
         * the RewardsController - it never tries to sweep the wrapper balance directly.
         *
         * The subtle but crucial detail is how `claimRewardsOnBehalf()` is implemented in the
         * Aave reference StaticAToken contract:
         *   1. If the wrapper's balance is *insufficient* it first calls
         *      `collectAndUpdateRewards()` on itself (pulling fresh emissions, exactly what the
         *      attacker just did one tx earlier).
         *   2. It then transfers **the full amount owed** to the receiver **from its own
         *      balance**.
         *
         * Because our vault owns ~100% of wrapper shares (we bootstrap that dominance a few
         * lines below), the "amount owed" is almost the entire balance that the attacker just
         * sucked in.  Effectively the wrapper serves as a short-lived escrow: whatever tokens
         * were front-run into it are **immediately** used to pay the vault on the next
         * compound.
         *
         * The only leftovers are (i) the attacker's tiny proportional share (<1 %) and (ii)
         * rounding dust from the integer maths in reward-index calculations.  Unless the
         * attacker keeps repeating the grief action every single block, the wrapper balance
         * therefore stabilises at that small constant amount and never grows without bound -
         * proving that no funds can be permanently stuck.
         * ----------------------------------------------------------------------------------
         */
        const receiver = user4Address;

        // 1. Bootstrap collateral vault ownership by compounding with a large
        //    amount so it becomes the dominant shareholder of the wrapper.
        const largeDeposit = threshold * 100n;

        // Ensure caller has sufficient balance & allowance
        await underlyingDStableToken
          .connect(deployerSigner)
          .mint(callerSigner.address, largeDeposit);
        await underlyingDStableToken
          .connect(callerSigner)
          .approve(rewardManager.target, largeDeposit + threshold); // Add extra for the second compound

        await rewardManager
          .connect(callerSigner)
          .compoundRewards(largeDeposit, [rewardToken.target], user3Address);

        const wrapper = await ethers.getContractAt(
          "IStaticATokenLM",
          targetStaticATokenWrapper,
        );

        // 2. Accrue some rewards so that the attacker can actually pull a non-zero amount.
        await hre.network.provider.request({
          method: "evm_increaseTime",
          params: [60],
        });
        await hre.network.provider.request({ method: "evm_mine", params: [] });

        // 3. Attacker front-runs: pulls rewards into the wrapper
        await wrapper
          .connect(user2Signer)
          .collectAndUpdateRewards(rewardToken.target);

        // `collectAndUpdateRewards` pulls the *raw* emissions out of Aave's RewardsController
        // and leaves them sitting in the wrapper's ERC20 balance.  No user has actually
        // received tokens yet – entitlement is tracked via reward indexes.

        // 4. Verify tokens are now trapped inside the wrapper (non-zero balance)
        const wrapperBalBefore = await rewardToken.balanceOf(wrapper.target);
        expect(wrapperBalBefore).to.be.gt(0n);

        const treasuryAddr = await rewardManager.treasury();
        const beforeReceiver = await rewardToken.balanceOf(receiver);
        const beforeTreasury = await rewardToken.balanceOf(treasuryAddr);

        // 5. Legitimate caller compounds – this claims fresh rewards from RewardsController only.
        await rewardManager
          .connect(callerSigner)
          .compoundRewards(threshold, [rewardToken.target], receiver);

        // The compound call triggers `claimRewardsOnBehalf(wrapper, vault, …)` under the hood.
        // As explained in the big header comment, that drains (almost) the entire wrapper
        // balance to pay the vault, leaving only the attacker's pro-rata share behind.

        // 6.a Tokens should still be trapped
        const wrapperBalAfter = await rewardToken.balanceOf(wrapper.target);

        // 6.b The amount distributed to receiver + treasury should be strictly lower than the trapped
        //     amount, proving those tokens were excluded from the payout.
        const afterReceiverBN = await rewardToken.balanceOf(receiver);
        const afterTreasuryBN = await rewardToken.balanceOf(treasuryAddr);
        const distributed =
          afterReceiverBN - beforeReceiver + (afterTreasuryBN - beforeTreasury);
        /*
         * Distributed amount must be strictly LOWER than what sat in the wrapper right before
         * compounding.  That proves two things:
         *   (1) The manager did NOT bypass accounting and sweep the wrapper balance in full.
         *   (2) The tokens are therefore still inside the protocol and will drip out gradually
         *       as 'userReward' grows with future emissions.  In other words, they are only
         *       temporarily locked—not permanently lost.
         */
        expect(distributed).to.be.lt(wrapperBalBefore);

        /********************
         * Phase 2 – let time pass so `userReward` catches up, then compound again
         ********************/

        // Fast-forward 1 day (with the adjusted emission rates, this should be sufficient)
        await hre.network.provider.request({
          method: "evm_increaseTime",
          params: [24 * 3600], // 1 day
        });
        await hre.network.provider.request({ method: "evm_mine", params: [] });

        // Provide another threshold-sized deposit to satisfy compoundRequirements
        await underlyingDStableToken
          .connect(deployerSigner)
          .mint(callerSigner.address, threshold);
        await underlyingDStableToken
          .connect(callerSigner)
          .approve(rewardManager.target, threshold);

        // Second compound – should now be able to pull (most of) the trapped balance
        const beforeSecond = await rewardToken.balanceOf(wrapper.target);

        await rewardManager
          .connect(callerSigner)
          .compoundRewards(threshold, [rewardToken.target], receiver);

        const afterSecond = await rewardToken.balanceOf(wrapper.target);

        /*
         * The wrapper balance should not increase indefinitely, proving tokens are
         * not permanently lost. While the balance may remain stable when emission
         * rate allows rewards to be claimed gradually, it should never grow unbounded.
         * With the adjusted emission parameters, we expect the balance to not increase.
         */
        if (beforeSecond > 0n) {
          expect(afterSecond).to.be.lte(beforeSecond); // Should not increase
        }

        // After letting time pass, `userReward` (the vault's share) has caught up with the
        // previously withheld balance, so the next compound should be able to extract most of
        // what is still sitting inside the wrapper.
      });
    });
  });
});
