import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { dLendFixture } from "./fixtures";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { DLendFixtureResult } from "./fixtures";
import {
  OdosDebtSwapAdapter,
  OdosLiquiditySwapAdapter,
  OdosRepayAdapter,
  OdosWithdrawSwapAdapter,
  TestERC20,
  Pool,
} from "../../typechain-types";

describe("Odos Swap Adapters", () => {
  // Test fixture and common variables
  let deployerSigner: SignerWithAddress;
  let user1Signer: SignerWithAddress;
  let user2Signer: SignerWithAddress;
  let pool: Pool;
  let dUSD: string;
  let dS: string;
  let sfrxUSD: string;
  let stS: string;
  let fixture: DLendFixtureResult;
  let debtSwapAdapter: OdosDebtSwapAdapter;
  let liquiditySwapAdapter: OdosLiquiditySwapAdapter;
  let repayAdapter: OdosRepayAdapter;
  let withdrawSwapAdapter: OdosWithdrawSwapAdapter;

  beforeEach(async () => {
    // Get named accounts
    const { deployer, user1, user2 } = await hre.getNamedAccounts();
    deployerSigner = await hre.ethers.getSigner(deployer);
    user1Signer = await hre.ethers.getSigner(user1);
    user2Signer = await hre.ethers.getSigner(user2);

    // Load the fixture
    fixture = await dLendFixture();
    pool = fixture.contracts.pool;
    const dataProvider = fixture.contracts.dataProvider;

    // Get adapters from deployments
    debtSwapAdapter = await hre.ethers.getContractAt(
      "OdosDebtSwapAdapter",
      (await hre.deployments.get("OdosDebtSwapAdapter")).address
    );
    liquiditySwapAdapter = await hre.ethers.getContractAt(
      "OdosLiquiditySwapAdapter",
      (await hre.deployments.get("OdosLiquiditySwapAdapter")).address
    );
    repayAdapter = await hre.ethers.getContractAt(
      "OdosRepayAdapter",
      (await hre.deployments.get("OdosRepayAdapter")).address
    );
    withdrawSwapAdapter = await hre.ethers.getContractAt(
      "OdosWithdrawSwapAdapter",
      (await hre.deployments.get("OdosWithdrawSwapAdapter")).address
    );

    // Get test assets with configured exchange rates
    dUSD = fixture.dStables.dUSD;
    dS = fixture.dStables.dS;

    // Get collateral assets
    for (const [asset, config] of Object.entries(fixture.assets)) {
      if (config.symbol === "sfrxUSD") {
        sfrxUSD = asset;
      } else if (config.symbol === "stS") {
        stS = asset;
      }
    }

    if (!dUSD || !dS || !sfrxUSD || !stS) {
      throw new Error("Could not find required test assets");
    }

    // --- Add initial supply logic ---
    console.log("\n supplying initial liquidity...");
    const assetsToSupply = [dUSD, dS, sfrxUSD, stS];
    const poolAddress = await pool.getAddress();

    for (const assetAddress of assetsToSupply) {
      try {
        const tokenContract = await hre.ethers.getContractAt(
          "TestERC20",
          assetAddress
        );
        const tokenDecimals = await tokenContract.decimals();
        const [supplyCapUnits /* borrowCap */] =
          await dataProvider.getReserveCaps(assetAddress);

        if (supplyCapUnits > 0) {
          // Supply cap is in asset units, convert to wei
          const supplyCapWei = ethers.parseUnits(
            supplyCapUnits.toString(),
            tokenDecimals
          );
          const amountToSupplyWei = supplyCapWei / 2n; // 50% of cap

          // Ensure deployer has enough balance (fixture should provide this)
          const deployerBalance = await tokenContract.balanceOf(
            deployerSigner.address
          );
          if (deployerBalance < amountToSupplyWei) {
            console.warn(
              `WARN: Deployer balance (${deployerBalance}) insufficient to supply 50% of cap (${amountToSupplyWei}) for ${assetAddress}. Skipping initial supply.`
            );
            continue;
          }

          await tokenContract
            .connect(deployerSigner)
            .approve(poolAddress, amountToSupplyWei);
          await pool
            .connect(deployerSigner)
            .supply(assetAddress, amountToSupplyWei, deployerSigner.address, 0);
          console.log(
            ` Supplied ${ethers.formatUnits(amountToSupplyWei, tokenDecimals)} (50% of cap) of asset ${assetAddress}`
          );
        } else {
          console.log(
            ` Supply cap is 0 for ${assetAddress}, skipping initial supply.`
          );
        }
      } catch (error: any) {
        console.error(
          ` Error supplying initial liquidity for ${assetAddress}: ${error.message}`
        );
        // Optionally re-throw or handle specific errors
      }
    }
    console.log(" Initial liquidity supplied.\n");
    // --- End initial supply logic ---
  });

  describe("OdosDebtSwapAdapter", () => {
    it("should swap dUSD debt to sfrxUSD debt", async () => {
      // Get decimals
      const stSDecimals = await (
        await ethers.getContractAt("TestERC20", stS)
      ).decimals();
      const dUSDDecimals = await (
        await ethers.getContractAt("TestERC20", dUSD)
      ).decimals();
      const sfrxUSDDecimals = await (
        await ethers.getContractAt("TestERC20", sfrxUSD)
      ).decimals();

      const collateralAmount = ethers.parseUnits("1000", stSDecimals);
      const borrowAmount = ethers.parseUnits("100", dUSDDecimals);
      const maxNewDebtAmount = ethers.parseUnits("100", sfrxUSDDecimals); // Expecting roughly 1:1 for mock

      // Supply collateral
      const collateral = await ethers.getContractAt("TestERC20", stS);
      await collateral.transfer(user1Signer.address, collateralAmount);
      await collateral
        .connect(user1Signer)
        .approve(await pool.getAddress(), collateralAmount);
      await pool
        .connect(user1Signer)
        .supply(stS, collateralAmount, user1Signer.address, 0);
      await pool.connect(user1Signer).setUserUseReserveAsCollateral(stS, true);

      // Borrow dUSD
      await pool
        .connect(user1Signer)
        .borrow(dUSD, borrowAmount, 2, 0, user1Signer.address);

      // Get debt token and approve adapter
      const variableDebtToken = fixture.contracts.variableDebtTokens[dUSD];
      // Approve the maximum possible repayment amount initially borrowed
      await variableDebtToken
        .connect(user1Signer)
        .approveDelegation(await debtSwapAdapter.getAddress(), borrowAmount);

      // Create swap params
      const swapParams = {
        debtAsset: dUSD,
        debtRepayAmount: borrowAmount, // Repay the amount borrowed
        debtRateMode: 2, // Variable rate
        newDebtAsset: sfrxUSD,
        maxNewDebtAmount: maxNewDebtAmount, // Max amount of new debt willing to take
        extraCollateralAsset: ethers.ZeroAddress,
        extraCollateralAmount: 0,
        swapData: "0x", // Use 0x for empty bytes
      };

      // Execute debt swap
      await debtSwapAdapter.connect(user1Signer).swapDebt(
        swapParams,
        {
          debtToken: ethers.ZeroAddress,
          value: 0,
          deadline: 0,
          v: 0,
          r: "0x0",
          s: "0x0",
        },
        {
          aToken: ethers.ZeroAddress,
          value: 0,
          deadline: 0,
          v: 0,
          r: "0x0",
          s: "0x0",
        }
      );

      // Verify debt was swapped
      const oldDebtBalance = await variableDebtToken.balanceOf(
        user1Signer.address
      );
      expect(oldDebtBalance).to.be.equal(0);

      const newDebtToken = fixture.contracts.variableDebtTokens[sfrxUSD];
      const newDebtBalance = await newDebtToken.balanceOf(user1Signer.address);
      expect(newDebtBalance).to.be.gt(0);
    });
  });

  describe("OdosLiquiditySwapAdapter", () => {
    it("should swap sfrxUSD liquidity to stS", async () => {
      // Get decimals
      const sfrxUSDDecimals = await (
        await ethers.getContractAt("TestERC20", sfrxUSD)
      ).decimals();
      const stSDecimals = await (
        await ethers.getContractAt("TestERC20", stS)
      ).decimals();

      const supplyAmount = ethers.parseUnits("1000", sfrxUSDDecimals);
      const amountToSwap = ethers.parseUnits("100", sfrxUSDDecimals); // Swap 10%
      const expectedNewAmount = ethers.parseUnits("100", stSDecimals); // Expect roughly 1:1 for mock

      // Supply sfrxUSD
      const asset = await ethers.getContractAt("TestERC20", sfrxUSD);
      await asset.transfer(user1Signer.address, supplyAmount);
      await asset
        .connect(user1Signer)
        .approve(await pool.getAddress(), supplyAmount);
      await pool
        .connect(user1Signer)
        .supply(sfrxUSD, supplyAmount, user1Signer.address, 0);

      // Get aToken and approve adapter for the amount to swap
      const aToken = fixture.contracts.aTokens[sfrxUSD];
      await aToken
        .connect(user1Signer)
        .approve(await liquiditySwapAdapter.getAddress(), amountToSwap);

      // Create swap params
      const swapParams = {
        collateralAsset: sfrxUSD,
        collateralAmountToSwap: amountToSwap, // Amount of aTokens to swap
        newCollateralAsset: stS,
        newCollateralAmount: expectedNewAmount, // Min expected amount of new aTokens
        withFlashLoan: false,
        user: user1Signer.address,
        swapData: "0x", // Use 0x for empty bytes
      };

      // Execute liquidity swap
      await liquiditySwapAdapter
        .connect(user1Signer)
        .swapLiquidity(swapParams, {
          aToken: ethers.ZeroAddress,
          value: 0,
          deadline: 0,
          v: 0,
          r: hre.ethers.ZeroHash,
          s: hre.ethers.ZeroHash,
        });

      // Verify liquidity was swapped
      const oldATokenBalance = await aToken.balanceOf(user1Signer.address);
      expect(oldATokenBalance).to.be.equal(0);

      const newAToken = fixture.contracts.aTokens[stS];
      const newATokenBalance = await newAToken.balanceOf(user1Signer.address);
      expect(newATokenBalance).to.be.gt(0);
    });
  });

  describe("OdosRepayAdapter", () => {
    it("should repay dUSD debt using stS as source", async () => {
      // Get decimals
      const sfrxUSDDecimals = await (
        await ethers.getContractAt("TestERC20", sfrxUSD)
      ).decimals();
      const dUSDDecimals = await (
        await ethers.getContractAt("TestERC20", dUSD)
      ).decimals();
      const stSDecimals = await (
        await ethers.getContractAt("TestERC20", stS)
      ).decimals();

      const collateralAmount = ethers.parseUnits("1000", sfrxUSDDecimals);
      const borrowAmount = ethers.parseUnits("100", dUSDDecimals);
      const repaySourceSupplyAmount = ethers.parseUnits("1000", stSDecimals);
      const repayAmount = borrowAmount; // Repay the full borrowed amount
      const repaySourceAmountToUse = ethers.parseUnits("110", stSDecimals); // Use slightly more stS due to potential swap rates

      // Supply collateral and borrow
      const collateral = await ethers.getContractAt("TestERC20", sfrxUSD);
      await collateral.transfer(user1Signer.address, collateralAmount);
      await collateral
        .connect(user1Signer)
        .approve(await pool.getAddress(), collateralAmount);
      await pool
        .connect(user1Signer)
        .supply(sfrxUSD, collateralAmount, user1Signer.address, 0);
      await pool
        .connect(user1Signer)
        .setUserUseReserveAsCollateral(sfrxUSD, true);
      await pool
        .connect(user1Signer)
        .borrow(dUSD, borrowAmount, 2, 0, user1Signer.address);

      // Supply repayment source asset
      const repaySource = await ethers.getContractAt("TestERC20", stS);
      await repaySource.transfer(user1Signer.address, repaySourceSupplyAmount); // Transfer enough stS
      await repaySource
        .connect(user1Signer)
        .approve(await pool.getAddress(), repaySourceSupplyAmount);
      await pool
        .connect(user1Signer)
        .supply(stS, repaySourceSupplyAmount, user1Signer.address, 0);

      // Get aToken and approve adapter for the amount to use for repayment
      const aToken = fixture.contracts.aTokens[stS];
      await aToken
        .connect(user1Signer)
        .approve(await repayAdapter.getAddress(), repaySourceAmountToUse);

      // Create repay params
      const repayParams = {
        collateralAsset: stS, // The asset (aToken) used for repayment
        collateralAmount: repaySourceAmountToUse, // Max amount of aToken source to use
        debtAsset: dUSD,
        repayAmount: repayAmount, // The amount of debt to repay
        rateMode: 2,
        user: user1Signer.address,
        minAmountToReceive: 0, // Not receiving anything directly here
        swapData: "0x", // Use 0x for empty bytes
      };

      // Execute repay
      await repayAdapter.connect(user1Signer).swapAndRepay(repayParams, {
        aToken: ethers.ZeroAddress,
        value: 0,
        deadline: 0,
        v: 0,
        r: hre.ethers.ZeroHash,
        s: hre.ethers.ZeroHash,
      });

      // Verify debt was repaid
      const debtToken = fixture.contracts.variableDebtTokens[dUSD];
      const debtBalance = await debtToken.balanceOf(user1Signer.address);
      expect(debtBalance).to.be.equal(0);
    });
  });

  describe("OdosWithdrawSwapAdapter", () => {
    it("should withdraw dS and swap to dUSD", async () => {
      // Get decimals
      const dSDecimals = await (
        await ethers.getContractAt("TestERC20", dS)
      ).decimals();
      const dUSDDecimals = await (
        await ethers.getContractAt("TestERC20", dUSD)
      ).decimals();

      const supplyAmount = ethers.parseUnits("1000", dSDecimals);
      const amountToWithdrawAndSwap = ethers.parseUnits("100", dSDecimals); // Withdraw 10%
      const minAmountToReceive = ethers.parseUnits("90", dUSDDecimals); // Expect slightly less dUSD due to swap rate

      // Supply dS
      const asset = await ethers.getContractAt("TestERC20", dS);
      await asset.transfer(user1Signer.address, supplyAmount);
      await asset
        .connect(user1Signer)
        .approve(await pool.getAddress(), supplyAmount);
      await pool
        .connect(user1Signer)
        .supply(dS, supplyAmount, user1Signer.address, 0);

      // Get aToken and approve adapter for the amount to withdraw
      const aToken = fixture.contracts.aTokens[dS];
      await aToken
        .connect(user1Signer)
        .approve(
          await withdrawSwapAdapter.getAddress(),
          amountToWithdrawAndSwap
        );

      // Get initial balance of target asset
      const targetAsset = await ethers.getContractAt("TestERC20", dUSD);
      const initialBalance = await targetAsset.balanceOf(user1Signer.address);

      // Create withdraw swap params
      const withdrawParams = {
        oldAsset: dS,
        oldAssetAmount: amountToWithdrawAndSwap, // Amount of aTokens to withdraw
        newAsset: dUSD,
        minAmountToReceive: minAmountToReceive, // Min amount of new asset (dUSD) expected
        user: user1Signer.address,
        swapData: "0x", // Use 0x for empty bytes
      };

      // Execute withdraw and swap
      await withdrawSwapAdapter
        .connect(user1Signer)
        .withdrawAndSwap(withdrawParams, {
          aToken: ethers.ZeroAddress,
          value: 0,
          deadline: 0,
          v: 0,
          r: hre.ethers.ZeroHash,
          s: hre.ethers.ZeroHash,
        });

      // Verify withdrawal and swap
      const finalATokenBalance = await aToken.balanceOf(user1Signer.address);
      // Expect remaining balance (initial supply - withdrawn amount)
      expect(finalATokenBalance).to.be.closeTo(
        supplyAmount - amountToWithdrawAndSwap,
        10
      ); // Use closeTo for potential precision issues

      const finalTargetBalance = await targetAsset.balanceOf(
        user1Signer.address
      );
      expect(finalTargetBalance).to.be.gt(initialBalance);
    });
  });
});
