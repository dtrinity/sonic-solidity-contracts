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
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;
  let user2Signer: SignerWithAddress;
  let pool: Pool;
  let dStableAsset: string;
  let collateralAsset: string;
  let fixture: DLendFixtureResult;

  beforeEach(async () => {
    // Get named accounts
    const { deployer, user1, user2 } = await hre.getNamedAccounts();
    // Get signers for named accounts
    deployerSigner = await hre.ethers.getSigner(deployer);
    user1Signer = await hre.ethers.getSigner(user1);
    user2Signer = await hre.ethers.getSigner(user2);

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
    await aclManager.addPoolAdmin(deployerSigner.address);

    // Get reserves
    const reservesList = await pool.getReservesList();

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

    // Log reserve configuration for both assets
    const dStableConfig =
      await fixture.contracts.dataProvider.getReserveConfigurationData(
        dStableAsset
      );
    const collateralConfig =
      await fixture.contracts.dataProvider.getReserveConfigurationData(
        collateralAsset
      );
  });

  describe("Supply", () => {
    beforeEach(async () => {
      // Check reserve configuration
      const config =
        await fixture.contracts.dataProvider.getReserveConfigurationData(
          collateralAsset
        );

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

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateralToken.transfer(user1Signer.address, amount);

      // Approve spending
      await asset
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), amount);

      // Supply asset
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(collateralAsset, amount, await user1Signer.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Check aToken balance
      const aTokenBalance = await aToken.balanceOf(
        await user1Signer.getAddress()
      );
      expect(aTokenBalance).to.equal(amount);

      // Check user configuration
      const userConfig = await fixture.contracts.pool.getUserConfiguration(
        await user1Signer.getAddress()
      );
      expect(userConfig.data).to.not.equal(0); // User should have some configuration set
    });

    it("should update user account data after supply", async () => {
      const amount = ethers.parseUnits("100", 18);
      const asset = await ethers.getContractAt("TestERC20", collateralAsset);

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateralToken.transfer(user1Signer.address, amount);

      // Supply asset
      await asset
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), amount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(collateralAsset, amount, await user1Signer.getAddress(), 0);

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Check user account data
      const { totalCollateralBase, totalDebtBase, availableBorrowsBase } =
        await fixture.contracts.pool.getUserAccountData(
          await user1Signer.getAddress()
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

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateralToken.transfer(user1Signer.address, collateralAmount);

      // Supply collateral first
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateral
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(
          collateralAsset,
          collateralAmount,
          await user1Signer.getAddress(),
          0
        );

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Get dStable contracts
      const dStable = await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dStableAsset
      );
      const variableDebtToken =
        fixture.contracts.variableDebtTokens[dStableAsset];

      // Get initial dStable balance
      const initialDStableBalance = await dStable.balanceOf(
        await user1Signer.getAddress()
      );

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user1Signer)
        .borrow(
          dStableAsset,
          borrowAmount,
          2,
          0,
          await user1Signer.getAddress()
        ); // 2 = variable rate

      // Check debt token balance
      const debtBalance = await variableDebtToken.balanceOf(
        await user1Signer.getAddress()
      );
      expect(debtBalance).to.be.closeTo(
        borrowAmount,
        ethers.parseUnits("0.0001", 18)
      ); // Use closeTo for potential minor interest accrual

      // Check borrowed token balance increase
      const finalDStableBalance = await dStable.balanceOf(
        await user1Signer.getAddress()
      );
      expect(finalDStableBalance).to.equal(
        initialDStableBalance + borrowAmount
      );
    });

    it("should update user position after borrowing", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateralToken.transfer(user1Signer.address, collateralAmount);

      // Supply collateral first
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateral
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(
          collateralAsset,
          collateralAmount,
          await user1Signer.getAddress(),
          0
        );

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Get position before borrowing
      const beforeBorrow = await fixture.contracts.pool.getUserAccountData(
        await user1Signer.getAddress()
      );

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user1Signer)
        .borrow(
          dStableAsset,
          borrowAmount,
          2,
          0,
          await user1Signer.getAddress()
        );

      // Get position after borrowing
      const afterBorrow = await fixture.contracts.pool.getUserAccountData(
        await user1Signer.getAddress()
      );

      expect(afterBorrow.totalDebtBase).to.be.gt(beforeBorrow.totalDebtBase);
      expect(afterBorrow.availableBorrowsBase).to.be.lt(
        beforeBorrow.availableBorrowsBase
      );
      // Health factor might fluctuate slightly due to interest, check it remains reasonable
      expect(afterBorrow.healthFactor).to.be.lt(beforeBorrow.healthFactor);
      expect(afterBorrow.healthFactor).to.be.gt(ethers.parseUnits("1", 18)); // Ensure health factor is still > 1
    });
  });

  describe("User Position", () => {
    it("should correctly calculate user position values", async () => {
      const collateralAmount = ethers.parseUnits("100", 18);
      const borrowAmount = ethers.parseUnits("10", 18);

      // Transfer collateral to user1
      const collateralToken = await hre.ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateralToken.transfer(user1Signer.address, collateralAmount);

      // Supply collateral
      const collateral = await ethers.getContractAt(
        "TestERC20",
        collateralAsset
      );
      await collateral
        .connect(user1Signer)
        .approve(await fixture.contracts.pool.getAddress(), collateralAmount);
      await fixture.contracts.pool
        .connect(user1Signer)
        .supply(
          collateralAsset,
          collateralAmount,
          await user1Signer.getAddress(),
          0
        );

      // Enable collateral usage
      await fixture.contracts.pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(collateralAsset, true);

      // Borrow dStable
      await fixture.contracts.pool
        .connect(user1Signer)
        .borrow(
          dStableAsset,
          borrowAmount,
          2,
          0,
          await user1Signer.getAddress()
        );

      // Get user position
      const {
        totalCollateralBase,
        totalDebtBase,
        availableBorrowsBase,
        currentLiquidationThreshold,
        ltv,
        healthFactor,
      } = await fixture.contracts.pool.getUserAccountData(
        await user1Signer.getAddress()
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
