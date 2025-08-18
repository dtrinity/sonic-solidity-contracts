import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("DLoopCoreDLend – Reward Compounding (vault shares as exchange asset)", function () {
  // eslint-disable-next-line unused-imports/no-unused-vars -- Unused import is needed for testing
  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let user: SignerWithAddress;
  let rewardSource: SignerWithAddress;

  let Collateral: any;
  let Debt: any;
  let RewardToken: any;
  let collateral: any;
  let debt: any;
  let rewardToken1: any;
  let rewardToken2: any;

  let PriceOracle: any;
  let AddressesProvider: any;
  let RewardsController: any;
  let priceOracle: any;
  let addressesProvider: any;
  let rewardsController: any;

  let DLoopCoreDLendHarness: any;
  let dloop: any;

  const MAX_TREASURY_FEE_BPS = 300_000n; // 30%
  const INIT_TREASURY_FEE_BPS = 100_000n; // 10%
  const EXCHANGE_THRESHOLD = ethers.parseEther("1");
  const TARGET_LEVERAGE_BPS = 3_000_000n; // 300%
  const LOWER_BPS = 2_500_000n; // 250%
  const UPPER_BPS = 3_500_000n; // 350%

  beforeEach(async function () {
    [admin, treasury, user, rewardSource] = await ethers.getSigners();

    // Tokens
    Collateral = await ethers.getContractFactory("TestMintableERC20");
    Debt = await ethers.getContractFactory("TestMintableERC20");
    RewardToken = await ethers.getContractFactory("TestMintableERC20");

    collateral = await Collateral.deploy("Collateral", "COLL", 18);
    debt = await Debt.deploy("Debt", "DEBT", 18);
    rewardToken1 = await RewardToken.deploy("Reward1", "R1", 18);
    rewardToken2 = await RewardToken.deploy("Reward2", "R2", 18);

    // Oracle and provider
    PriceOracle = await ethers.getContractFactory("MockPriceOracleGetter");
    priceOracle = await PriceOracle.deploy();
    await priceOracle.setPrice(await collateral.getAddress(), 2_000_00000000n); // 2000 * 1e8
    await priceOracle.setPrice(await debt.getAddress(), 1_000_00000000n); // 1000 * 1e8

    AddressesProvider = await ethers.getContractFactory(
      "MockPoolAddressesProvider",
    );
    addressesProvider = await AddressesProvider.deploy(
      ethers.ZeroAddress,
      await priceOracle.getAddress(),
    );

    // Rewards controller
    RewardsController = await ethers.getContractFactory(
      "MockRewardsController",
    );
    rewardsController = await RewardsController.deploy(
      await rewardSource.getAddress(),
    );

    // DLoopCoreDLend harness deployment (link required DLoopCoreLogic library)
    const DLoopCoreLogicFactory =
      await ethers.getContractFactory("DLoopCoreLogic");
    const dloopCoreLogicLib = await DLoopCoreLogicFactory.deploy();
    await dloopCoreLogicLib.waitForDeployment();

    DLoopCoreDLendHarness = await ethers.getContractFactory(
      "DLoopCoreDLendHarness",
      {
        libraries: {
          "contracts/vaults/dloop/core/DLoopCoreLogic.sol:DLoopCoreLogic":
            await dloopCoreLogicLib.getAddress(),
        },
      },
    );
    dloop = await DLoopCoreDLendHarness.deploy(
      "DLend Vault",
      "DLV",
      await collateral.getAddress(),
      await debt.getAddress(),
      await addressesProvider.getAddress(),
      TARGET_LEVERAGE_BPS,
      LOWER_BPS,
      UPPER_BPS,
      0, // max subsidy bps (not important for this test)
      0, // minDeviationBps
      0, // withdrawalFeeBps
      await rewardsController.getAddress(),
      await collateral.getAddress(), // dLendAssetToClaimFor (arbitrary for mock)
      ethers.ZeroAddress, // targetStaticATokenWrapper (arbitrary for mock)
      await treasury.getAddress(),
      MAX_TREASURY_FEE_BPS,
      INIT_TREASURY_FEE_BPS,
      EXCHANGE_THRESHOLD,
    );

    // Fund reward source with rewards
    await rewardToken1.mint(
      await rewardSource.getAddress(),
      ethers.parseEther("1000000"),
    );
    await rewardToken2.mint(
      await rewardSource.getAddress(),
      ethers.parseEther("1000000"),
    );

    // Configure emissions
    await rewardsController.setEmission(
      await rewardToken1.getAddress(),
      ethers.parseEther("3"),
    );
    await rewardsController.setEmission(
      await rewardToken2.getAddress(),
      ethers.parseEther("2"),
    );

    // Allow rewards controller to pull rewards from rewardSource
    await rewardToken1
      .connect(rewardSource)
      .approve(
        await rewardsController.getAddress(),
        ethers.parseEther("1000000"),
      );
    await rewardToken2
      .connect(rewardSource)
      .approve(
        await rewardsController.getAddress(),
        ethers.parseEther("1000000"),
      );
  });

  it("Should burn shares and distribute rewards with treasury fee on compound", async function () {
    const amountToCompound = ethers.parseEther("10");

    const receiver = user.address;
    const tokens = [
      await rewardToken1.getAddress(),
      await rewardToken2.getAddress(),
    ];

    // Mint shares to user via harness, then approve vault to transfer them
    await dloop.mintShares(await user.getAddress(), amountToCompound);
    await dloop
      .connect(user)
      .approve(await dloop.getAddress(), amountToCompound);

    const totalSupplyBefore: bigint = await dloop.totalSupply();
    const treasuryBalR1Before: bigint = await rewardToken1.balanceOf(
      await treasury.getAddress(),
    );
    const treasuryBalR2Before: bigint = await rewardToken2.balanceOf(
      await treasury.getAddress(),
    );
    const recvBalR1Before: bigint = await rewardToken1.balanceOf(receiver);
    const recvBalR2Before: bigint = await rewardToken2.balanceOf(receiver);

    const tx = await dloop
      .connect(user)
      .compoundRewards(amountToCompound, tokens, receiver);
    await tx.wait();

    const totalSupplyAfter: bigint = await dloop.totalSupply();
    expect(totalSupplyAfter).to.equal(totalSupplyBefore - amountToCompound);

    const DENOM_BPS = 1_000_000n;
    const emittedFee1 =
      (ethers.parseEther("3") * INIT_TREASURY_FEE_BPS) / DENOM_BPS;
    const emittedFee2 =
      (ethers.parseEther("2") * INIT_TREASURY_FEE_BPS) / DENOM_BPS;

    const treasuryBalR1After: bigint = await rewardToken1.balanceOf(
      await treasury.getAddress(),
    );
    const treasuryBalR2After: bigint = await rewardToken2.balanceOf(
      await treasury.getAddress(),
    );
    expect(treasuryBalR1After - treasuryBalR1Before).to.equal(emittedFee1);
    expect(treasuryBalR2After - treasuryBalR2Before).to.equal(emittedFee2);

    const recvBalR1After: bigint = await rewardToken1.balanceOf(receiver);
    const recvBalR2After: bigint = await rewardToken2.balanceOf(receiver);
    expect(recvBalR1After - recvBalR1Before).to.equal(
      ethers.parseEther("3") - emittedFee1,
    );
    expect(recvBalR2After - recvBalR2Before).to.equal(
      ethers.parseEther("2") - emittedFee2,
    );
  });

  it("Should enforce threshold on amount", async function () {
    const below = EXCHANGE_THRESHOLD - 1n;

    await dloop.mintShares(await user.getAddress(), below);
    await dloop.connect(user).approve(await dloop.getAddress(), below);

    await expect(
      dloop
        .connect(user)
        .compoundRewards(
          below,
          [await rewardToken1.getAddress()],
          user.address,
        ),
    ).to.be.revertedWithCustomError(dloop, "ExchangeAmountTooLow");
  });

  it("compounding uses share burn, not debt repay", async function () {
    const amt = ethers.parseEther("5");

    await dloop.mintShares(await user.getAddress(), amt);
    await dloop.connect(user).approve(await dloop.getAddress(), amt);

    const debtBalBefore: bigint = await debt.balanceOf(
      await dloop.getAddress(),
    );
    const debtAllowBefore: bigint = await debt.allowance(
      await dloop.getAddress(),
      await dloop.getAddress(),
    );

    await dloop
      .connect(user)
      .compoundRewards(amt, [await rewardToken1.getAddress()], user.address);

    const debtBalAfter: bigint = await debt.balanceOf(await dloop.getAddress());
    const debtAllowAfter: bigint = await debt.allowance(
      await dloop.getAddress(),
      await dloop.getAddress(),
    );

    expect(debtBalAfter).to.equal(debtBalBefore);
    expect(debtAllowAfter).to.equal(debtAllowBefore);
  });
});
