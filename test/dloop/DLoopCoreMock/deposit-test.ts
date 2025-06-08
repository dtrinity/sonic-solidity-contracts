import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import {
  ONE_HUNDRED_PERCENT_BPS,
  ONE_PERCENT_BPS,
} from "../../../typescript/common/bps_constants";
import {
  deployDLoopMockFixture,
  TARGET_LEVERAGE_BPS,
  testSetup,
} from "./fixture";

describe("DLoopCoreMock Deposit Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let mockPool: { getAddress: () => Promise<string> };
  // let deployer: string;
  let user1: string;
  // let user2: string;
  // let user3: string;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    mockPool = {
      getAddress: async (): Promise<string> => fixture.mockPool.address,
    };
    // deployer = fixture.deployer;
    user1 = fixture.user1.address;
    // user2 = fixture.user2;
    // user3 = fixture.user3;
    accounts = fixture.accounts;
  });

  describe("I. Basic Deposit Functionality", function () {
    const basicDepositTests = [
      {
        // First deposit establishes target leverage position
        name: "Should handle first deposit with target leverage",
        assets: ethers.parseEther("100"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
      {
        // Small deposits should work correctly
        name: "Should handle small deposit amounts",
        assets: ethers.parseEther("1"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
      {
        // Large deposits should work correctly
        name: "Should handle large deposit amounts",
        assets: ethers.parseEther("1000"),
        expectedLeverage: TARGET_LEVERAGE_BPS,
        userIndex: 1,
      },
    ];

    for (const testCase of basicDepositTests) {
      it(testCase.name, async function () {
        const user = accounts[testCase.userIndex];
        const userAddress = user.address;

        // Make sure initial leverage before deposit is 0
        const initialLeverage = await dloopMock.getCurrentLeverageBps();
        expect(initialLeverage).to.equal(0);

        // Check initial state
        expect(await dloopMock.totalSupply()).to.equal(0);
        expect(await dloopMock.totalAssets()).to.equal(0);
        expect(await dloopMock.balanceOf(userAddress)).to.equal(0);

        // Calculate expected values
        const expectedShares = await dloopMock.previewDeposit(testCase.assets);
        const expectedDebtAmount =
          (testCase.assets *
            BigInt(testCase.expectedLeverage - ONE_HUNDRED_PERCENT_BPS)) /
          BigInt(testCase.expectedLeverage);

        // Approve to allow the dloopMock to spend user's tokens
        await collateralToken
          .connect(user)
          .approve(await dloopMock.getAddress(), testCase.assets);

        // Perform deposit
        const tx = await dloopMock
          .connect(user)
          .deposit(testCase.assets, userAddress);

        // Verify shares minted
        expect(await dloopMock.balanceOf(userAddress)).to.equal(expectedShares);
        expect(await dloopMock.totalSupply()).to.equal(expectedShares);

        // Verify debt tokens transferred to user
        expect(await debtToken.balanceOf(userAddress)).to.be.gte(
          expectedDebtAmount,
        );

        // Verify collateral supplied to pool
        expect(
          await dloopMock.getMockCollateral(
            await dloopMock.getAddress(),
            await collateralToken.getAddress(),
          ),
        ).to.equal(testCase.assets);

        // Verify leverage is correct
        const currentLeverage = await dloopMock.getCurrentLeverageBps();
        expect(currentLeverage).to.be.closeTo(
          BigInt(testCase.expectedLeverage),
          BigInt(ONE_PERCENT_BPS),
        ); // Allow 1% tolerance

        // Verify event emission
        await expect(tx)
          .to.emit(dloopMock, "Deposit")
          .withArgs(userAddress, userAddress, testCase.assets, expectedShares);
      });
    }
  });

  describe("II. Deposit and price change", function () {
    const priceChangeTests = [
      {
        name: "Collateral price decrease, debt price increase",
        newCollateralPrice: ethers.parseEther("1.1"),
        newDebtPrice: ethers.parseEther("0.9"),
        expectedLeverage: 550 * ONE_PERCENT_BPS,
      },
      {
        name: "Collateral price increase, debt price increase",
        newCollateralPrice: ethers.parseEther("1.4"),
        newDebtPrice: ethers.parseEther("0.9"),
        expectedLeverage: 280 * ONE_PERCENT_BPS,
      },
      {
        name: "Collateral price increase, debt price decrease",
        newCollateralPrice: ethers.parseEther("1.4"),
        newDebtPrice: ethers.parseEther("0.6"),
        expectedLeverage: 175 * ONE_PERCENT_BPS,
      },
      {
        name: "Collateral price decrease, debt price decrease",
        newCollateralPrice: ethers.parseEther("0.8"),
        newDebtPrice: ethers.parseEther("0.6"),
        expectedLeverage: 400 * ONE_PERCENT_BPS,
      },
    ];

    for (const testCase of priceChangeTests) {
      it(`${testCase.name}, leverage ${TARGET_LEVERAGE_BPS / ONE_PERCENT_BPS}% -> ${testCase.expectedLeverage / ONE_PERCENT_BPS}%`, async function () {
        // Initialize a dLOOP deployment here, with the first deposit and have current leverage at TARGET_LEVERAGE_BPS
        const targetUser = accounts[1];
        const depositAmount = ethers.parseEther("100");
        const initialCollateralPrice = ethers.parseEther("1.2");
        const initialDebtPrice = ethers.parseEther("0.8");

        // Make sure initial leverage before deposit is 0
        const initialLeverage = await dloopMock.getCurrentLeverageBps();
        expect(initialLeverage).to.equal(0);

        // Check initial state
        expect(await dloopMock.totalSupply()).to.equal(0);
        expect(await dloopMock.totalAssets()).to.equal(0);
        expect(await dloopMock.balanceOf(targetUser.address)).to.equal(0);

        // Set collateral and debt price to initial values
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          initialCollateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          initialDebtPrice,
        );

        // Perform deposit
        const tx = await dloopMock
          .connect(targetUser)
          .deposit(depositAmount, targetUser.address);
        await tx.wait();

        // Verify leverage is correct
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          TARGET_LEVERAGE_BPS,
        );

        // Change the collateral and debt price
        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testCase.newCollateralPrice,
        );
        await dloopMock.setMockPrice(
          await debtToken.getAddress(),
          testCase.newDebtPrice,
        );

        // Check current leverage
        expect(await dloopMock.getCurrentLeverageBps()).to.equal(
          testCase.expectedLeverage,
        );
      });
    }
  });
});
