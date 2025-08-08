import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { MockRewardClaimableVault } from "../../typechain-types";
import {
  ONE_HUNDRED_PERCENT_BPS,
  ONE_PERCENT_BPS,
} from "../../typescript/common/bps_constants";

// Define a simple interface for the mock ERC20 tokens
interface RewardClaimableMockERC20 {
  getAddress(): Promise<string>;
  balanceOf(address: string): Promise<bigint>;
  mint(to: string, amount: bigint): Promise<any>;
  burn(from: string, amount: bigint): Promise<any>;
  connect(signer: SignerWithAddress): RewardClaimableMockERC20;
  approve(spender: string, amount: bigint): Promise<any>;
  allowance(owner: string, spender: string): Promise<bigint>;
}

describe("RewardClaimable", function () {
  // Set up common variables
  let mockVault: MockRewardClaimableVault;
  let treasury: SignerWithAddress;
  let user: SignerWithAddress;
  let admin: SignerWithAddress;
  let targetPool: SignerWithAddress;
  let fakeRewardPool: SignerWithAddress;
  let exchangeAsset: RewardClaimableMockERC20;
  let rewardToken1: RewardClaimableMockERC20;
  let rewardToken2: RewardClaimableMockERC20;

  // Constants
  const MAX_TREASURY_FEE_BPS = 30 * ONE_PERCENT_BPS; // 30% max fee
  const INITIAL_TREASURY_FEE_BPS = 10 * ONE_PERCENT_BPS; // 10% initial fee
  const INITIAL_MINT_AMOUNT = ethers.parseEther("10000");
  const MAX_MINT_AMOUNT = INITIAL_MINT_AMOUNT * 1000n; // just a big number to test
  const DEFAULT_EXCHANGE_THRESHOLD = ethers.parseEther("1");

  beforeEach(async function () {
    // Get signers
    [admin, treasury, user, targetPool, fakeRewardPool] =
      await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const RewardClaimableMockERC20Factory = await ethers.getContractFactory(
      "contracts/vaults/rewards_claimable/test/RewardClaimableMockERC20.sol:RewardClaimableMockERC20",
    );
    exchangeAsset = (await RewardClaimableMockERC20Factory.connect(
      admin,
    ).deploy("Exchange Asset", "EA")) as unknown as RewardClaimableMockERC20;
    rewardToken1 = (await RewardClaimableMockERC20Factory.connect(admin).deploy(
      "Reward Token 1",
      "RT1",
    )) as unknown as RewardClaimableMockERC20;
    rewardToken2 = (await RewardClaimableMockERC20Factory.connect(admin).deploy(
      "Reward Token 2",
      "RT2",
    )) as unknown as RewardClaimableMockERC20;

    // Deploy mock vault
    const MockVaultFactory = await ethers.getContractFactory(
      "MockRewardClaimableVault",
      admin,
    );
    mockVault = (await MockVaultFactory.deploy(
      await exchangeAsset.getAddress(),
      await treasury.getAddress(),
      MAX_TREASURY_FEE_BPS,
      INITIAL_TREASURY_FEE_BPS,
      DEFAULT_EXCHANGE_THRESHOLD,
      await targetPool.getAddress(),
      await fakeRewardPool.getAddress(),
    )) as unknown as MockRewardClaimableVault;

    // Set up the vault with reward tokens emission amounts (3 and 2)
    await mockVault.addRewardToken(
      await rewardToken1.getAddress(),
      ethers.parseEther("3"),
    );
    await mockVault.addRewardToken(
      await rewardToken2.getAddress(),
      ethers.parseEther("2"),
    );

    // Set exchange threshold
    await mockVault.setExchangeThreshold(DEFAULT_EXCHANGE_THRESHOLD);

    // Mint tokens to users and vault
    await exchangeAsset.mint(await user.getAddress(), INITIAL_MINT_AMOUNT);
    await exchangeAsset.mint(await mockVault.getAddress(), INITIAL_MINT_AMOUNT); // Also mint to vault for compound tests
    await rewardToken1.mint(await mockVault.getAddress(), INITIAL_MINT_AMOUNT);
    await rewardToken2.mint(await mockVault.getAddress(), INITIAL_MINT_AMOUNT);
    await rewardToken1.mint(
      await fakeRewardPool.getAddress(),
      INITIAL_MINT_AMOUNT,
    );
    await rewardToken2.mint(
      await fakeRewardPool.getAddress(),
      INITIAL_MINT_AMOUNT,
    );

    // Approve token spending
    await exchangeAsset
      .connect(user)
      .approve(await mockVault.getAddress(), INITIAL_MINT_AMOUNT);
    // Since we're using MockRewardClaimableVaultTest which doesn't actually transfer tokens in _depositExchangeAsset,
    // we don't need the additional approvals

    // Set max allowance to allow the mock vault to drain from the fake reward pool
    await rewardToken1
      .connect(fakeRewardPool)
      .approve(await mockVault.getAddress(), MAX_MINT_AMOUNT);
    await rewardToken2
      .connect(fakeRewardPool)
      .approve(await mockVault.getAddress(), MAX_MINT_AMOUNT);
  });

  describe("getTreasuryFee", function () {
    interface TreasuryFeeTestCase {
      name: string;
      treasuryFeeBps: bigint;
      amount: bigint;
      expectedFee: bigint;
    }

    const treasuryFeeTestCases: TreasuryFeeTestCase[] = [
      {
        name: "Zero fee",
        treasuryFeeBps: 0n,
        amount: ethers.parseEther("100"),
        expectedFee: 0n,
      },
      {
        name: "10% fee",
        treasuryFeeBps: BigInt(10 * ONE_PERCENT_BPS), // 10%
        amount: ethers.parseUnits("100", 18),
        expectedFee: ethers.parseUnits("10", 18),
      },
      {
        name: "Maximum fee (30%)",
        treasuryFeeBps: BigInt(30 * ONE_PERCENT_BPS), // 30%
        amount: ethers.parseEther("100"),
        expectedFee: ethers.parseEther("30"),
      },
      {
        name: "Small amount with fee",
        treasuryFeeBps: BigInt(25 * ONE_PERCENT_BPS), // 25%
        amount: 1000n,
        expectedFee: 250n,
      },
    ];

    for (const testCase of treasuryFeeTestCases) {
      it(testCase.name, async function () {
        await mockVault.setTreasuryFeeBps(testCase.treasuryFeeBps);
        expect(await mockVault.treasuryFeeBps()).to.equal(
          testCase.treasuryFeeBps,
        );

        const fee = await mockVault.getTreasuryFee(testCase.amount);
        expect(fee).to.equal(testCase.expectedFee);
      });
    }

    it("Should revert if fee exceeds max", async function () {
      const invalidFeeBps = MAX_TREASURY_FEE_BPS + 1;
      await expect(mockVault.setTreasuryFeeBps(invalidFeeBps))
        .to.be.revertedWithCustomError(mockVault, "TreasuryFeeTooHigh")
        .withArgs(invalidFeeBps, MAX_TREASURY_FEE_BPS);
    });

    it("Should revert if initial fee exceeds max fee in constructor", async function () {
      const invalidMaxFeeBps = 101 * ONE_PERCENT_BPS;
      const MockVaultFactory = await ethers.getContractFactory(
        "MockRewardClaimableVault",
        admin,
      );
      await expect(
        MockVaultFactory.deploy(
          await exchangeAsset.getAddress(),
          await treasury.getAddress(),
          invalidMaxFeeBps,
          1 * ONE_PERCENT_BPS, // a valid initial fee
          DEFAULT_EXCHANGE_THRESHOLD,
          await targetPool.getAddress(),
          await fakeRewardPool.getAddress(),
        ),
      )
        .to.be.revertedWithCustomError(mockVault, "MaxTreasuryFeeTooHigh")
        .withArgs(invalidMaxFeeBps);
    });
  });

  describe("Treasury Management", function () {
    it("Should set treasury address", async function () {
      const newTreasury = user.address;
      expect(await mockVault.treasury()).to.equal(await treasury.getAddress());

      const tx = await mockVault.setTreasury(newTreasury);

      await expect(tx)
        .to.emit(mockVault, "TreasuryUpdated")
        .withArgs(await treasury.getAddress(), newTreasury);

      expect(await mockVault.treasury()).to.equal(newTreasury);
    });

    it("Should only allow REWARDS_MANAGER_ROLE to set treasury", async function () {
      await expect(
        mockVault.connect(user).setTreasury(user.address),
      ).to.be.revertedWithCustomError(
        mockVault,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("Should revert if treasury is zero address", async function () {
      await expect(
        mockVault.connect(admin).setTreasury(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(mockVault, "ZeroTreasuryAddress");
    });
  });

  describe("ExchangeThreshold Management", function () {
    it("Should set exchange threshold", async function () {
      const newThreshold = ethers.parseEther("2");
      expect(await mockVault.exchangeThreshold()).to.equal(
        DEFAULT_EXCHANGE_THRESHOLD,
      );

      const tx = await mockVault.setExchangeThreshold(newThreshold);

      await expect(tx)
        .to.emit(mockVault, "ExchangeThresholdUpdated")
        .withArgs(DEFAULT_EXCHANGE_THRESHOLD, newThreshold);

      expect(await mockVault.exchangeThreshold()).to.equal(newThreshold);
    });

    it("Should only allow REWARDS_MANAGER_ROLE to set exchange threshold", async function () {
      await expect(
        mockVault.connect(user).setExchangeThreshold(ethers.parseEther("2")),
      ).to.be.revertedWithCustomError(
        mockVault,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("Should revert if exchange threshold is zero", async function () {
      await expect(
        mockVault.connect(admin).setExchangeThreshold(0n),
      ).to.be.revertedWithCustomError(mockVault, "ZeroExchangeThreshold");
    });
  });

  describe("claimRewards", function () {
    interface ClaimRewardsTestCase {
      name: string;
      rewardTokens: string[];
      emissionAmounts: bigint[];
      initialBalances: bigint[];
      expectedClaims: bigint[];
    }

    let rewardTokens: string[] = [];

    beforeEach(async function () {
      rewardTokens = [
        await rewardToken1.getAddress(),
        await rewardToken2.getAddress(),
      ];
    });

    const runClaimRewardsTestCase = async (testCase: ClaimRewardsTestCase) => {
      // Setup emission amounts and initial balances
      for (let i = 0; i < testCase.rewardTokens.length; i++) {
        const token = testCase.rewardTokens[i];
        const tokenContract = i === 0 ? rewardToken1 : rewardToken2;

        // Set emission amount
        await mockVault.addRewardToken(token, testCase.emissionAmounts[i]);

        // Reset balances and mint to vault
        await tokenContract.burn(
          await mockVault.getAddress(),
          await tokenContract.balanceOf(await mockVault.getAddress()),
        );
        await tokenContract.mint(
          await mockVault.getAddress(),
          testCase.initialBalances[i],
        );
      }

      // Record balances before claim
      const initialReceiverBalances = await Promise.all(
        testCase.rewardTokens.map(async (token) => {
          const tokenContract =
            token === (await rewardToken1.getAddress())
              ? rewardToken1
              : rewardToken2;
          return tokenContract.balanceOf(await user.getAddress());
        }),
      );

      // Perform claim
      await mockVault.claimRewards(
        testCase.rewardTokens,
        await user.getAddress(),
      );

      // Verify balances after claim
      for (let i = 0; i < testCase.rewardTokens.length; i++) {
        const token = testCase.rewardTokens[i];
        const tokenContract =
          token === (await rewardToken1.getAddress())
            ? rewardToken1
            : rewardToken2;
        const finalBalance = await tokenContract.balanceOf(
          await user.getAddress(),
        );
        expect(finalBalance - initialReceiverBalances[i]).to.equal(
          testCase.expectedClaims[i],
        );
      }
    };

    it("Should claim rewards according to emission amount", async function () {
      const testCases: ClaimRewardsTestCase[] = [
        {
          name: "Standard claim with 30% emission",
          rewardTokens: rewardTokens,
          emissionAmounts: [ethers.parseEther("3"), ethers.parseEther("2")],
          initialBalances: [
            ethers.parseEther("1000"),
            ethers.parseEther("500"),
          ],
          expectedClaims: [ethers.parseEther("3"), ethers.parseEther("2")],
        },
        {
          name: "Standard claim with 10% emission",
          rewardTokens: rewardTokens,
          emissionAmounts: [ethers.parseEther("1"), ethers.parseEther("5")],
          initialBalances: [
            ethers.parseEther("1000"),
            ethers.parseEther("500"),
          ],
          expectedClaims: [ethers.parseEther("1"), ethers.parseEther("5")],
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          await runClaimRewardsTestCase(testCase);
        });
      }
    });

    describe("Should handle different emission rates for different tokens", async function () {
      const testCases: ClaimRewardsTestCase[] = [
        {
          name: "Different emission amounts",
          rewardTokens: rewardTokens,
          emissionAmounts: [ethers.parseEther("1"), ethers.parseEther("5")],
          initialBalances: [
            ethers.parseEther("1000"),
            ethers.parseEther("500"),
          ],
          expectedClaims: [ethers.parseEther("1"), ethers.parseEther("5")],
        },
        {
          name: "Different initial balances",
          rewardTokens: rewardTokens,
          emissionAmounts: [ethers.parseEther("3"), ethers.parseEther("2")],
          initialBalances: [
            ethers.parseEther("1000"),
            ethers.parseEther("500"),
          ],
          expectedClaims: [ethers.parseEther("3"), ethers.parseEther("2")],
        },
      ];

      for (const testCase of testCases) {
        it(testCase.name, async function () {
          await runClaimRewardsTestCase(testCase);
        });
      }
    });

    describe("Should only allow to compound when reaching the exchange threshold", async function () {
      it("Should revert if below threshold", async function () {
        await mockVault
          .connect(admin)
          .setExchangeThreshold(ethers.parseEther("2"));
        await expect(
          mockVault
            .connect(user)
            .compoundRewards(
              ethers.parseEther("1"),
              rewardTokens,
              await user.getAddress(),
            ),
        )
          .to.be.revertedWithCustomError(mockVault, "ExchangeAmountTooLow")
          .withArgs(ethers.parseEther("1"), ethers.parseEther("2"));
      });

      it("Should not revert if above threshold", async function () {
        await mockVault
          .connect(admin)
          .setExchangeThreshold(ethers.parseEther("2"));

        const amountToCompound = ethers.parseEther("2");

        // Make sure have enough allowance to spend from the spender to the vault
        expect(
          await exchangeAsset.allowance(
            await user.getAddress(),
            await mockVault.getAddress(),
          ),
        ).to.be.greaterThanOrEqual(amountToCompound);

        await mockVault
          .connect(user)
          .compoundRewards(
            amountToCompound,
            rewardTokens,
            await user.getAddress(),
          );
      });
    });

    it("Should revert on invalid reward token", async function () {
      const invalidToken = await exchangeAsset.getAddress();
      await expect(
        mockVault.claimRewards([invalidToken], await user.getAddress()),
      ).to.be.revertedWith("Invalid reward token");
    });
  });

  describe("compoundRewards", function () {
    it("Compound with 10% treasury fee", async function () {
      // Setup treasury fee
      const treasuryFeeBps = 10 * ONE_PERCENT_BPS; // 10%
      await mockVault.setTreasuryFeeBps(treasuryFeeBps);

      // Setup emission rates and initial balances
      const rewardTokenAddresses = [
        await rewardToken1.getAddress(),
        await rewardToken2.getAddress(),
      ];
      const rewardTokenEmissions = [
        ethers.parseEther("3"),
        ethers.parseEther("2"),
      ];
      const initialRewardBalances = [
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("500", 18),
      ];

      await mockVault.addRewardToken(
        rewardTokenAddresses[0],
        rewardTokenEmissions[0],
      );
      await mockVault.addRewardToken(
        rewardTokenAddresses[1],
        rewardTokenEmissions[1],
      );

      // Reset balances and mint to vault
      await rewardToken1.burn(
        await mockVault.getAddress(),
        await rewardToken1.balanceOf(await mockVault.getAddress()),
      );
      await rewardToken2.burn(
        await mockVault.getAddress(),
        await rewardToken2.balanceOf(await mockVault.getAddress()),
      );
      await rewardToken1.mint(
        await mockVault.getAddress(),
        initialRewardBalances[0],
      );
      await rewardToken2.mint(
        await mockVault.getAddress(),
        initialRewardBalances[1],
      );

      // Record initial balances
      const initialTreasuryBalances = [
        await rewardToken1.balanceOf(await treasury.getAddress()),
        await rewardToken2.balanceOf(await treasury.getAddress()),
      ];
      const initialUserBalances = [
        await rewardToken1.balanceOf(await user.getAddress()),
        await rewardToken2.balanceOf(await user.getAddress()),
      ];

      const amountToCompound = ethers.parseEther("5");

      // Make sure the treasury is set
      expect(await mockVault.treasury()).to.equal(await treasury.getAddress());

      // Make sure have enough allowance to spend from the spender to the vault
      expect(
        await exchangeAsset.allowance(
          await user.getAddress(),
          await mockVault.getAddress(),
        ),
      ).to.be.greaterThanOrEqual(amountToCompound);

      // Perform compound
      await mockVault
        .connect(user)
        .compoundRewards(
          amountToCompound,
          rewardTokenAddresses,
          await user.getAddress(),
        );

      // Calculate expected rewards and fees (just for testing)
      const expectedReward1 = rewardTokenEmissions[0];
      const expectedReward2 = rewardTokenEmissions[1];

      // Calculate treasury fees (10% of the rewards)
      const expectedTreasuryFee1 =
        (expectedReward1 * BigInt(treasuryFeeBps)) /
        BigInt(ONE_HUNDRED_PERCENT_BPS);
      const expectedTreasuryFee2 =
        (expectedReward2 * BigInt(treasuryFeeBps)) /
        BigInt(ONE_HUNDRED_PERCENT_BPS);

      // User gets the rewards minus fees
      const expectedUserReward1 = expectedReward1 - expectedTreasuryFee1;
      const expectedUserReward2 = expectedReward2 - expectedTreasuryFee2;

      // Verify treasury received the fees
      const actualTreasuryFee1 =
        (await rewardToken1.balanceOf(await treasury.getAddress())) -
        initialTreasuryBalances[0];
      const actualTreasuryFee2 =
        (await rewardToken2.balanceOf(await treasury.getAddress())) -
        initialTreasuryBalances[1];

      expect(actualTreasuryFee1).to.equal(expectedTreasuryFee1);
      expect(actualTreasuryFee2).to.equal(expectedTreasuryFee2);

      // Verify user received the rewards
      const actualUserReward1 =
        (await rewardToken1.balanceOf(await user.getAddress())) -
        initialUserBalances[0];
      const actualUserReward2 =
        (await rewardToken2.balanceOf(await user.getAddress())) -
        initialUserBalances[1];

      expect(actualUserReward1).to.equal(expectedUserReward1);
      expect(actualUserReward2).to.equal(expectedUserReward2);

      // Check for deposits record
      expect(
        await mockVault.deposits(await exchangeAsset.getAddress()),
      ).to.equal(amountToCompound);
    });

    it("Compound with zero treasury fee", async function () {
      // Setup treasury fee
      const treasuryFeeBps = 0n; // 0%
      await mockVault.setTreasuryFeeBps(treasuryFeeBps);

      // Setup emission rates and initial balances
      const rewardTokenAddresses = [
        await rewardToken1.getAddress(),
        await rewardToken2.getAddress(),
      ];
      const rewardTokenEmissions = [
        ethers.parseEther("2"),
        ethers.parseEther("4"),
      ];
      const initialRewardBalances = [
        ethers.parseEther("2000"),
        ethers.parseEther("1000"),
      ];

      await mockVault.addRewardToken(
        rewardTokenAddresses[0],
        rewardTokenEmissions[0],
      );
      await mockVault.addRewardToken(
        rewardTokenAddresses[1],
        rewardTokenEmissions[1],
      );

      // Reset balances and mint to vault
      await rewardToken1.burn(
        await mockVault.getAddress(),
        await rewardToken1.balanceOf(await mockVault.getAddress()),
      );
      await rewardToken2.burn(
        await mockVault.getAddress(),
        await rewardToken2.balanceOf(await mockVault.getAddress()),
      );
      await rewardToken1.mint(
        await mockVault.getAddress(),
        initialRewardBalances[0],
      );
      await rewardToken2.mint(
        await mockVault.getAddress(),
        initialRewardBalances[1],
      );

      // Record initial balances
      const initialTreasuryBalances = [
        await rewardToken1.balanceOf(await treasury.getAddress()),
        await rewardToken2.balanceOf(await treasury.getAddress()),
      ];
      const initialUserBalances = [
        await rewardToken1.balanceOf(await user.getAddress()),
        await rewardToken2.balanceOf(await user.getAddress()),
      ];

      // Perform compound
      const amountToCompound = ethers.parseEther("10");

      // Give user exchangeAsset tokens and approve vault to spend them
      await exchangeAsset.mint(await user.getAddress(), amountToCompound);
      await exchangeAsset
        .connect(user)
        .approve(await mockVault.getAddress(), amountToCompound);

      await mockVault
        .connect(user)
        .compoundRewards(
          amountToCompound,
          rewardTokenAddresses,
          await user.getAddress(),
        );

      // Calculate expected rewards and fees
      const expectedReward1 = rewardTokenEmissions[0];
      const expectedReward2 = rewardTokenEmissions[1];

      // Calculate treasury fees (0% of the rewards)
      const expectedTreasuryFee1 = 0n;
      const expectedTreasuryFee2 = 0n;

      // User gets all the rewards since fee is 0
      const expectedUserReward1 = expectedReward1;
      const expectedUserReward2 = expectedReward2;

      // Verify treasury received the fees
      const actualTreasuryFee1 =
        (await rewardToken1.balanceOf(await treasury.getAddress())) -
        initialTreasuryBalances[0];
      const actualTreasuryFee2 =
        (await rewardToken2.balanceOf(await treasury.getAddress())) -
        initialTreasuryBalances[1];

      expect(actualTreasuryFee1).to.equal(expectedTreasuryFee1);
      expect(actualTreasuryFee2).to.equal(expectedTreasuryFee2);

      // Verify user received the rewards
      const actualUserReward1 =
        (await rewardToken1.balanceOf(await user.getAddress())) -
        initialUserBalances[0];
      const actualUserReward2 =
        (await rewardToken2.balanceOf(await user.getAddress())) -
        initialUserBalances[1];

      expect(actualUserReward1).to.equal(expectedUserReward1);
      expect(actualUserReward2).to.equal(expectedUserReward2);

      // Check for deposits record
      expect(
        await mockVault.deposits(await exchangeAsset.getAddress()),
      ).to.equal(amountToCompound);
    });

    it("Should revert if amount is below threshold", async function () {
      const threshold = ethers.parseEther("5");
      await mockVault.setExchangeThreshold(threshold);
      const belowThreshold = threshold - 1n;

      await expect(
        mockVault
          .connect(user)
          .compoundRewards(
            belowThreshold,
            [await rewardToken1.getAddress()],
            await user.getAddress(),
          ),
      )
        .to.be.revertedWithCustomError(mockVault, "ExchangeAmountTooLow")
        .withArgs(belowThreshold, threshold);
    });
  });

  describe("Reward Token Management", function () {
    it("Should correctly add reward tokens", async function () {
      const newToken = await exchangeAsset.getAddress(); // Use exchange asset as a new reward token
      const emissionAmount = ethers.parseEther("4");

      // Initially not a reward token
      expect(await mockVault.rewardTokens(newToken)).to.be.false;

      // Add as reward token
      await mockVault.addRewardToken(newToken, emissionAmount);

      // Verify
      expect(await mockVault.rewardTokens(newToken)).to.be.true;
      expect(await mockVault.rewardTokenEmissionAmount(newToken)).to.equal(
        emissionAmount,
      );
    });
  });

  describe("Access Control", function () {
    it("Should have DEFAULT_ADMIN_ROLE for deployer", async function () {
      const DEFAULT_ADMIN_ROLE =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      expect(
        await mockVault.hasRole(DEFAULT_ADMIN_ROLE, await admin.getAddress()),
      ).to.be.true;
    });

    it("Should have REWARDS_MANAGER_ROLE for deployer", async function () {
      const REWARDS_MANAGER_ROLE = await mockVault.REWARDS_MANAGER_ROLE();
      expect(
        await mockVault.hasRole(REWARDS_MANAGER_ROLE, await admin.getAddress()),
      ).to.be.true;
    });

    it("Should allow granting and revoking roles", async function () {
      const REWARDS_MANAGER_ROLE = await mockVault.REWARDS_MANAGER_ROLE();

      // Grant role to user
      await mockVault.grantRole(REWARDS_MANAGER_ROLE, await user.getAddress());
      expect(
        await mockVault.hasRole(REWARDS_MANAGER_ROLE, await user.getAddress()),
      ).to.be.true;

      // Verify user can now set treasury
      await mockVault.connect(user).setTreasury(await user.getAddress());

      // Revoke role
      await mockVault.revokeRole(REWARDS_MANAGER_ROLE, await user.getAddress());
      expect(
        await mockVault.hasRole(REWARDS_MANAGER_ROLE, await user.getAddress()),
      ).to.be.false;

      // Verify user can no longer set treasury
      await expect(
        mockVault.connect(user).setTreasury(await user.getAddress()),
      ).to.be.revertedWithCustomError(
        mockVault,
        "AccessControlUnauthorizedAccount",
      );
    });
  });
});
