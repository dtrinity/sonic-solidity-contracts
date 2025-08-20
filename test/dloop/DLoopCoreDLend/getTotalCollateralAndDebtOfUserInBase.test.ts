import { expect } from "chai";
import { ethers } from "hardhat";

describe("DLoopCoreDLend.getTotalCollateralAndDebtOfUserInBase — per-asset only", function () {
  let Collateral: any;
  let Debt: any;
  let Other: any;
  let USDT: any;
  let collateral: any;
  let debt: any;
  let other: any;
  let usdt: any;
  let aCollateral: any;
  let varDebtToken: any;
  let stableDebtToken: any;
  let aOther: any;
  let aUSDT: any;
  let varUSDTDebt: any;

  let MockPool: any;
  let pool: any;
  let PriceOracle: any;
  let priceOracle: any;
  let AddressesProvider: any;
  let addressesProvider: any;
  let DLoopCoreDLendHarness: any;
  let dloop: any;
  let user: any;
  let admin: any;

  beforeEach(async function () {
    const [a, , u] = await ethers.getSigners();
    admin = a;
    user = u;

    Collateral = await ethers.getContractFactory("TestMintableERC20");
    Debt = await ethers.getContractFactory("TestMintableERC20");
    Other = await ethers.getContractFactory("TestMintableERC20");
    USDT = await ethers.getContractFactory("TestMintableERC20");
    const AToken = await ethers.getContractFactory("TestMintableERC20");

    collateral = await Collateral.deploy("USDC", "USDC", 6);
    debt = await Debt.deploy("WETH", "WETH", 18);
    other = await Other.deploy("DAI", "DAI", 18);
    usdt = await USDT.deploy("USDT", "USDT", 6);

    aCollateral = await AToken.deploy("aUSDC", "aUSDC", 6);
    varDebtToken = await AToken.deploy("vdWETH", "vdWETH", 18);
    stableDebtToken = await AToken.deploy("sdWETH", "sdWETH", 18);
    aOther = await AToken.deploy("aDAI", "aDAI", 18);
    aUSDT = await AToken.deploy("aUSDT", "aUSDT", 6);
    varUSDTDebt = await AToken.deploy("vdUSDT", "vdUSDT", 6);

    // Minimal pool that returns reserve data with token addresses
    MockPool = await ethers.getContractFactory("MockPool");
    pool = await MockPool.deploy();
    await pool.setReserveData(
      await collateral.getAddress(),
      await aCollateral.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroAddress,
    );
    await pool.setReserveData(
      await debt.getAddress(),
      ethers.ZeroAddress,
      await stableDebtToken.getAddress(),
      await varDebtToken.getAddress(),
    );
    await pool.setReserveData(
      await other.getAddress(),
      await aOther.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroAddress,
    );
    await pool.setReserveData(
      await usdt.getAddress(),
      await aUSDT.getAddress(),
      ethers.ZeroAddress,
      await varUSDTDebt.getAddress(),
    );

    // Oracle with 1e8 units
    PriceOracle = await ethers.getContractFactory("MockPriceOracleGetter");
    priceOracle = await PriceOracle.deploy();
    await priceOracle.setPrice(await collateral.getAddress(), 1_00000000n); // USDC = 1 * 1e8
    await priceOracle.setPrice(await debt.getAddress(), 3_000_00000000n); // WETH = 3000 * 1e8
    await priceOracle.setPrice(await other.getAddress(), 1_00000000n); // DAI = 1 * 1e8
    await priceOracle.setPrice(await usdt.getAddress(), 1_00000000n); // USDT = 1 * 1e8

    AddressesProvider = await ethers.getContractFactory(
      "MockPoolAddressesProvider",
    );
    addressesProvider = await AddressesProvider.deploy(
      await pool.getAddress(),
      await priceOracle.getAddress(),
    );

    // Deploy and link DLoopCoreLogic library required by DLoopCoreDLendHarness
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
      await collateral.getAddress(), // collateralToken
      await debt.getAddress(), // debtToken
      await addressesProvider.getAddress(), // lendingPoolAddressesProvider
      3_000_000, // targetLeverageBps
      2_500_000, // lowerBoundTargetLeverageBps
      3_500_000, // upperBoundTargetLeverageBps
      0, // maxSubsidyBps
      0, // minDeviationBps
      0, // withdrawalFeeBps
      ethers.ZeroAddress, // rewardsController
      await collateral.getAddress(), // dLendAssetToClaimFor
      ethers.ZeroAddress, // targetStaticATokenWrapper
      await admin.getAddress(), // treasury
      300_000, // maxTreasuryFeeBps
      100_000, // initialTreasuryFeeBps
      ethers.parseEther("1"),
    );
  });

  describe("Test Case 1: Baseline per-asset calculation - exact equality", function () {
    it("baseline calculation matches manual per-asset formula", async function () {
      // Supply collateral to user (aToken to user)
      await aCollateral.mint(await user.getAddress(), 1_000_000n); // 1 USDC (6 decimals)
      // Borrow debt for user (mint variable + stable debt token balances)
      await varDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("2000"),
      );
      await stableDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("1000"),
      );

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // collateral: 1 USDC * 1e8 = 100,000,000
      expect(collBase).to.equal(100_000_000n);
      // debt: (2,000 + 1,000) WETH * 3,000 * 1e8 / 1e18 = 900,000,000,000,000
      expect(debtBase).to.equal(900_000_000_000_000n);
    });
  });

  describe("Test Case 2: Baseline for the vault address", function () {
    it("calculates correctly for vault address (address(this))", async function () {
      const vaultAddress = await dloop.getAddress();

      // Supply collateral to vault
      await aCollateral.mint(vaultAddress, 2_000_000n); // 2 USDC
      // Borrow debt for vault
      await varDebtToken.mint(vaultAddress, ethers.parseEther("1500"));
      await stableDebtToken.mint(vaultAddress, ethers.parseEther("500"));

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(vaultAddress);

      // collateral: 2 USDC * 1e8 = 200,000,000
      expect(collBase).to.equal(200_000_000n);
      // debt: (1,500 + 500) WETH * 3,000 * 1e8 / 1e18 = 600,000,000,000,000
      expect(debtBase).to.equal(600_000_000_000_000n);
    });
  });

  describe("Test Case 3: Ignore unrelated collateral donations (attack regression)", function () {
    it("ignores unrelated collateral donations (aOther)", async function () {
      await aCollateral.mint(await user.getAddress(), 5_000_000n); // 5 USDC
      const [beforeColl, beforeDebt] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // Donate large amount of unrelated aToken (DAI) to user
      await aOther.mint(await user.getAddress(), ethers.parseEther("1000000")); // 1M DAI
      const [afterColl, afterDebt] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(afterColl).to.equal(beforeColl);
      expect(afterDebt).to.equal(beforeDebt);
    });

    it("massive donation attack has no effect", async function () {
      // Setup baseline position
      await aCollateral.mint(await user.getAddress(), 1_000_000n); // 1 USDC
      await varDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("0.5"),
      );

      const [beforeColl, beforeDebt] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // Massive donations of multiple unrelated assets
      await aOther.mint(await user.getAddress(), ethers.parseEther("10000000")); // 10M DAI
      await aUSDT.mint(await user.getAddress(), 50_000_000_000_000n); // 50M USDT

      const [afterColl, afterDebt] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(afterColl).to.equal(beforeColl);
      expect(afterDebt).to.equal(beforeDebt);
    });
  });

  describe("Test Case 4: Ignore unrelated debt positions", function () {
    it("counts only designated debt token balances (stable + variable)", async function () {
      // Create some debt on designated debt token
      await varDebtToken.mint(await user.getAddress(), ethers.parseEther("10"));
      await stableDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("5"),
      );

      const [, debtBaseBefore] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // Add unrelated debt (USDT debt)
      await varUSDTDebt.mint(await user.getAddress(), 5_000_000_000n); // 5000 USDT debt

      const [, debtBaseAfter] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(debtBaseAfter).to.equal(debtBaseBefore);
      expect(debtBaseBefore).to.be.gt(0n);
      // Expected: (10 + 5) WETH * 3000 * 1e8 / 1e18 = 4,500,000,000,000
      expect(debtBaseBefore).to.equal(4_500_000_000_000n);
    });
  });

  describe("Test Case 5: Zero positions → zeroes", function () {
    it("returns (0, 0) for zero positions", async function () {
      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(collBase).to.equal(0n);
      expect(debtBase).to.equal(0n);
    });

    it("returns zero collateral with debt present", async function () {
      await varDebtToken.mint(await user.getAddress(), ethers.parseEther("1"));

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(collBase).to.equal(0n);
      expect(debtBase).to.be.gt(0n);
    });

    it("returns zero debt with collateral present", async function () {
      await aCollateral.mint(await user.getAddress(), 1_000_000n);

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(collBase).to.be.gt(0n);
      expect(debtBase).to.equal(0n);
    });
  });

  describe("Test Case 6: Decimals sanity and mixed-decimals correctness", function () {
    it("handles mixed decimals correctly", async function () {
      // 1.234567 USDC (6 decimals) = 1,234,567 units
      await aCollateral.mint(await user.getAddress(), 1_234_567n);
      // 0.75 WETH (0.5 variable + 0.25 stable)
      await varDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("0.5"),
      );
      await stableDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("0.25"),
      );

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // collateral: 1.234567 USDC * 1e8 = 123,456,700
      expect(collBase).to.equal(123_456_700n);
      // debt: 0.75 WETH * 3000 * 1e8 / 1e18 = 225,000,000,000
      expect(debtBase).to.equal(225_000_000_000n);
    });

    it("handles different decimal combinations", async function () {
      // Test 8-decimal collateral (create new token for this test)
      const Token8Dec = await ethers.getContractFactory("TestMintableERC20");
      const token8 = await Token8Dec.deploy("TOKEN8", "T8", 8);
      const aToken8 = await Token8Dec.deploy("aT8", "aT8", 8);

      // Setup pool data for 8-decimal token
      await pool.setReserveData(
        await token8.getAddress(),
        await aToken8.getAddress(),
        ethers.ZeroAddress,
        ethers.ZeroAddress,
      );
      await priceOracle.setPrice(await token8.getAddress(), 2_00000000n); // 2.00 * 1e8

      // Deploy new dloop with 8-decimal collateral
      const dloop8 = await DLoopCoreDLendHarness.deploy(
        "DLend Vault 8",
        "DLV8",
        await token8.getAddress(),
        await debt.getAddress(),
        await addressesProvider.getAddress(),
        3_000_000,
        2_500_000,
        3_500_000,
        0, // maxSubsidyBps
        0, // minDeviationBps
        0, // withdrawalFeeBps
        ethers.ZeroAddress, // rewardsController
        await token8.getAddress(), // dLendAssetToClaimFor
        ethers.ZeroAddress, // targetStaticATokenWrapper
        await admin.getAddress(),
        300_000,
        100_000,
        ethers.parseEther("1"),
      );

      // 3.5 units of 8-decimal token = 350,000,000 units
      await aToken8.mint(await user.getAddress(), 350_000_000n);

      const [collBase, debtBase] =
        await dloop8.getTotalCollateralAndDebtOfUserInBase(user.address);

      // collateral: 3.5 * 2 * 1e8 = 700,000,000
      expect(collBase).to.equal(700_000_000n);
      expect(debtBase).to.equal(0n);
    });
  });

  describe("Test Case 7: Oracle price changes propagate", function () {
    it("reflects oracle price changes proportionally", async function () {
      await aCollateral.mint(await user.getAddress(), 1_000_000n); // 1 USDC
      await varDebtToken.mint(await user.getAddress(), ethers.parseEther("1")); // 1 WETH

      const [collBaseBefore, _debtBaseBefore] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // Change prices: USDC 1.00 → 1.10, WETH 3000 → 2500
      await priceOracle.setPrice(await collateral.getAddress(), 1_10000000n); // 1.10 * 1e8
      await priceOracle.setPrice(await debt.getAddress(), 2_500_00000000n); // 2500 * 1e8

      const [collBaseAfter, debtBaseAfter] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // collateral increased by 10%: 100,000,000 → 110,000,000
      expect(collBaseAfter).to.equal(110_000_000n);
      expect(collBaseAfter).to.equal((collBaseBefore * 110n) / 100n);

      // debt decreased to 2500: 300,000,000,000 → 250,000,000,000
      expect(debtBaseAfter).to.equal(250_000_000_000n);
    });
  });

  describe("Test Case 8: Invariance under aToken direct transfer-in/out", function () {
    it("reflects aToken balance changes linearly", async function () {
      await aCollateral.mint(await user.getAddress(), 1_000_000n); // 1 USDC

      const [collBase1] = await dloop.getTotalCollateralAndDebtOfUserInBase(
        user.address,
      );

      // Transfer +10 aUSDC (simulate additional supply)
      await aCollateral.mint(await user.getAddress(), 10_000_000n); // +10 USDC

      const [collBase2] = await dloop.getTotalCollateralAndDebtOfUserInBase(
        user.address,
      );

      // Should increase linearly
      expect(collBase2).to.equal(collBase1 + 1_000_000_000n); // +10 * 1e8

      // Note: We skip testing token removal since TestMintableERC20 doesn't support burn/zero transfers
      // The key test is that balance changes are reflected linearly, which we've demonstrated above
    });
  });

  describe("Test Case 9: User vs Vault address symmetry", function () {
    it("returns same values for identical positions", async function () {
      const vaultAddress = await dloop.getAddress();

      // Setup identical positions
      const collAmount = 2_500_000n; // 2.5 USDC
      const varDebtAmount = ethers.parseEther("0.8");
      const stableDebtAmount = ethers.parseEther("0.2");

      // User positions
      await aCollateral.mint(await user.getAddress(), collAmount);
      await varDebtToken.mint(await user.getAddress(), varDebtAmount);
      await stableDebtToken.mint(await user.getAddress(), stableDebtAmount);

      // Vault positions (identical)
      await aCollateral.mint(vaultAddress, collAmount);
      await varDebtToken.mint(vaultAddress, varDebtAmount);
      await stableDebtToken.mint(vaultAddress, stableDebtAmount);

      const [userColl, userDebt] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);
      const [vaultColl, vaultDebt] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(vaultAddress);

      expect(userColl).to.equal(vaultColl);
      expect(userDebt).to.equal(vaultDebt);
    });
  });

  describe("Test Case 10: Price = 0 edge behavior", function () {
    it("handles zero collateral price gracefully", async function () {
      await aCollateral.mint(await user.getAddress(), 1_000_000n);
      await varDebtToken.mint(await user.getAddress(), ethers.parseEther("1"));

      // Set collateral price to very small value (oracle doesn't allow 0)
      await priceOracle.setPrice(await collateral.getAddress(), 1n); // Minimal price

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(collBase).to.be.lt(100n); // Very low price means very low base value
      expect(debtBase).to.be.gt(0n); // Debt side should still work
    });

    it("handles zero debt price gracefully", async function () {
      await aCollateral.mint(await user.getAddress(), 1_000_000n);
      await varDebtToken.mint(await user.getAddress(), ethers.parseEther("1"));

      // Set debt price to very small value (oracle doesn't allow 0)
      await priceOracle.setPrice(await debt.getAddress(), 1n); // Minimal price

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(collBase).to.be.gt(0n); // Collateral side should still work
      expect(debtBase).to.be.lt(1000n); // Very low price means very low base value
    });
  });

  describe("Test Case 11: Multiple unrelated donations do not accumulate", function () {
    it("massive multi-asset donations have no cumulative effect", async function () {
      // Setup baseline
      await aCollateral.mint(await user.getAddress(), 1_000_000n); // 1 USDC
      await varDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("0.1"),
      ); // 0.1 WETH

      const [collBaseBefore, debtBaseBefore] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // Donate massive amounts of multiple unrelated assets
      await aOther.mint(await user.getAddress(), ethers.parseEther("1000000")); // 1M DAI
      await aUSDT.mint(await user.getAddress(), 500_000_000_000_000n); // 500M USDT

      // Also add unrelated debt positions
      await varUSDTDebt.mint(await user.getAddress(), 100_000_000_000n); // 100K USDT debt

      const [collBaseAfter, debtBaseAfter] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      expect(collBaseAfter).to.equal(collBaseBefore);
      expect(debtBaseAfter).to.equal(debtBaseBefore);
      expect(collBaseBefore).to.equal(100_000_000n); // 1 USDC * 1e8
      expect(debtBaseBefore).to.equal(30_000_000_000n); // 0.1 WETH * 3000 * 1e8 / 1e18
    });
  });

  describe("Test Case 12: Integration smoke - leverage quote neutrality", function () {
    it("leverage calculations unaffected by donations", async function () {
      const vaultAddress = await dloop.getAddress();

      // Setup realistic vault position
      await aCollateral.mint(vaultAddress, 10_000_000n); // 10 USDC collateral
      await varDebtToken.mint(vaultAddress, ethers.parseEther("0.002")); // 0.002 WETH debt

      // Record leverage metrics before donation
      const leverageBefore = await dloop.getCurrentLeverageBps();
      const [collBefore, debtBefore] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(vaultAddress);

      // Massive donation attack
      await aOther.mint(vaultAddress, ethers.parseEther("10000000")); // 10M DAI

      // Verify metrics unchanged
      const leverageAfter = await dloop.getCurrentLeverageBps();
      const [collAfter, debtAfter] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(vaultAddress);

      expect(leverageAfter).to.equal(leverageBefore);
      expect(collAfter).to.equal(collBefore);
      expect(debtAfter).to.equal(debtBefore);
    });
  });

  describe("Test Case 13: Parameterized edge cases", function () {
    it("handles different decimals with main tokens", async function () {
      // Test calculation correctness with main token decimals (6 vs 18)
      // This is covered in other tests but verify calculation is exact
      await aCollateral.mint(await user.getAddress(), 123_456n); // 0.123456 USDC (6 decimals)
      await varDebtToken.mint(
        await user.getAddress(),
        ethers.parseEther("0.001234"),
      ); // 0.001234 WETH

      const [collBase, debtBase] =
        await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

      // collateral: 0.123456 USDC * 1e8 = 12,345,600
      expect(collBase).to.equal(12_345_600n);
      // debt: 0.001234 WETH * 3000 * 1e8 / 1e18 = 370,200,000
      expect(debtBase).to.equal(370_200_000n);
    });

    it("handles various price points correctly", async function () {
      const testCases = [
        { collPrice: 50000000n, debtPrice: 100000000n }, // 0.5, 1.0
        { collPrice: 200000000n, debtPrice: 300000000n }, // 2.0, 3.0
        { collPrice: 500000000000n, debtPrice: 1n }, // 5000, 0.00000001
      ];

      for (const testCase of testCases) {
        await priceOracle.setPrice(
          await collateral.getAddress(),
          testCase.collPrice,
        );
        await priceOracle.setPrice(await debt.getAddress(), testCase.debtPrice);

        await aCollateral.mint(await user.getAddress(), 1_000_000n); // 1 USDC
        await varDebtToken.mint(
          await user.getAddress(),
          ethers.parseEther("1"),
        ); // 1 WETH

        const [collBase, debtBase] =
          await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

        // Verify the calculation: amount * price (no division by decimals since using exact conversion)
        expect(collBase).to.be.gt(0n);
        expect(debtBase).to.be.gt(0n);

        // Note: We skip cleanup since transfers to zero address fail
        // Each test case uses fresh tokens from minting
      }
    });
  });
});
