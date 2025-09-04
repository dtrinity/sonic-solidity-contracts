import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

import { AaveProtocolDataProvider } from "../../typechain-types";
import { dLendFixture, DLendFixtureResult } from "./fixtures";

describe("dLEND AaveProtocolDataProvider", () => {
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;
  let dataProvider: AaveProtocolDataProvider;
  let dStableAsset: string;
  let collateralAsset: string;
  let fixture: DLendFixtureResult;

  beforeEach(async () => {
    // Get signers
    const { deployer, user1 } = await hre.getNamedAccounts();
    deployerSigner = await hre.ethers.getSigner(deployer);
    user1Signer = await hre.ethers.getSigner(user1);

    // Load the fixture
    fixture = await dLendFixture();
    dataProvider = fixture.contracts.dataProvider;

    // Identify dStable and collateral assets from fixture
    dStableAsset = fixture.dStables.dUSD; // Using dUSD for testing

    // Find a non-dStable collateral asset
    collateralAsset = Object.keys(fixture.assets).find(
      (asset) => fixture.assets[asset].ltv !== BigInt(0),
    )!;

    if (!dStableAsset || !collateralAsset) {
      throw new Error(
        "Could not find required test assets in fixture: need dStable and collateral",
      );
    }

    // Supply the dStable asset from deployer to ensure initial liquidity is present for testing
    const dStableToken = await hre.ethers.getContractAt(
      "TestERC20",
      dStableAsset,
    );
    const dStableSupplyAmount = ethers.parseUnits("1000", 18);
    await dStableToken
      .connect(deployerSigner)
      .approve(await fixture.contracts.pool.getAddress(), dStableSupplyAmount);
    await fixture.contracts.pool
      .connect(deployerSigner)
      .supply(dStableAsset, dStableSupplyAmount, deployerSigner.address, 0);
  });

  describe("Reserve Configuration Data (`getReserveConfigurationData`)", () => {
    it("should return correct configuration data for a collateral reserve", async () => {
      const config =
        await dataProvider.getReserveConfigurationData(collateralAsset);
      const assetInfo = fixture.assets[collateralAsset];
      const token = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset,
      );
      const decimals = await token.decimals();

      expect(config.decimals).to.equal(decimals);
      expect(config.ltv).to.equal(assetInfo.ltv);
      expect(config.liquidationThreshold).to.equal(
        assetInfo.liquidationThreshold,
      );
      expect(config.ltv).to.be.gt(0); // Collateral should have LTV > 0
      expect(config.liquidationThreshold).to.be.gte(config.ltv);
      expect(config.borrowingEnabled).to.equal(assetInfo.borrowingEnabled);
      expect(config.isActive).to.be.true;
      expect(config.isFrozen).to.be.false;
    });

    it("should return correct configuration data for a dStable reserve", async () => {
      const config =
        await dataProvider.getReserveConfigurationData(dStableAsset);
      const assetInfo = fixture.assets[dStableAsset];
      const token = await hre.ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dStableAsset,
      );
      const decimals = await token.decimals();

      expect(config.decimals).to.equal(decimals);
      expect(config.ltv).to.equal(0); // dStable LTV must be 0
      expect(config.liquidationThreshold).to.equal(
        assetInfo.liquidationThreshold,
      );
      expect(config.borrowingEnabled).to.be.true; // dStables should be borrowable
      expect(config.isActive).to.be.true;
      expect(config.isFrozen).to.be.false;
    });
  });

  describe("Reserve Token Addresses (`getReserveTokensAddresses`)", () => {
    it("should return correct token addresses for a collateral reserve", async () => {
      const addresses =
        await dataProvider.getReserveTokensAddresses(collateralAsset);
      const assetInfo = fixture.assets[collateralAsset];

      expect(addresses.aTokenAddress).to.equal(assetInfo.aToken);
      expect(addresses.stableDebtTokenAddress).to.equal(
        assetInfo.stableDebtToken,
      );
      expect(addresses.variableDebtTokenAddress).to.equal(
        assetInfo.variableDebtToken,
      );
    });

    it("should return correct token addresses for a dStable reserve", async () => {
      const addresses =
        await dataProvider.getReserveTokensAddresses(dStableAsset);
      const assetInfo = fixture.assets[dStableAsset];

      expect(addresses.aTokenAddress).to.equal(assetInfo.aToken);
      expect(addresses.stableDebtTokenAddress).to.equal(
        assetInfo.stableDebtToken,
      );
      expect(addresses.variableDebtTokenAddress).to.equal(
        assetInfo.variableDebtToken,
      );
    });
  });

  describe("All Reserves Data (`getAllReservesTokens`, `getAllATokens`)", () => {
    it("should return correct data for all reserves", async () => {
      const allReserves = await dataProvider.getAllReservesTokens();
      const expectedReservesCount = Object.keys(fixture.assets).length;

      expect(allReserves.length).to.equal(expectedReservesCount);

      // Verify a known collateral asset is present
      const collateralReserve = allReserves.find(
        (r) => r.tokenAddress === collateralAsset,
      );
      expect(collateralReserve).to.not.be.undefined;
      expect(collateralReserve?.symbol).to.equal(
        fixture.assets[collateralAsset].symbol,
      );

      // Verify a known dStable asset is present
      const dStableReserve = allReserves.find(
        (r) => r.tokenAddress === dStableAsset,
      );
      expect(dStableReserve).to.not.be.undefined;
      expect(dStableReserve?.symbol).to.equal(
        fixture.assets[dStableAsset].symbol,
      );
    });

    it("should return correct data for all aTokens", async () => {
      const allATokens = await dataProvider.getAllATokens();
      const expectedATokensCount = Object.keys(
        fixture.contracts.aTokens,
      ).length;

      expect(allATokens.length).to.equal(expectedATokensCount);

      // Verify a known collateral aToken is present
      const collateralATokenInfo = allATokens.find(
        (t) => t.tokenAddress === fixture.assets[collateralAsset].aToken,
      );
      expect(collateralATokenInfo).to.not.be.undefined;
      // Potential improvement: Check symbol if AToken symbol follows a standard pattern

      // Verify a known dStable aToken is present
      const dStableATokenInfo = allATokens.find(
        (t) => t.tokenAddress === fixture.assets[dStableAsset].aToken,
      );
      expect(dStableATokenInfo).to.not.be.undefined;
    });
  });

  describe("Aggregated Reserve Data (`getReserveData`)", () => {
    it("should return correct aggregated data for a dStable reserve with initial liquidity", async () => {
      const [
        unbacked,
        accruedToTreasuryScaled,
        totalAToken,
        totalStableDebt,
        totalVariableDebt,
        liquidityRate,
        variableBorrowRate,
        stableBorrowRate,
      ] = await dataProvider.getReserveData(dStableAsset);

      const dUsdToken = await hre.ethers.getContractAt(
        "TestERC20",
        dStableAsset,
      );
      const aToken = fixture.contracts.aTokens[dStableAsset];
      const aTokenAddress = await aToken.getAddress();
      const actualATokenBalance = await dUsdToken.balanceOf(aTokenAddress);
      const aTokenTotalSupply = await aToken.totalSupply();

      // Check returned values based on the *actual* contract signature
      expect(unbacked).to.equal(0, "Value at index 0 (unbacked) should be 0");

      expect(totalAToken).to.equal(
        aTokenTotalSupply,
        "Value at index 2 (totalAToken) should match aToken total supply",
      );
      expect(totalAToken).to.be.closeTo(
        actualATokenBalance,
        ethers.parseUnits("0.01", 18),
        "Value at index 2 (totalAToken) should be close to aToken underlying balance",
      );

      expect(totalStableDebt).to.equal(
        0,
        "Value at index 3 (totalStableDebt) should be 0",
      );
      expect(totalVariableDebt).to.equal(
        0,
        "Value at index 4 (totalVariableDebt) should be 0",
      );

      expect(liquidityRate).to.be.gte(
        0,
        "Value at index 5 (liquidityRate) should be >= 0",
      );
      expect(variableBorrowRate).to.be.gte(
        0,
        "Value at index 6 (variableBorrowRate) should be >= 0",
      );
      expect(stableBorrowRate).to.be.gte(
        0,
        "Value at index 7 (stableBorrowRate) should be >= 0",
      );
    });

    it("should return correct aggregated data for a collateral reserve with no initial liquidity (except deployer)", async () => {
      const [
        unbacked,
        accruedToTreasuryScaled,
        totalAToken,
        totalStableDebt,
        totalVariableDebt,
      ] = await dataProvider.getReserveData(collateralAsset);

      expect(unbacked).to.equal(0);
      expect(totalAToken).to.equal(0);
      expect(totalStableDebt).to.equal(0);
      expect(totalVariableDebt).to.equal(0);
    });
  });

  describe("User Reserve Data (`getUserReserveData`)", () => {
    it("should return correct data for a user who supplied initial liquidity", async () => {
      const userData = await dataProvider.getUserReserveData(
        dStableAsset,
        deployerSigner.address,
      );
      const aToken = fixture.contracts.aTokens[dStableAsset];
      const expectedATokenBalance = await aToken.balanceOf(
        deployerSigner.address,
      );

      expect(userData.currentATokenBalance).to.equal(expectedATokenBalance);
      expect(userData.currentATokenBalance).to.be.gt(0);
      expect(userData.currentStableDebt).to.equal(0);
      expect(userData.currentVariableDebt).to.equal(0);
      expect(userData.principalStableDebt).to.equal(0);
      expect(userData.scaledVariableDebt).to.equal(0);
      expect(userData.stableBorrowRate).to.equal(0);
      expect(userData.liquidityRate).to.be.gte(0);
      expect(userData.usageAsCollateralEnabled).to.be.false;
    });

    it("should return zero values for a user with no position in a reserve", async () => {
      const userData = await dataProvider.getUserReserveData(
        collateralAsset,
        user1Signer.address,
      );

      expect(userData.currentATokenBalance).to.equal(0);
      expect(userData.currentStableDebt).to.equal(0);
      expect(userData.currentVariableDebt).to.equal(0);
      expect(userData.principalStableDebt).to.equal(0);
      expect(userData.scaledVariableDebt).to.equal(0);
      expect(userData.stableBorrowRate).to.equal(0);
      expect(userData.liquidityRate).to.be.gte(0);
      expect(userData.usageAsCollateralEnabled).to.be.false;
    });
  });
});
