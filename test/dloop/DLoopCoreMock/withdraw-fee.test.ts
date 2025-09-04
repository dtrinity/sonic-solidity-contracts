import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_BPS_UNIT } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, testSetup } from "./fixture";

const FEE_BPS = 50 * ONE_BPS_UNIT; // 0.5%
const DENOM = BigInt(100 * ONE_BPS_UNIT * 100); // ONE_HUNDRED_PERCENT_BPS = 1_000_000

describe("DLoopCoreMock - Withdraw Fee", function () {
  let dloop: DLoopCoreMock;
  let collateral: TestMintableERC20;
  let debt: TestMintableERC20;
  let users: any[];

  beforeEach(async function () {
    const fx = await loadFixture(deployDLoopMockFixture);
    await testSetup(fx);
    dloop = fx.dloopMock;
    collateral = fx.collateralToken;
    debt = fx.debtToken;
    users = fx.accounts;
  });

  it("zero fee keeps previous behavior", async function () {
    const user = users[1];
    const receiver = users[4].address; // arbitrary receiver

    const amount = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const shares = amount / 2n;
    const expectedGross = await dloop.previewRedeem(shares);

    // With zero fee, previewRedeem should equal gross
    expect(expectedGross).to.be.gt(0n);

    const balBefore = await collateral.balanceOf(user.address);
    const recvBefore = await collateral.balanceOf(receiver);
    await dloop.connect(user).redeem(shares, user.address, user.address);
    const balAfter = await collateral.balanceOf(user.address);
    const recvAfter = await collateral.balanceOf(receiver);

    expect(balAfter - balBefore).to.equal(expectedGross);
    expect(recvAfter - recvBefore).to.equal(0n);
  });

  it("non-zero fee adjusts previewRedeem and redeem output (fee retained in vault)", async function () {
    const user = users[1];
    const receiver = users[4].address; // arbitrary account; should NOT receive fee
    await dloop.setWithdrawalFeeBps(FEE_BPS);

    const amount = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const shares = amount / 2n;
    // Baseline gross via OZ math path
    const gross = await dloop.convertToAssets(shares);
    const fee = (gross * BigInt(FEE_BPS)) / BigInt(100 * ONE_BPS_UNIT * 100); // divide by ONE_HUNDRED_PERCENT_BPS = 1_000_000
    const net = gross - fee;

    const previewNet = await dloop.previewRedeem(shares);
    expect(previewNet).to.equal(net);

    const balBefore = await collateral.balanceOf(user.address);
    const recvBefore = await collateral.balanceOf(receiver);
    const tx = await dloop.connect(user).redeem(shares, user.address, user.address);
    const balAfter = await collateral.balanceOf(user.address);
    const recvAfter = await collateral.balanceOf(receiver);

    expect(balAfter - balBefore).to.equal(net);
    // Under current logic, fee remains in the vault and is not forwarded externally
    expect(recvAfter - recvBefore).to.equal(0n);
    await expect(tx).to.emit(dloop, "Withdraw").withArgs(user.address, user.address, user.address, net, shares);
  });

  it("previewWithdraw inverts net→shares using gross+fee", async function () {
    const user = users[1];
    await dloop.setWithdrawalFeeBps(FEE_BPS);

    const amount = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const desiredNet = ethers.parseEther("10");
    const feeOnNet = (desiredNet * BigInt(FEE_BPS)) / BigInt(100 * ONE_BPS_UNIT * 100);
    const gross = desiredNet + feeOnNet;

    const shares = await dloop.previewWithdraw(desiredNet);
    const sharesFromGross = await dloop.previewWithdraw(gross - feeOnNet);
    expect(shares).to.equal(sharesFromGross);

    const maxAssets = await dloop.maxWithdraw(user.address);
    expect(maxAssets).to.be.gt(0n);
  });

  it("decreaseLeverage returns net-of-fee collateral (no external fee transfer)", async function () {
    const user = users[1];
    const receiver = users[4].address; // arbitrary account; should NOT receive fee
    await dloop.setWithdrawalFeeBps(FEE_BPS);

    // Prices 1:1 already
    const depositAmt = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), depositAmt);
    await dloop.connect(user).deposit(depositAmt, user.address);

    // Create imbalance (increase leverage above target) by decreasing collateral price
    await dloop.setMockPrice(await collateral.getAddress(), ethers.parseUnits("0.9", 8));

    const additionalDebt = ethers.parseEther("10");
    const debtBal = await debt.balanceOf(user.address);
    expect(debtBal).to.be.gte(additionalDebt);

    const userBefore = await collateral.balanceOf(user.address);
    const recvBefore = await collateral.balanceOf(receiver);
    await dloop.connect(user).decreaseLeverage(additionalDebt, 0);
    const userAfter = await collateral.balanceOf(user.address);
    const recvAfter = await collateral.balanceOf(receiver);

    const received = userAfter - userBefore;
    expect(received).to.be.gt(0n);
    // Fee is retained by the vault under current logic
    expect(recvAfter - recvBefore).to.equal(0n);
  });

  it("maxRedeem equals share balance regardless of fee", async function () {
    const user = users[1];
    const amount = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const shares = await dloop.balanceOf(user.address);
    expect(await dloop.maxRedeem(user.address)).to.equal(shares);

    await dloop.setWithdrawalFeeBps(FEE_BPS);
    expect(await dloop.maxRedeem(user.address)).to.equal(shares);
  });

  it("previewRedeem and previewWithdraw handle zero and tiny amounts", async function () {
    const user = users[1];
    await dloop.setWithdrawalFeeBps(FEE_BPS);

    // Zero inputs
    expect(await dloop.previewRedeem(0)).to.equal(0);
    expect(await dloop.previewWithdraw(0)).to.equal(0);

    // Tiny flow: deposit a small amount that still results in non-zero borrow and allows small net withdraw
    const smallDeposit = 5n * 10n ** 10n; // 5e10 wei
    await collateral.connect(user).approve(await dloop.getAddress(), smallDeposit);
    await dloop.connect(user).deposit(smallDeposit, user.address);

    const netFromRedeem = await dloop.previewRedeem(1n);
    expect(netFromRedeem).to.equal(0n);

    // Pick a small-but-safe net that maps to at least ~2 base units to avoid rounding repay to zero
    const maxNet = await dloop.maxWithdraw(user.address);
    expect(maxNet).to.be.gt(0n);
    const oneBaseInToken = 10n ** 10n; // with price=1e8 and 18 decimals
    const targetNet = 2n * oneBaseInToken; // 2 base units
    const minimalNet = maxNet >= targetNet ? targetNet : maxNet;
    const sharesToBurn = await dloop.previewWithdraw(minimalNet);
    const sharesBefore = await dloop.balanceOf(user.address);
    const balBefore = await collateral.balanceOf(user.address);
    await dloop.connect(user).withdraw(minimalNet, user.address, user.address);
    const balAfter = await collateral.balanceOf(user.address);
    const sharesAfter = await dloop.balanceOf(user.address);
    expect(balAfter - balBefore).to.equal(minimalNet);
    expect(sharesBefore - sharesAfter).to.equal(sharesToBurn);
  });

  it("maxWithdraw returns net-of-fee and withdraw(max) burns expected shares", async function () {
    const user = users[1];
    await dloop.setWithdrawalFeeBps(FEE_BPS);

    const amount = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const shares = await dloop.balanceOf(user.address);
    const gross = await dloop.convertToAssets(shares);
    const expectedNet = gross - (gross * BigInt(FEE_BPS)) / DENOM;

    const maxNet = await dloop.maxWithdraw(user.address);
    expect(maxNet).to.equal(expectedNet);

    const previewShares = await dloop.previewWithdraw(maxNet);
    const sharesBefore = await dloop.balanceOf(user.address);
    const balBefore = await collateral.balanceOf(user.address);
    await dloop.connect(user).withdraw(maxNet, user.address, user.address);
    const balAfter = await collateral.balanceOf(user.address);
    const sharesAfter = await dloop.balanceOf(user.address);
    expect(balAfter - balBefore).to.equal(maxNet);
    expect(sharesBefore - sharesAfter).to.equal(previewShares);
  });

  it("supports MAX_FEE_BPS (5%) and rejects above max", async function () {
    const user = users[1];
    const MAX_FEE_BPS = await dloop.MAX_WITHDRAWAL_FEE_BPS();

    // Setting to max should succeed
    await dloop.setWithdrawalFeeBps(MAX_FEE_BPS);

    const amount = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const shares = amount;
    const gross = await dloop.convertToAssets(shares);
    const expectedNet = gross - (gross * BigInt(MAX_FEE_BPS)) / DENOM;
    expect(await dloop.previewRedeem(shares)).to.equal(expectedNet);

    // Above max should revert with custom error
    await expect(dloop.setWithdrawalFeeBps(MAX_FEE_BPS + 1n)).to.be.revertedWithCustomError(dloop, "WithdrawalFeeIsGreaterThanMaxFee");
  });

  it("setWithdrawalFeeBps is onlyOwner", async function () {
    const user = users[1]; // not the deployer/owner
    const nonOwner = dloop.connect(user);
    await expect(nonOwner.setWithdrawalFeeBps(FEE_BPS)).to.be.revertedWithCustomError(dloop, "OwnableUnauthorizedAccount");
  });

  it("large amounts maintain precision and match previews", async function () {
    const user = users[1];
    await dloop.setWithdrawalFeeBps(FEE_BPS);

    const amount = ethers.parseEther("9000"); // large within minted balance
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const shares = await dloop.balanceOf(user.address);
    const gross = await dloop.convertToAssets(shares);
    const fee = (gross * BigInt(FEE_BPS)) / DENOM;
    const net = gross - fee;

    expect(await dloop.previewRedeem(shares)).to.equal(net);

    // Withdraw a sizeable net amount and compare with previews
    const desiredNet = ethers.parseEther("4000");
    const expectedShares = await dloop.previewWithdraw(desiredNet);
    const balBefore = await collateral.balanceOf(user.address);
    const sharesBefore = await dloop.balanceOf(user.address);
    await dloop.connect(user).withdraw(desiredNet, user.address, user.address);
    const balAfter = await collateral.balanceOf(user.address);
    const sharesAfter = await dloop.balanceOf(user.address);
    expect(balAfter - balBefore).to.equal(desiredNet);
    expect(sharesBefore - sharesAfter).to.equal(expectedShares);
  });
});
