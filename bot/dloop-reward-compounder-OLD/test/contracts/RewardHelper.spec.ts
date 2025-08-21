import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { RewardHelper, MockRewardsDistributor, MockPool, MockPoolAddressesProvider } from "../../typechain-types";

describe("RewardHelper", function () {
    let rewardHelper: RewardHelper;
    let mockRewardsDistributor: MockRewardsDistributor;
    let mockPool: MockPool;
    let mockProvider: MockPoolAddressesProvider;
    let owner: Signer;
    let user: Signer;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy mocks
        const MockPoolFactory = await ethers.getContractFactory("MockPool");
        mockPool = await MockPoolFactory.deploy();
        await mockPool.waitForDeployment();

        const MockRewardsDistributorFactory = await ethers.getContractFactory("MockRewardsDistributor");
        mockRewardsDistributor = await MockRewardsDistributorFactory.deploy();
        await mockRewardsDistributor.waitForDeployment();

        const MockProviderFactory = await ethers.getContractFactory("MockPoolAddressesProvider");
        mockProvider = await MockProviderFactory.deploy();
        await mockProvider.waitForDeployment();

        // Deploy RewardHelper
        const RewardHelperFactory = await ethers.getContractFactory("RewardHelper");
        rewardHelper = await RewardHelperFactory.deploy(
            await mockPool.getAddress(),
            await mockRewardsDistributor.getAddress(),
            await mockProvider.getAddress()
        );
        await rewardHelper.waitForDeployment();
    });

    describe("constructor", function () {
        it("should revert with invalid addresses", async function () {
            const RewardHelperFactory = await ethers.getContractFactory("RewardHelper");

            await expect(
                RewardHelperFactory.deploy(ethers.ZeroAddress, await mockRewardsDistributor.getAddress(), await mockProvider.getAddress())
            ).to.be.revertedWithCustomError(rewardHelper, "InvalidAddress");

            await expect(
                RewardHelperFactory.deploy(await mockPool.getAddress(), ethers.ZeroAddress, await mockProvider.getAddress())
            ).to.be.revertedWithCustomError(rewardHelper, "InvalidAddress");

            await expect(
                RewardHelperFactory.deploy(await mockPool.getAddress(), await mockRewardsDistributor.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(rewardHelper, "InvalidAddress");
        });
    });

    describe("getUserAccruedRewards", function () {
        it("should return accrued rewards for user", async function () {
            const userAddress = await user.getAddress();
            const rewardToken = ethers.Wallet.createRandom().address;
            const expectedRewards = ethers.parseEther("100");

            // Setup mock to return expected rewards
            await mockRewardsDistributor.setUserAccruedRewards(userAddress, rewardToken, expectedRewards);

            const result = await rewardHelper.getUserAccruedRewards(userAddress, rewardToken);
            expect(result).to.equal(expectedRewards);
        });

        it("should revert with invalid addresses", async function () {
            const rewardToken = ethers.Wallet.createRandom().address;

            await expect(
                rewardHelper.getUserAccruedRewards(ethers.ZeroAddress, rewardToken)
            ).to.be.revertedWithCustomError(rewardHelper, "InvalidAddress");

            await expect(
                rewardHelper.getUserAccruedRewards(await user.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(rewardHelper, "InvalidAddress");
        });
    });

    describe("getUserTotalRewards", function () {
        it("should return total rewards for user across assets", async function () {
            const userAddress = await user.getAddress();
            const rewardToken = ethers.Wallet.createRandom().address;
            const assets = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
            const expectedRewards = ethers.parseEther("200");

            // Setup mock
            await mockRewardsDistributor.setUserRewards(assets, userAddress, rewardToken, expectedRewards);

            const result = await rewardHelper.getUserTotalRewards(userAddress, assets, rewardToken);
            expect(result).to.equal(expectedRewards);
        });

        it("should revert with invalid parameters", async function () {
            const userAddress = await user.getAddress();
            const rewardToken = ethers.Wallet.createRandom().address;
            const assets: string[] = [];

            await expect(
                rewardHelper.getUserTotalRewards(ethers.ZeroAddress, [ethers.Wallet.createRandom().address], rewardToken)
            ).to.be.revertedWithCustomError(rewardHelper, "InvalidAddress");

            await expect(
                rewardHelper.getUserTotalRewards(userAddress, assets, rewardToken)
            ).to.be.revertedWithCustomError(rewardHelper, "InvalidAddress");
        });
    });

    describe("getUserRewardSummary", function () {
        it("should return comprehensive reward summary", async function () {
            const userAddress = await user.getAddress();
            const rewardTokens = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
            const rewardAmounts = [ethers.parseEther("100"), ethers.parseEther("200")];

            // Setup mock
            await mockRewardsDistributor.setRewardsList(rewardTokens);
            await mockRewardsDistributor.setUserAccruedRewards(userAddress, rewardTokens[0], rewardAmounts[0]);
            await mockRewardsDistributor.setUserAccruedRewards(userAddress, rewardTokens[1], rewardAmounts[1]);

            const [totalRewards, tokens, amounts] = await rewardHelper.getUserRewardSummary(userAddress);

            expect(totalRewards).to.equal(ethers.parseEther("300"));
            expect(tokens).to.deep.equal(rewardTokens);
            expect(amounts).to.deep.equal(rewardAmounts);
        });

        it("should revert when no rewards found", async function () {
            const userAddress = await user.getAddress();
            const rewardTokens: string[] = [];

            // Setup mock with empty rewards list
            await mockRewardsDistributor.setRewardsList(rewardTokens);

            await expect(
                rewardHelper.getUserRewardSummary(userAddress)
            ).to.be.revertedWithCustomError(rewardHelper, "NoRewardsFound");
        });
    });
});
