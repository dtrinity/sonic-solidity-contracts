import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { dLendFixture } from "./fixtures";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { DLendFixtureResult } from "./fixtures";
import { POOL_ADDRESSES_PROVIDER_ID } from "../../typescript/deploy-ids";
import {
  ACLManager,
  Pool,
  PoolAddressesProvider,
  PoolConfigurator,
  IPoolDataProvider,
  TestERC20,
  ERC20StablecoinUpgradeable,
} from "../../typechain-types";

describe("dLEND Pool", () => {
  // Test fixture and common variables
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let pool: Pool;
  let dStableAsset: string;
  let collateralAsset: string;
  let fixture: DLendFixtureResult;

  beforeEach(async () => {
    // Get signers
    [deployer, user] = await ethers.getSigners();

    // Load the fixture
    fixture = await dLendFixture();
    pool = fixture.contracts.pool;

    // Get the ACL Manager
    const addressesProvider = await hre.ethers.getContractAt(
      "PoolAddressesProvider",
      (await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID)).address
    );
    const aclManager = await hre.ethers.getContractAt(
      "ACLManager",
      await addressesProvider.getACLManager()
    );

    // Grant POOL_ADMIN_ROLE to deployer
    await aclManager.addPoolAdmin(deployer.address);

    // Get reserves
    const reservesList = await pool.getReservesList();
    console.log("Available reserves:", reservesList);

    // Get contract instances and configuration for each reserve
    for (const asset of reservesList) {
      const reserveData = await pool.getReserveData(asset);
      const config =
        await fixture.contracts.dataProvider.getReserveConfigurationData(asset);

      // Get token contracts
      const tokenContract = await hre.ethers.getContractAt("TestERC20", asset);
      const symbol = await tokenContract.symbol();

      // Store asset configuration
      fixture.assets[asset] = {
        address: asset,
        aToken: reserveData.aTokenAddress,
        stableDebtToken: reserveData.stableDebtTokenAddress,
        variableDebtToken: reserveData.variableDebtTokenAddress,
        borrowingEnabled: config.borrowingEnabled,
        ltv: config.ltv,
        liquidationThreshold: config.liquidationThreshold,
        symbol,
      };

      // Log reserve configuration
      console.log(`Reserve ${asset} (${symbol}):`, {
        borrowingEnabled: config.borrowingEnabled,
        ltv: config.ltv.toString(),
        liquidationThreshold: config.liquidationThreshold.toString(),
      });
    }

    // Find a dStable asset and a collateral asset
    dStableAsset = fixture.dStables.dUSD; // Default to dUSD as the dStable to test with

    // Look for a non-dStable collateral asset (specifically sfrxUSD or stS)
    for (const [asset, config] of Object.entries(fixture.assets)) {
      // Skip dStables and look for assets that can be used as collateral (LTV > 0)
      if (config.ltv !== BigInt(0)) {
        collateralAsset = asset;
        break;
      }
    }

    if (!dStableAsset || !collateralAsset) {
      throw new Error(
        "Could not find required test assets - need one dStable and one collateral asset"
      );
    }

    // Log detailed information about our selected assets
    console.log("\nSelected Assets Configuration:");
    console.log("dStable Asset:", {
      address: dStableAsset,
      config: {
        ...fixture.assets[dStableAsset],
        ltv: fixture.assets[dStableAsset].ltv.toString(),
        liquidationThreshold:
          fixture.assets[dStableAsset].liquidationThreshold.toString(),
      },
      reserveData: await pool.getReserveData(dStableAsset),
    });
    console.log("Collateral Asset:", {
      address: collateralAsset,
      config: {
        ...fixture.assets[collateralAsset],
        ltv: fixture.assets[collateralAsset].ltv.toString(),
        liquidationThreshold:
          fixture.assets[collateralAsset].liquidationThreshold.toString(),
      },
      reserveData: await pool.getReserveData(collateralAsset),
    });

    // Log reserve configuration for both assets
    const dStableConfig =
      await fixture.contracts.dataProvider.getReserveConfigurationData(
        dStableAsset
      );
    const collateralConfig =
      await fixture.contracts.dataProvider.getReserveConfigurationData(
        collateralAsset
      );

    console.log("\nReserve Configurations:");
    console.log("dStable Config:", {
      ltv: dStableConfig.ltv.toString(),
      liquidationThreshold: dStableConfig.liquidationThreshold.toString(),
      borrowingEnabled: dStableConfig.borrowingEnabled,
      isActive: dStableConfig.isActive,
      isFrozen: dStableConfig.isFrozen,
    });
    console.log("Collateral Config:", {
      ltv: collateralConfig.ltv.toString(),
      liquidationThreshold: collateralConfig.liquidationThreshold.toString(),
      borrowingEnabled: collateralConfig.borrowingEnabled,
      isActive: collateralConfig.isActive,
      isFrozen: collateralConfig.isFrozen,
    });

    console.log("\nToken Balances:");
    const collateralToken = await hre.ethers.getContractAt(
      "TestERC20",
      collateralAsset
    );
    const dStableToken = await hre.ethers.getContractAt(
      "ERC20StablecoinUpgradeable",
      dStableAsset
    );
    console.log("Deployer balances:", {
      collateral: (
        await collateralToken.balanceOf(deployer.address)
      ).toString(),
      dStable: (await dStableToken.balanceOf(deployer.address)).toString(),
    });
    console.log("User balances:", {
      collateral: (await collateralToken.balanceOf(user.address)).toString(),
      dStable: (await dStableToken.balanceOf(user.address)).toString(),
    });

    // Transfer tokens from deployer to user
    const testAmount = ethers.parseUnits("1000", 18); // Transfer 1000 tokens for testing
    await collateralToken.transfer(user.address, testAmount);
    await dStableToken.transfer(user.address, testAmount);
  });

  describe("Supply", () => {
    beforeEach(async () => {
      // Check reserve configuration
      const config =
        await fixture.contracts.dataProvider.getReserveConfigurationData(
          collateralAsset
        );
      console.log("Reserve configuration:", {
        ltv: config.ltv.toString(),
        liquidationThreshold: config.liquidationThreshold.toString(),
        borrowingEnabled: config.borrowingEnabled,
        isActive: config.isActive,
        isFrozen: config.isFrozen,
      });
      // For collateral assets, LTV should be > 0
      expect(config.ltv).to.not.equal(
        BigInt(0),
        "Collateral LTV should be greater than 0"
      );
      expect(config.isActive).to.be.true;
      expect(config.isFrozen).to.be.false;

      // For dStables, LTV should be 0 to prevent subsidy syphoning
      const dStableConfig =
        await fixture.contracts.dataProvider.getReserveConfigurationData(
          dStableAsset
        );
      expect(dStableConfig.ltv).to.equal(
        BigInt(0),
        "dStable LTV should be 0 to prevent subsidy syphoning"
      );
      expect(dStableConfig.borrowingEnabled).to.be.true,
        "dStable should be borrowable";
    });

    it("should allow users to supply assets", async () => {
      const amount = ethers.parseUnits("100", 18); // Assuming 18 decimals
      const asset = await ethers.getContractAt("TestERC20", collateralAsset);
      const aToken = fixture.contracts.aTokens[collateralAsset];

      // Approve spending
      await asset
        .connect(user)
        .approve(await fixture.contracts.pool.getAddress(), amount);

      // Supply asset
      await fixture.contracts.pool
        .connect(user)
        .supply(collateralAsset, amount, await user.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Check aToken balance
      const aTokenBalance = await aToken.balanceOf(await user.getAddress());
      expect(aTokenBalance).to.equal(amount);

      // Check user configuration
      const userConfig = await fixture.contracts.pool.getUserConfiguration(
        await user.getAddress()
      );
      expect(userConfig.data).to.not.equal(0); // User should have some configuration set
    });

    it("should update user account data after supply", async () => {
      const amount = ethers.parseUnits("100", 18);
      const asset = await ethers.getContractAt("TestERC20", collateralAsset);

      // Supply asset
      await asset
        .connect(user)
        .approve(await fixture.contracts.pool.getAddress(), amount);
      await fixture.contracts.pool
        .connect(user)
        .supply(collateralAsset, amount, await user.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Check user account data
      const { totalCollateralBase, totalDebtBase, availableBorrowsBase } =
        await fixture.contracts.pool.getUserAccountData(
          await user.getAddress()
        );

      expect(totalCollateralBase).to.be.gt(0);
      expect(totalDebtBase).to.equal(0);
      expect(availableBorrowsBase).to.be.gt(0);
    });
  });

  describe("Borrow", () => {
    it("should allow users to borrow dStables", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Supply collateral first
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateral
        .connect(user)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user)
        .supply(collateralAsset, collateralAmount, await user.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Get dStable contracts
      const dStable = await ethers.getContractAt("TestERC20", dStableAsset);
      const variableDebtToken =
        fixture.contracts.variableDebtTokens[dStableAsset];

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user)
        .borrow(dStableAsset, borrowAmount, 2, 0, await user.getAddress()); // 2 = variable rate

      // Check debt token balance
      const debtBalance = await variableDebtToken.balanceOf(
        await user.getAddress()
      );
      expect(debtBalance).to.equal(borrowAmount);

      // Check borrowed token balance
      const dStableBalance = await dStable.balanceOf(await user.getAddress());
      expect(dStableBalance).to.equal(borrowAmount);
    });

    it("should update user position after borrowing", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Supply collateral first
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateral
        .connect(user)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user)
        .supply(collateralAsset, collateralAmount, await user.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Get position before borrowing
      const beforeBorrow = await fixture.contracts.pool.getUserAccountData(
        await user.getAddress()
      );

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user)
        .borrow(dStableAsset, borrowAmount, 2, 0, await user.getAddress());

      // Get position after borrowing
      const afterBorrow = await fixture.contracts.pool.getUserAccountData(
        await user.getAddress()
      );

      expect(afterBorrow.totalDebtBase).to.be.gt(beforeBorrow.totalDebtBase);
      expect(afterBorrow.availableBorrowsBase).to.be.lt(
        beforeBorrow.availableBorrowsBase
      );
      expect(afterBorrow.healthFactor).to.be.lt(beforeBorrow.healthFactor);
    });
  });

  describe("User Position", () => {
    it("should correctly calculate user position values", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Supply collateral
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateral
        .connect(user)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user)
        .supply(collateralAsset, collateralAmount, await user.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user)
        .borrow(dStableAsset, borrowAmount, 2, 0, await user.getAddress());

      // Get user position
      const {
        totalCollateralBase,
        totalDebtBase,
        availableBorrowsBase,
        currentLiquidationThreshold,
        ltv,
        healthFactor,
      } = await fixture.contracts.pool.getUserAccountData(
        await user.getAddress()
      );

      // Verify position calculations
      expect(totalCollateralBase).to.be.gt(0);
      expect(totalDebtBase).to.be.gt(0);
      expect(availableBorrowsBase).to.be.gte(0);
      expect(currentLiquidationThreshold).to.be.gt(0);
      expect(ltv).to.be.gt(0);
      expect(healthFactor).to.be.gt(1); // Health factor should be > 1 to avoid liquidation
    });
  });
});
