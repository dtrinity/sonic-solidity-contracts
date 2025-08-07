import { expect } from "chai";
import { parseUnits } from "ethers";
import { ethers } from "hardhat";

// Helper for 18-decimals BigInt conversion (ethers v6)
const toWei = (value: string | number) => parseUnits(value.toString(), 18);

describe("DPoolVaultLP – Withdraw event", () => {
  let deployer: any;
  let user: any;
  let token: any; // Will be `MockERC20`, but `any` avoids type-generation dependency
  let vault: any; // Will be `DPoolVaultLPMock`

  const INITIAL_SUPPLY = toWei("1000000"); // 1 000 000 LP tokens
  const WITHDRAWAL_FEE_BPS = 200n; // 2 %

  beforeEach(async () => {
    [deployer, user] = await ethers.getSigners();

    // Deploy mock LP token with 18 decimals
    const MockTokenFactory = await ethers.getContractFactory("MockERC20");
    token = await MockTokenFactory.deploy("Mock LP", "mLP", INITIAL_SUPPLY);

    // Deploy vault
    const VaultFactory = await ethers.getContractFactory("DPoolVaultLPMock");
    vault = await VaultFactory.deploy(await token.getAddress());

    // Approvals
    await token.connect(user).approve(await vault.getAddress(), INITIAL_SUPPLY);
    await token.approve(await vault.getAddress(), INITIAL_SUPPLY);

    // Fund user with 1 000 LP tokens
    await token.transfer(user.address, toWei(1000));

    // Set 2 % withdrawal fee
    await vault.setWithdrawalFee(Number(WITHDRAWAL_FEE_BPS));

    // Deposit 1 000 LP
    await vault.connect(user).deposit(toWei(1000), user.address);
  });

  it("emits Withdraw event with NET assets (after fee)", async () => {
    const netAssets = toWei(500); // User wishes to receive 500 LP

    // Preview shares required
    const sharesNeeded: bigint = await vault.previewWithdraw(netAssets);

    // Gross assets = net / (1-fee)
    const grossAssetsExpected =
      (netAssets * 10000n) / (10000n - WITHDRAWAL_FEE_BPS);

    // User LP balance before
    const balanceBefore: bigint = await token.balanceOf(user.address);

    // Execute withdrawal
    const tx = await vault
      .connect(user)
      .withdraw(netAssets, user.address, user.address);

    // Expect event to emit **net** assets
    await expect(tx)
      .to.emit(vault, "Withdraw")
      .withArgs(
        user.address,
        user.address,
        user.address,
        netAssets,
        sharesNeeded,
      );

    // Validate token transfer amount == net assets
    const balanceAfter: bigint = await token.balanceOf(user.address);
    expect(balanceAfter - balanceBefore).to.equal(netAssets);

    // Vault balance should have decreased only by the NET amount; fee stays inside the vault
    const vaultBalance: bigint = await token.balanceOf(
      await vault.getAddress(),
    );
    expect(vaultBalance).to.equal(toWei(1000) - netAssets);
  });
});
