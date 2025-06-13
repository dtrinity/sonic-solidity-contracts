import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import {
  DEFAULT_PRICE,
  deployDLoopMockFixture,
  LOWER_BOUND_BPS,
  MAX_SUBSIDY_BPS,
  TARGET_LEVERAGE_BPS,
  testSetup,
  UPPER_BOUND_BPS,
} from "./fixture";

describe("DLoopCoreMock Mock Methods Tests", function () {
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let debtToken: TestMintableERC20;
  let mockPool: { getAddress: () => Promise<string> };
  let user1: string;

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    debtToken = fixture.debtToken;
    mockPool = {
      getAddress: async (): Promise<string> => fixture.mockPool.address,
    };
    user1 = fixture.user1.address;
  });

  describe("I. Constructor and Initial State", function () {
    it("Constructor: Valid parameters with proper allowances", async function () {
      // This test will pass if our fixture setup works correctly
      expect(await dloopMock.name()).to.equal("Mock dLoop Vault");
      expect(await dloopMock.symbol()).to.equal("mdLOOP");
      expect(await dloopMock.targetLeverageBps()).to.equal(TARGET_LEVERAGE_BPS);
      expect(await dloopMock.lowerBoundTargetLeverageBps()).to.equal(
        LOWER_BOUND_BPS,
      );
      expect(await dloopMock.upperBoundTargetLeverageBps()).to.equal(
        UPPER_BOUND_BPS,
      );
      expect(await dloopMock.maxSubsidyBps()).to.equal(MAX_SUBSIDY_BPS);
    });

    it("Should have correct initial state", async function () {
      const mockPoolAddress = await mockPool.getAddress();
      expect(await dloopMock.mockPool()).to.equal(mockPoolAddress);

      // Check that prices are set correctly
      expect(
        await dloopMock.getMockPrice(await collateralToken.getAddress()),
      ).to.equal(DEFAULT_PRICE);
      expect(
        await dloopMock.getMockPrice(await debtToken.getAddress()),
      ).to.equal(DEFAULT_PRICE);
    });
  });

  describe("II. Mock Functions", function () {
    describe("Price Setting", function () {
      it("Should set and get mock prices", async function () {
        const testPrice = 250000000; // 2.5 in 8 decimals

        await dloopMock.setMockPrice(
          await collateralToken.getAddress(),
          testPrice,
        );
        expect(
          await dloopMock.getMockPrice(await collateralToken.getAddress()),
        ).to.equal(testPrice);
      });
    });

    describe("Collateral Management", function () {
      it("Should set mock collateral for user", async function () {
        const amount = ethers.parseEther("100");
        await dloopMock.setMockCollateral(
          user1,
          await collateralToken.getAddress(),
          amount,
        );
        expect(
          await dloopMock.getMockCollateral(
            user1,
            await collateralToken.getAddress(),
          ),
        ).to.equal(amount);
      });
    });

    describe("Debt Management", function () {
      it("Should set mock debt for user", async function () {
        const amount = ethers.parseEther("50");
        await dloopMock.setMockDebt(
          user1,
          await debtToken.getAddress(),
          amount,
        );
        expect(
          await dloopMock.getMockDebt(user1, await debtToken.getAddress()),
        ).to.equal(amount);
      });
    });
  });
});
