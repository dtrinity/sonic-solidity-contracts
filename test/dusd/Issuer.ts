import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralVault,
  Issuer,
  TestERC20,
} from "../../typechain-types";
import { USD_ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import { standaloneMinimalFixture } from "./fixtures";
import { DUSD_ISSUER_CONTRACT_ID } from "../../typescript/deploy-ids";

describe("Issuer", () => {
  let issuerContract: Issuer;
  let collateralVaultContract: CollateralVault;
  let amoManagerContract: AmoManager;
  let frxUSDContract: TestERC20;
  let frxUSDInfo: TokenInfo;
  let dstableContract: TestERC20;
  let dstableInfo: TokenInfo;
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  beforeEach(async function () {
    await standaloneMinimalFixture();

    ({ deployer, user1, user2 } = await getNamedAccounts());

    const issuerAddress = (await hre.deployments.get(DUSD_ISSUER_CONTRACT_ID))
      .address;
    issuerContract = await hre.ethers.getContractAt(
      "Issuer",
      issuerAddress,
      await hre.ethers.getSigner(deployer)
    );

    const collateralVaultAddress = await issuerContract.collateralVault();
    collateralVaultContract = await hre.ethers.getContractAt(
      "CollateralHolderVault",
      collateralVaultAddress,
      await hre.ethers.getSigner(deployer)
    );

    const amoManagerAddress = await issuerContract.amoManager();
    amoManagerContract = await hre.ethers.getContractAt(
      "AmoManager",
      amoManagerAddress,
      await hre.ethers.getSigner(deployer)
    );

    ({ contract: frxUSDContract, tokenInfo: frxUSDInfo } =
      await getTokenContractForSymbol(hre, deployer, "frxUSD"));
    ({ contract: dstableContract, tokenInfo: dstableInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));

    // Allow frxUSD as collateral
    await collateralVaultContract.allowCollateral(frxUSDInfo.address);

    // Transfer 1000 frxUSD to testAccount1
    const frxUSDAmount = hre.ethers.parseUnits("1000", frxUSDInfo.decimals);
    await frxUSDContract.transfer(user1, frxUSDAmount);
  });

  describe("Permissionless issuance", () => {
    it("issue in exchange for collateral", async function () {
      const collateralAmount = hre.ethers.parseUnits(
        "1000",
        frxUSDInfo.decimals
      );
      const minDStable = hre.ethers.parseUnits("1000", dstableInfo.decimals);

      const vaultBalanceBefore = await frxUSDContract.balanceOf(
        await collateralVaultContract.getAddress()
      );
      const userDstableBalanceBefore = await dstableContract.balanceOf(user1);

      await frxUSDContract
        .connect(await hre.ethers.getSigner(user1))
        .approve(await issuerContract.getAddress(), collateralAmount);

      await issuerContract
        .connect(await hre.ethers.getSigner(user1))
        .issue(collateralAmount, frxUSDInfo.address, minDStable);

      const vaultBalanceAfter = await frxUSDContract.balanceOf(
        await collateralVaultContract.getAddress()
      );
      const userDstableBalanceAfter = await dstableContract.balanceOf(user1);

      assert.equal(
        vaultBalanceAfter - vaultBalanceBefore,
        collateralAmount,
        "Collateral vault balance did not increase by the expected amount"
      );
      assert.equal(
        userDstableBalanceAfter - userDstableBalanceBefore,
        minDStable,
        "User did not receive the expected amount of dStable"
      );
    });

    it("cannot issue more than user's collateral balance", async function () {
      const collateralAmount = hre.ethers.parseUnits(
        "1001",
        frxUSDInfo.decimals
      );
      const minDStable = hre.ethers.parseUnits("1001", dstableInfo.decimals);

      await frxUSDContract
        .connect(await hre.ethers.getSigner(user1))
        .approve(await issuerContract.getAddress(), collateralAmount);

      await expect(
        issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(collateralAmount, frxUSDInfo.address, minDStable)
      ).to.be.reverted;
    });

    it("circulatingDstable function calculates correctly", async function () {
      // Make sure there's some dStable supply at the start of the test
      const collateralAmount = hre.ethers.parseUnits(
        "10000",
        frxUSDInfo.decimals
      );
      const minDStable = hre.ethers.parseUnits("10000", dstableInfo.decimals);

      await frxUSDContract.transfer(deployer, collateralAmount);
      await frxUSDContract.approve(
        await issuerContract.getAddress(),
        collateralAmount
      );
      await issuerContract.issue(
        collateralAmount,
        frxUSDInfo.address,
        minDStable
      );

      // Mint some AMO supply
      const amoSupply = hre.ethers.parseUnits("3000", dstableInfo.decimals);
      await issuerContract.increaseAmoSupply(amoSupply);

      const totalSupply = await dstableContract.totalSupply();
      const actualAmoSupply = await amoManagerContract.totalAmoSupply();
      const expectedCirculating = totalSupply - actualAmoSupply;

      const actualCirculating = await issuerContract.circulatingDstable();

      assert.equal(
        actualCirculating,
        expectedCirculating,
        "Circulating dStable calculation is incorrect"
      );
      assert.notEqual(
        actualCirculating,
        totalSupply,
        "Circulating dStable should be less than total supply"
      );
      assert.notEqual(actualAmoSupply, 0n, "AMO supply should not be zero");
    });

    it("baseValueToDstableAmount converts correctly", async function () {
      const dstablePriceOracle = await hre.ethers.getContractAt(
        "MockOracleAggregator",
        await issuerContract.oracle(),
        await hre.ethers.getSigner(deployer)
      );

      const baseValue = hre.ethers.parseUnits(
        "100",
        USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // 100 base units
      const dstablePrice = await dstablePriceOracle.getAssetPrice(
        dstableInfo.address
      );
      const expectedDstableAmount =
        (baseValue * 10n ** BigInt(dstableInfo.decimals)) / dstablePrice;

      const actualDstableAmount =
        await issuerContract.baseValueToDstableAmount(baseValue);

      assert.equal(
        actualDstableAmount,
        expectedDstableAmount,
        "Base value to dStable conversion is incorrect"
      );
    });
  });

  describe("Permissioned issuance", () => {
    it("increaseAmoSupply mints dStable to AMO Manager", async function () {
      const initialAmoSupply = await amoManagerContract.totalAmoSupply();
      const initialAmoManagerBalance = await dstableContract.balanceOf(
        await amoManagerContract.getAddress()
      );
      const amountToMint = hre.ethers.parseUnits("1000", dstableInfo.decimals);

      await issuerContract.increaseAmoSupply(amountToMint);

      const finalAmoSupply = await amoManagerContract.totalAmoSupply();
      const finalAmoManagerBalance = await dstableContract.balanceOf(
        await amoManagerContract.getAddress()
      );

      assert.equal(
        finalAmoSupply - initialAmoSupply,
        amountToMint,
        "AMO supply was not increased correctly"
      );
      assert.equal(
        finalAmoManagerBalance - initialAmoManagerBalance,
        amountToMint,
        "AMO Manager balance was not increased correctly"
      );
    });

    it("issueUsingExcessCollateral mints dStable up to excess collateral", async function () {
      // Ensure there's excess collateral
      const collateralAmount = hre.ethers.parseUnits(
        "2000",
        frxUSDInfo.decimals
      );
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        collateralAmount
      );
      await collateralVaultContract.deposit(
        collateralAmount,
        frxUSDInfo.address
      );

      const initialCirculatingDstable =
        await issuerContract.circulatingDstable();
      const amountToMint = hre.ethers.parseUnits("2000", dstableInfo.decimals);
      const receiver = user2;
      const initialReceiverBalance = await dstableContract.balanceOf(receiver);

      await issuerContract.issueUsingExcessCollateral(receiver, amountToMint);

      const finalCirculatingDstable = await issuerContract.circulatingDstable();
      const finalReceiverBalance = await dstableContract.balanceOf(receiver);

      assert.equal(
        finalCirculatingDstable - initialCirculatingDstable,
        amountToMint,
        "Circulating dStable was not increased correctly"
      );
      assert.equal(
        finalReceiverBalance - initialReceiverBalance,
        amountToMint,
        "Receiver balance was not increased correctly"
      );
    });

    it("issueUsingExcessCollateral cannot exceed collateral balance", async function () {
      // Ensure there's excess collateral
      const collateralAmount = hre.ethers.parseUnits(
        "2000",
        frxUSDInfo.decimals
      );
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        collateralAmount
      );
      await collateralVaultContract.deposit(
        collateralAmount,
        frxUSDInfo.address
      );

      const amountToMint = hre.ethers.parseUnits("2001", dstableInfo.decimals);
      const receiver = user2;

      await expect(
        issuerContract.issueUsingExcessCollateral(receiver, amountToMint)
      ).to.be.revertedWithCustomError(
        issuerContract,
        "IssuanceSurpassesExcessCollateral"
      );
    });
  });

  describe("Management", () => {
    it("only admin can set AMO manager", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      await expect(
        issuerContract.connect(normalUser).setAmoManager(user2)
      ).to.be.revertedWithCustomError(
        issuerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("setCollateralVault updates the collateral vault address", async function () {
      const newCollateralVault = user1;

      const oldCollateralVault = await issuerContract.collateralVault();

      await issuerContract.setCollateralVault(newCollateralVault);

      const updatedCollateralVault = await issuerContract.collateralVault();

      assert.notEqual(
        oldCollateralVault,
        updatedCollateralVault,
        "CollateralVault address was not changed"
      );
      assert.equal(
        updatedCollateralVault,
        newCollateralVault,
        "CollateralVault address was not updated correctly"
      );
    });

    it("only issuance manager can set collateral vault", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      await expect(
        issuerContract.connect(normalUser).setCollateralVault(user2)
      ).to.be.revertedWithCustomError(
        issuerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("only AMO manager can increase AMO supply", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const amountToMint = hre.ethers.parseUnits("1000", dstableInfo.decimals);
      await expect(
        issuerContract.connect(normalUser).increaseAmoSupply(amountToMint)
      ).to.be.revertedWithCustomError(
        issuerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("only incentives manager can issue using excess collateral", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const amountToMint = hre.ethers.parseUnits("1000", dstableInfo.decimals);
      const receiver = user2;
      await expect(
        issuerContract
          .connect(normalUser)
          .issueUsingExcessCollateral(receiver, amountToMint)
      ).to.be.revertedWithCustomError(
        issuerContract,
        "AccessControlUnauthorizedAccount"
      );
    });
  });
});
