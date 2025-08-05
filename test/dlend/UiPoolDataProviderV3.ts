import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { UiPoolDataProviderV3 } from "../../typechain-types"; // Adjust path if needed for your structure
import { IPoolAddressesProvider } from "../../typechain-types";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { dLendFixture, DLendFixtureResult } from "./fixtures"; // Adjust path if needed for your structure

describe("dLEND UiPoolDataProviderV3", () => {
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;
  let uiPoolDataProvider: UiPoolDataProviderV3;
  let addressesProvider: IPoolAddressesProvider;
  let fixture: DLendFixtureResult;
  let dStableAsset: string;
  let collateralAsset: string;

  beforeEach(async () => {
    // Get signers
    const { deployer } = await hre.getNamedAccounts();
    deployerSigner = await hre.ethers.getSigner(deployer);
    [, user1Signer] = await ethers.getSigners();

    // Deploy fixture
    fixture = await dLendFixture();
    addressesProvider = fixture.contracts.poolAddressesProvider;

    // Get oracle address
    const priceOracleAddress = await addressesProvider.getPriceOracle();

    // Get wS token address
    const { contract: wSToken } = await getTokenContractForSymbol(
      hre,
      deployer,
      "wS",
    );

    // Deploy UiPoolDataProviderV3 with the oracle and wS token address
    const UiPoolDataProviderV3Factory = await ethers.getContractFactory(
      "UiPoolDataProviderV3",
    );
    uiPoolDataProvider = await UiPoolDataProviderV3Factory.deploy(
      priceOracleAddress,
      await wSToken.getAddress(),
    );

    // Get test assets from the fixture's assets mapping
    const assets = Object.entries(fixture.assets);
    dStableAsset =
      assets.find(([_, config]) => config.symbol === "dUSD")?.[0] || "";
    collateralAsset =
      assets.find(([_, config]) => config.ltv.toString() !== "0")?.[0] || "";

    if (!dStableAsset || !collateralAsset) {
      throw new Error("Could not find required test assets in fixture");
    }

    // Supply the dStable asset to the pool from the deployer to ensure liquidity for borrowing
    const dStableToken = await hre.ethers.getContractAt(
      "TestERC20",
      dStableAsset,
    );
    const dStableSupplyAmount = ethers.parseUnits("10000", 18); // Supply a large amount

    // Approve and supply the dStable to the pool
    await dStableToken
      .connect(deployerSigner)
      .approve(await fixture.contracts.pool.getAddress(), dStableSupplyAmount);
    await fixture.contracts.pool
      .connect(deployerSigner)
      .supply(dStableAsset, dStableSupplyAmount, deployerSigner.address, 0);
  });

  describe("getReservesList", () => {
    it("should return the list of all reserve assets matching the fixture", async () => {
      const reservesList =
        await uiPoolDataProvider.getReservesList(addressesProvider);
      const fixtureAssets = Object.keys(fixture.assets);

      expect(reservesList).to.have.lengthOf(fixtureAssets.length);

      for (const asset of reservesList) {
        expect(fixtureAssets).to.include(asset);
      }
    });
  });

  describe("getReservesData", () => {
    it("should return aggregated data for all reserves", async () => {
      const [reservesData, baseCurrencyInfo] =
        await uiPoolDataProvider.getReservesData(addressesProvider);
      const fixtureAssets = Object.keys(fixture.assets);

      expect(reservesData.length).to.equal(fixtureAssets.length);
      expect(reservesData.map((r) => r.underlyingAsset)).to.have.members(
        fixtureAssets,
      );
    });

    it("should return correct base currency information", async () => {
      const [_, baseCurrencyInfo] =
        await uiPoolDataProvider.getReservesData(addressesProvider);

      expect(baseCurrencyInfo.marketReferenceCurrencyUnit).to.equal(10 ** 8);
      expect(baseCurrencyInfo.marketReferenceCurrencyPriceInUsd).to.not.equal(
        0,
      );
      expect(baseCurrencyInfo.networkBaseTokenPriceInUsd).to.not.equal(0);
    });

    it("should return correct data points for a collateral asset", async () => {
      const [reservesData] =
        await uiPoolDataProvider.getReservesData(addressesProvider);
      const collateralData = reservesData.find(
        (r) => r.underlyingAsset === collateralAsset,
      );
      const fixtureAssetInfo = fixture.assets[collateralAsset];

      expect(collateralData).to.not.be.undefined;
      expect(collateralData!.usageAsCollateralEnabled).to.be.true;
      expect(collateralData!.baseLTVasCollateral).to.equal(
        fixtureAssetInfo.ltv,
      );
      expect(collateralData!.reserveLiquidationThreshold).to.equal(
        fixtureAssetInfo.liquidationThreshold,
      );
      expect(collateralData!.aTokenAddress).to.equal(fixtureAssetInfo.aToken);
      expect(collateralData!.variableDebtTokenAddress).to.equal(
        fixtureAssetInfo.variableDebtToken,
      );
      expect(collateralData!.stableDebtTokenAddress).to.equal(
        fixtureAssetInfo.stableDebtToken,
      );
    });

    it("should return correct data points for a dStable asset", async () => {
      const [reservesData] =
        await uiPoolDataProvider.getReservesData(addressesProvider);
      const dStableData = reservesData.find(
        (r) => r.underlyingAsset === dStableAsset,
      );
      const fixtureAssetInfo = fixture.assets[dStableAsset];

      expect(dStableData).to.not.be.undefined;
      expect(dStableData!.baseLTVasCollateral).to.equal(0);
      expect(dStableData!.borrowingEnabled).to.be.true;
      expect(dStableData!.isActive).to.be.true;
      expect(dStableData!.isFrozen).to.be.false;
    });
  });

  describe("getUserReservesData", () => {
    it("should return correct data for a user with deposits and borrows", async () => {
      // Setup: Supply collateral and borrow dStable
      const collateralAmount = ethers.parseEther("10");
      const borrowAmount = ethers.parseEther("5");

      const collateralToken = await ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );

      // Transfer tokens from deployer to user1 instead of minting
      await collateralToken
        .connect(deployerSigner)
        .transfer(user1Signer.address, collateralAmount);
      await collateralToken
        .connect(user1Signer)
        .approve(fixture.contracts.pool, collateralAmount);

      // Supply collateral
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(collateralAsset, collateralAmount, user1Signer.address, 0);

      // Enable collateral
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user1Signer)
        .borrow(dStableAsset, borrowAmount, 2, 0, user1Signer.address);

      // Get user data
      const [userReservesData, userEmodeCategoryId] =
        await uiPoolDataProvider.getUserReservesData(
          addressesProvider,
          user1Signer.address,
        );

      const collateralReserveData = userReservesData.find(
        (r) => r.underlyingAsset === collateralAsset,
      );
      const dStableReserveData = userReservesData.find(
        (r) => r.underlyingAsset === dStableAsset,
      );

      expect(collateralReserveData!.scaledATokenBalance).to.be.gt(0);
      expect(collateralReserveData!.usageAsCollateralEnabledOnUser).to.be.true;

      expect(dStableReserveData!.scaledVariableDebt).to.be.gt(0);
      expect(dStableReserveData!.principalStableDebt).to.equal(0);
    });

    it("should return zero/default data for a user with no positions", async () => {
      const [userReservesData, userEmodeCategoryId] =
        await uiPoolDataProvider.getUserReservesData(
          addressesProvider,
          user1Signer.address,
        );

      for (const reserveData of userReservesData) {
        expect(reserveData.scaledATokenBalance).to.equal(0);
        expect(reserveData.scaledVariableDebt).to.equal(0);
        expect(reserveData.principalStableDebt).to.equal(0);
      }

      expect(userEmodeCategoryId).to.equal(0);
    });
  });
});
