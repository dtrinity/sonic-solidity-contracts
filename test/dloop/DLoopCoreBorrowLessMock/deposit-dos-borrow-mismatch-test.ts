import { expect } from "chai";
import { ethers } from "hardhat";

import {
  TestMintableERC20,
  DLoopCoreBorrowLessMock,
} from "../../../typechain-types";

// Utility constants
const ONE_PERCENT_BPS = 10_000n; // 100% in basis-points representation is 10_000
const TARGET_LEVERAGE_BPS = 300n * ONE_PERCENT_BPS; // 3× leverage
const LOWER_BOUND_BPS = 250n * ONE_PERCENT_BPS; // 2.5× leverage
const UPPER_BOUND_BPS = 350n * ONE_PERCENT_BPS; // 3.5× leverage
const MAX_SUBSIDY_BPS = 1n * ONE_PERCENT_BPS; // 1 %
const DEFAULT_PRICE = 100_000_000n; // 1.0 with 8 decimals

/**
 * This test recreates the exact conditions that previously caused a DoS in the
 * `deposit()` flow (see HATS issue #233). The mocked borrowing logic now
 * returns `amount − 1 wei`, exercising the rounding-tolerance code path.  The
 * assertion is that the call no longer reverts and that the receiver ends up
 * with the *actual* amount borrowed, while the vault holds no residual debt
 * tokens.
 */
describe("DLoopCoreBorrowLessMock — deposit borrow-mismatch regression", function () {
  it("should succeed when the pool gives 1 wei less than requested", async function () {
    const [deployer, user] = await ethers.getSigners();

    // ---------------------------------------------------------------------
    // Deploy mock tokens (mintable)
    // ---------------------------------------------------------------------
    const TokenFactory = await ethers.getContractFactory("TestMintableERC20");
    const collateralToken = (await TokenFactory.deploy(
      "Mock Collateral",
      "mCOLL",
      18
    )) as unknown as TestMintableERC20;
    const debtToken = (await TokenFactory.deploy(
      "Mock Debt",
      "mDEBT",
      18
    )) as unknown as TestMintableERC20;

    await collateralToken.waitForDeployment();
    await debtToken.waitForDeployment();

    // ---------------------------------------------------------------------
    // Deploy the Borrow-Less vault
    // ---------------------------------------------------------------------
    const VaultFactory = await ethers.getContractFactory(
      "DLoopCoreBorrowLessMock"
    );
    const vault = (await VaultFactory.deploy(
      "BorrowLess Vault",
      "bLOOP",
      await collateralToken.getAddress(),
      await debtToken.getAddress(),
      Number(TARGET_LEVERAGE_BPS),
      Number(LOWER_BOUND_BPS),
      Number(UPPER_BOUND_BPS),
      Number(MAX_SUBSIDY_BPS)
    )) as unknown as DLoopCoreBorrowLessMock;
    await vault.waitForDeployment();

    // ---------------------------------------------------------------------
    // Configure oracle prices to $1.00 for both tokens (8-decimals feed)
    // ---------------------------------------------------------------------
    await vault.setMockPrice(await collateralToken.getAddress(), DEFAULT_PRICE);
    await vault.setMockPrice(await debtToken.getAddress(), DEFAULT_PRICE);

    // ---------------------------------------------------------------------
    // Fund the user with collateral and set approvals
    // ---------------------------------------------------------------------
    const depositAmount = ethers.parseEther("100"); // 100 collateral tokens

    await collateralToken.mint(user.address, depositAmount);
    await collateralToken
      .connect(user)
      .approve(await vault.getAddress(), depositAmount);

    // ---------------------------------------------------------------------
    // Execute deposit – should *not* revert (regression criteria)
    // ---------------------------------------------------------------------
    await expect(vault.connect(user).deposit(depositAmount, user.address)).to
      .not.be.reverted;

    // ---------------------------------------------------------------------
    // Post-conditions: user has received debt tokens, vault holds none
    // ---------------------------------------------------------------------
    const userDebtBal = await debtToken.balanceOf(user.address);
    const vaultDebtBal = await debtToken.balanceOf(await vault.getAddress());

    expect(userDebtBal).to.be.gt(0n, "user should receive borrowed debt");
    expect(vaultDebtBal).to.equal(0n, "vault should not retain debt tokens");
  });
});
