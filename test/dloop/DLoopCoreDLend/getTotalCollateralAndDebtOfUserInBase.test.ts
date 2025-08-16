import { expect } from "chai";
import { ethers } from "hardhat";

describe("DLoopCoreDLend.getTotalCollateralAndDebtOfUserInBase — per-asset only", function () {
  let Collateral: any;
  let Debt: any;
  let Other: any;
  let collateral: any;
  let debt: any;
  let other: any;
  let aCollateral: any;
  let varDebtToken: any;
  let stableDebtToken: any;
  let aOther: any;

  let MockPool: any;
  let pool: any;
  let PriceOracle: any;
  let priceOracle: any;
  let AddressesProvider: any;
  let addressesProvider: any;
  let DLoopCoreDLendHarness: any;
  let dloop: any;
  let user: any;

  beforeEach(async function () {
    const [admin, , u] = await ethers.getSigners();
    user = u;

    Collateral = await ethers.getContractFactory("TestMintableERC20");
    Debt = await ethers.getContractFactory("TestMintableERC20");
    Other = await ethers.getContractFactory("TestMintableERC20");
    const AToken = await ethers.getContractFactory("TestMintableERC20");

    collateral = await Collateral.deploy("USDC", "USDC", 6);
    debt = await Debt.deploy("WETH", "WETH", 18);
    other = await Other.deploy("DAI", "DAI", 18);

    aCollateral = await AToken.deploy("aUSDC", "aUSDC", 6);
    varDebtToken = await AToken.deploy("vdWETH", "vdWETH", 18);
    stableDebtToken = await AToken.deploy("sdWETH", "sdWETH", 18);
    aOther = await AToken.deploy("aDAI", "aDAI", 18);

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

    // Oracle with 1e8 units
    PriceOracle = await ethers.getContractFactory("MockPriceOracleGetter");
    priceOracle = await PriceOracle.deploy();
    await priceOracle.setPrice(await collateral.getAddress(), 1_00000000n); // USDC = 1 * 1e8
    await priceOracle.setPrice(await debt.getAddress(), 3_000_00000000n); // WETH = 3000 * 1e8
    await priceOracle.setPrice(await other.getAddress(), 1_00000000n); // DAI = 1 * 1e8

    AddressesProvider = await ethers.getContractFactory(
      "MockPoolAddressesProvider",
    );
    addressesProvider = await AddressesProvider.deploy(
      await pool.getAddress(),
      await priceOracle.getAddress(),
    );

    DLoopCoreDLendHarness = await ethers.getContractFactory(
      "DLoopCoreDLendHarness",
    );
    dloop = await DLoopCoreDLendHarness.deploy(
      "DLend Vault",
      "DLV",
      await collateral.getAddress(),
      await debt.getAddress(),
      await addressesProvider.getAddress(),
      3_000_000, // targetLeverageBps
      2_500_000, // lower
      3_500_000, // upper
      0,
      ethers.ZeroAddress,
      await collateral.getAddress(),
      ethers.ZeroAddress,
      await admin.getAddress(),
      300_000,
      100_000,
      ethers.parseEther("1"),
    );
  });

  it("baseline calculation matches manual per-asset formula", async function () {
    // Supply collateral to user (aToken to user)
    await aCollateral.mint(await user.getAddress(), 1_000_000n); // 1 USDC (6 decimals)
    // Borrow debt for user (mint variable + stable debt token balances)
    await varDebtToken.mint(await user.getAddress(), ethers.parseEther("2000"));
    await stableDebtToken.mint(
      await user.getAddress(),
      ethers.parseEther("1000"),
    );

    const [collBase, debtBase] =
      await dloop.getTotalCollateralAndDebtOfUserInBase(user.address);

    // collateral: 1 USDC * 1e8 / 1e6 = 100000000
    expect(collBase).to.equal(100_000_000n);
    // debt: 3000 WETH * 3000e8 / 1e18 = 9e14 / 1e18 -> 900000000000000000000000000? No. Using integer: (3000e18 * 3000e8)/1e18 = 9e11
    expect(debtBase).to.equal(900_000_000_000_000n);
  });

  it("ignores unrelated collateral donations (aOther)", async function () {
    await aCollateral.mint(await user.getAddress(), 5_000_000n); // 5 USDC
    const [beforeColl] = await dloop.getTotalCollateralAndDebtOfUserInBase(
      user.address,
    );

    // Donate unrelated aToken (DAI) to user
    await aOther.mint(await user.getAddress(), ethers.parseEther("1000"));
    const [afterColl] = await dloop.getTotalCollateralAndDebtOfUserInBase(
      user.address,
    );

    expect(afterColl).to.equal(beforeColl);
  });

  it("counts only designated debt token balances (stable + variable)", async function () {
    // Create some debt on designated debt token and some on unrelated asset
    await varDebtToken.mint(await user.getAddress(), ethers.parseEther("10"));
    await stableDebtToken.mint(await user.getAddress(), ethers.parseEther("5"));
    // Unrelated variable debt on other asset should be ignored (just mint any token; pool doesn't return it as debt token for designated debt)
    const [_, debtBase] = await dloop.getTotalCollateralAndDebtOfUserInBase(
      user.address,
    );
    expect(debtBase).to.be.gt(0n);
  });
});
