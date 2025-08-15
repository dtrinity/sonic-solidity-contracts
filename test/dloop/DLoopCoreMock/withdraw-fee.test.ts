import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { ONE_BPS_UNIT } from "../../../typescript/common/bps_constants";
import { deployDLoopMockFixture, testSetup } from "./fixture";

const FEE_BPS = 50 * ONE_BPS_UNIT; // 0.5%

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
    await (dloop as any).setFeeReceiver(receiver);

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

  it("non-zero fee adjusts previewRedeem and redeem output and forwards fee", async function () {
    const user = users[1];
    const receiver = users[4].address;
    await (dloop as any).setFeeBps(FEE_BPS);
    await (dloop as any).setFeeReceiver(receiver);

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
    const tx = await dloop
      .connect(user)
      .redeem(shares, user.address, user.address);
    const balAfter = await collateral.balanceOf(user.address);
    const recvAfter = await collateral.balanceOf(receiver);

    expect(balAfter - balBefore).to.equal(net);
    expect(recvAfter - recvBefore).to.equal(fee);
    await expect(tx)
      .to.emit(dloop, "Withdraw")
      .withArgs(user.address, user.address, user.address, net, shares);
  });

  it("previewWithdraw inverts net→shares using gross+fee", async function () {
    const user = users[1];
    await (dloop as any).setFeeBps(FEE_BPS);
    await (dloop as any).setFeeReceiver(users[4].address);

    const amount = ethers.parseEther("100");
    await collateral.connect(user).approve(await dloop.getAddress(), amount);
    await dloop.connect(user).deposit(amount, user.address);

    const desiredNet = ethers.parseEther("10");
    const feeOnNet =
      (desiredNet * BigInt(FEE_BPS)) / BigInt(100 * ONE_BPS_UNIT * 100);
    const gross = desiredNet + feeOnNet;

    const shares = await dloop.previewWithdraw(desiredNet);
    const sharesFromGross = await dloop.previewWithdraw(gross - feeOnNet);
    expect(shares).to.equal(sharesFromGross);

    const maxAssets = await dloop.maxWithdraw(user.address);
    expect(maxAssets).to.be.gt(0n);
  });

  it("decreaseLeverage returns net-of-fee collateral and forwards fee", async function () {
    const user = users[1];
    const receiver = users[4].address;
    await (dloop as any).setFeeBps(FEE_BPS);
    await (dloop as any).setFeeReceiver(receiver);

    // Prices 1:1 already
    const depositAmt = ethers.parseEther("100");
    await collateral
      .connect(user)
      .approve(await dloop.getAddress(), depositAmt);
    await dloop.connect(user).deposit(depositAmt, user.address);

    // Create imbalance (increase leverage above target) by decreasing collateral price
    await dloop.setMockPrice(
      await collateral.getAddress(),
      ethers.parseUnits("0.9", 8),
    );

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
    expect(recvAfter - recvBefore).to.be.gt(0n);
  });
});
