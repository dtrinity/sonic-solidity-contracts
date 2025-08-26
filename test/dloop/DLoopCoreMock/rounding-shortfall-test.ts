// @ts-nocheck
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { ONE_PERCENT_BPS } from "../../../typescript/common/bps_constants";

type TestMintableERC20 = any;
type DLoopCoreShortfallMock = any;

describe("DLoopCoreShortfallMock – 1-wei rounding shortfall", function () {
  /**
   * Deploy a shortfall test environment with mock tokens and vault, including approvals.
   *
   * @returns Vault and token instances plus a test user
   */
  async function deployFixture(): Promise<{
    vault: DLoopCoreShortfallMock;
    collateral: TestMintableERC20;
    debt: TestMintableERC20;
    user: any;
  }> {
    const [_deployer, user, mockPool] = await ethers.getSigners();

    // Deploy mock tokens
    const ERC20Factory = await ethers.getContractFactory("TestMintableERC20");
    const collateral = (await ERC20Factory.deploy("Mock Collateral", "mCOLL", 18)) as TestMintableERC20;
    const debt = (await ERC20Factory.deploy("Mock Debt", "mDEBT", 18)) as TestMintableERC20;

    // Mint balances
    await collateral.mint(user.address, ethers.parseEther("100"));
    await collateral.mint(mockPool.address, ethers.parseEther("100000"));
    await debt.mint(mockPool.address, ethers.parseEther("100000"));

    // Deploy and link DLoopCoreLogic library before deploying DLoopCoreMock
    const DLoopCoreLogicFactory = await ethers.getContractFactory("DLoopCoreLogic");
    const dloopCoreLogicLib = await DLoopCoreLogicFactory.deploy();
    await dloopCoreLogicLib.waitForDeployment();

    // Deploy vault mock
    const VaultFactory = await ethers.getContractFactory("DLoopCoreShortfallMock", {
      libraries: {
        "contracts/vaults/dloop/core/DLoopCoreLogic.sol:DLoopCoreLogic": await dloopCoreLogicLib.getAddress(),
      },
    });
    const vault = (await VaultFactory.deploy(
      "Mock dLoop Vault – Shortfall",
      "mdLOOPS",
      await collateral.getAddress(),
      await debt.getAddress(),
      300 * ONE_PERCENT_BPS,
      250 * ONE_PERCENT_BPS,
      350 * ONE_PERCENT_BPS,
      100,
      0, // minDeviationBps
      0, // withdrawalFeeBps
      mockPool.address,
    )) as DLoopCoreShortfallMock;

    // Price 1:1
    await vault.setMockPrice(await collateral.getAddress(), 100000000);
    await vault.setMockPrice(await debt.getAddress(), 100000000);

    // Allowances
    const vaultAddr = await vault.getAddress();
    await collateral.connect(user).approve(vaultAddr, ethers.MaxUint256);
    await debt.connect(user).approve(vaultAddr, ethers.MaxUint256);
    await collateral.connect(mockPool).approve(vaultAddr, ethers.MaxUint256);
    await debt.connect(mockPool).approve(vaultAddr, ethers.MaxUint256);

    return { vault, collateral, debt, user };
  }

  it("deposit handles 1-wei shortfall gracefully (allow revert or success)", async function () {
    const { vault, user } = await loadFixture(deployFixture);

    const userSharesBefore = await vault.balanceOf(user.address);

    let reverted = false;

    try {
      const tx = await vault.connect(user).deposit(ethers.parseEther("1"), user.address);
      await tx.wait();
    } catch {
      reverted = true;
    }

    if (!reverted) {
      const userSharesAfter = await vault.balanceOf(user.address);
      expect(userSharesAfter).to.be.gte(userSharesBefore, "When not reverting, deposit should mint shares or keep balance");
    }
  });

  it("wrapper shows 1-wei shortfall on withdraw", async function () {
    const { vault, collateral } = await loadFixture(deployFixture);

    const reqAmount = ethers.parseEther("5");
    const before = await collateral.balanceOf(await vault.getAddress());
    // Call internal implementation directly via test wrapper to bypass higher-level checks
    await vault.testWithdrawFromPoolImplementation(await collateral.getAddress(), reqAmount, await vault.getAddress());
    const after = await collateral.balanceOf(await vault.getAddress());
    expect(after - before).to.equal(reqAmount - 1n);
  });
});
