import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralVault,
  Issuer,
  TestERC20,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
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
  let dusdContract: TestERC20;
  let dusdInfo: TokenInfo;
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
    ({ contract: dusdContract, tokenInfo: dusdInfo } =
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
      const minDUSD = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      const vaultBalanceBefore = await frxUSDContract.balanceOf(
        await collateralVaultContract.getAddress()
      );
      const userDusdBalanceBefore = await dusdContract.balanceOf(user1);

      await frxUSDContract
        .connect(await hre.ethers.getSigner(user1))
        .approve(await issuerContract.getAddress(), collateralAmount);

      await issuerContract
        .connect(await hre.ethers.getSigner(user1))
        .issue(collateralAmount, frxUSDInfo.address, minDUSD);

      const vaultBalanceAfter = await frxUSDContract.balanceOf(
        await collateralVaultContract.getAddress()
      );
      const userDusdBalanceAfter = await dusdContract.balanceOf(user1);

      assert.equal(
        vaultBalanceAfter - vaultBalanceBefore,
        collateralAmount,
        "Collateral vault balance did not increase by the expected amount"
      );

      const dusdReceived = userDusdBalanceAfter - userDusdBalanceBefore;
      assert.isTrue(
        dusdReceived >= minDUSD,
        "User did not receive the expected amount of dUSD"
      );
    });

    it("cannot issue more than user's collateral balance", async function () {
      const collateralAmount = hre.ethers.parseUnits(
        "1001",
        frxUSDInfo.decimals
      );
      const minDUSD = hre.ethers.parseUnits("1001", dusdInfo.decimals);

      await frxUSDContract
        .connect(await hre.ethers.getSigner(user1))
        .approve(await issuerContract.getAddress(), collateralAmount);

      await expect(
        issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(collateralAmount, frxUSDInfo.address, minDUSD)
      ).to.be.reverted;
    });

    it("circulatingDusd function calculates correctly", async function () {
      // Make sure there's some dUSD supply at the start of the test
      const collateralAmount = hre.ethers.parseUnits(
        "10000",
        frxUSDInfo.decimals
      );
      const minDUSD = hre.ethers.parseUnits("10000", dusdInfo.decimals);

      await frxUSDContract.transfer(deployer, collateralAmount);
      await frxUSDContract.approve(
        await issuerContract.getAddress(),
        collateralAmount
      );
      await issuerContract.issue(collateralAmount, frxUSDInfo.address, minDUSD);

      // Mint some AMO supply
      const amoSupply = hre.ethers.parseUnits("3000", dusdInfo.decimals);
      await issuerContract.increaseAmoSupply(amoSupply);

      const totalSupply = await dusdContract.totalSupply();
      const actualAmoSupply = await amoManagerContract.totalAmoSupply();
      const expectedCirculating = totalSupply - actualAmoSupply;

      const actualCirculating = await issuerContract.circulatingDusd();

      assert.equal(
        actualCirculating,
        expectedCirculating,
        "Circulating dUSD calculation is incorrect"
      );
      assert.notEqual(
        actualCirculating,
        totalSupply,
        "Circulating dUSD should be less than total supply"
      );
      assert.notEqual(actualAmoSupply, 0n, "AMO supply should not be zero");
    });

    it("usdValueToDusdAmount converts correctly", async function () {
      const dusdPriceOracle = await hre.ethers.getContractAt(
        "MockOracleAggregator",
        await issuerContract.oracle(),
        await hre.ethers.getSigner(deployer)
      );

      const usdValue = hre.ethers.parseUnits(
        "100",
        ORACLE_AGGREGATOR_PRICE_DECIMALS
      ); // 100 USD
      const dusdPrice = await dusdPriceOracle.getAssetPrice(dusdInfo.address);
      const expectedDusdAmount =
        (usdValue * 10n ** BigInt(dusdInfo.decimals)) / dusdPrice;

      const actualDusdAmount =
        await issuerContract.usdValueToDusdAmount(usdValue);

      assert.equal(
        actualDusdAmount,
        expectedDusdAmount,
        "USD to dUSD conversion is incorrect"
      );
    });
  });

  describe("Permissioned issuance", () => {
    it("increaseAmoSupply mints dUSD to AMO Manager", async function () {
      const initialAmoSupply = await amoManagerContract.totalAmoSupply();
      const initialAmoManagerBalance = await dusdContract.balanceOf(
        await amoManagerContract.getAddress()
      );
      const amountToMint = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      await issuerContract.increaseAmoSupply(amountToMint);

      const finalAmoSupply = await amoManagerContract.totalAmoSupply();
      const finalAmoManagerBalance = await dusdContract.balanceOf(
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

    it("issueUsingExcessCollateral mints dUSD up to excess collateral", async function () {
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

      const initialCirculatingDusd = await issuerContract.circulatingDusd();
      const amountToMint = hre.ethers.parseUnits("2000", dusdInfo.decimals);
      const receiver = user2;
      const initialReceiverBalance = await dusdContract.balanceOf(receiver);

      await issuerContract.issueUsingExcessCollateral(receiver, amountToMint);

      const finalCirculatingDusd = await issuerContract.circulatingDusd();
      const finalReceiverBalance = await dusdContract.balanceOf(receiver);

      assert.equal(
        finalCirculatingDusd - initialCirculatingDusd,
        amountToMint,
        "Circulating dUSD was not increased correctly"
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

      const amountToMint = hre.ethers.parseUnits("2001", dusdInfo.decimals);
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
      const amountToMint = hre.ethers.parseUnits("1000", dusdInfo.decimals);
      await expect(
        issuerContract.connect(normalUser).increaseAmoSupply(amountToMint)
      ).to.be.revertedWithCustomError(
        issuerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("only incentives manager can issue using excess collateral", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const amountToMint = hre.ethers.parseUnits("1000", dusdInfo.decimals);
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
