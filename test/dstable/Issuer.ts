import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  Issuer,
  TestERC20,
  TestMintableERC20,
  OracleAggregator,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import {
  createDStableFixture,
  DUSD_CONFIG,
  DS_CONFIG,
  DStableFixtureConfig,
} from "./fixtures";
import { ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

// Define which assets are yield-bearing vs stable for reference
const yieldBearingAssets = new Set(["sfrxUSD", "sUSDS", "stS", "wOS"]);
const isYieldBearingAsset = (symbol: string): boolean =>
  yieldBearingAssets.has(symbol);

/**
 * Calculates expected dStable amount based on collateral amount and oracle prices
 * This uses the actual oracle prices instead of hard-coded values
 */
async function calculateExpectedDstableAmount(
  collateralAmount: bigint,
  collateralSymbol: string,
  collateralDecimals: number,
  dstableSymbol: string,
  dstableDecimals: number,
  oracleAggregator: OracleAggregator,
  collateralAddress: string,
  dstableAddress: string
): Promise<bigint> {
  // Get prices from oracle aggregator
  const collateralPrice =
    await oracleAggregator.getAssetPrice(collateralAddress);
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);

  // Calculate USD value of collateral
  // Formula: (collateralAmount * collateralPrice) / 10^collateralDecimals
  const collateralValueInUsd =
    (collateralAmount * collateralPrice) / 10n ** BigInt(collateralDecimals);

  // Convert USD value to dStable amount
  // Formula: (collateralValueInUsd * 10^dstableDecimals) / dstablePrice
  return (collateralValueInUsd * 10n ** BigInt(dstableDecimals)) / dstablePrice;
}

/**
 * Calculates expected dStable amount from USD value based on oracle prices
 */
async function calculateExpectedDstableFromUsd(
  usdValue: bigint,
  dstableSymbol: string,
  dstableDecimals: number,
  oracleAggregator: OracleAggregator,
  dstableAddress: string
): Promise<bigint> {
  // Get dStable price from oracle
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);

  // Convert USD value to dStable amount
  // Formula: (usdValue * 10^dstableDecimals) / dstablePrice
  return (usdValue * 10n ** BigInt(dstableDecimals)) / dstablePrice;
}

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`Issuer for ${config.symbol}`, () => {
    let issuerContract: Issuer;
    let collateralVaultContract: CollateralHolderVault;
    let amoManagerContract: AmoManager;
    let oracleAggregatorContract: OracleAggregator;
    let collateralContracts: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let deployer: Address;
    let user1: Address;
    let user2: Address;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      const issuerAddress = (await hre.deployments.get(config.issuerContractId))
        .address;
      issuerContract = await hre.ethers.getContractAt(
        "Issuer",
        issuerAddress,
        await hre.ethers.getSigner(deployer)
      );

      const collateralVaultAddress = (
        await hre.deployments.get(config.collateralVaultContractId)
      ).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer)
      );

      const amoManagerAddress = (await hre.deployments.get(config.amoManagerId))
        .address;
      amoManagerContract = await hre.ethers.getContractAt(
        "AmoManager",
        amoManagerAddress,
        await hre.ethers.getSigner(deployer)
      );

      // Get the oracle aggregator
      const oracleAggregatorAddress = (
        await hre.deployments.get(ORACLE_AGGREGATOR_ID)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer)
      );

      // Get dStable token
      const dstableResult = await getTokenContractForSymbol(
        hre,
        deployer,
        config.symbol
      );
      dstableContract = dstableResult.contract as TestMintableERC20;
      dstableInfo = dstableResult.tokenInfo;

      // Get collateral tokens
      for (const symbol of config.collateralSymbols) {
        const result = await getTokenContractForSymbol(hre, deployer, symbol);
        collateralContracts.set(symbol, result.contract);
        collateralInfos.set(symbol, result.tokenInfo);

        // Allow this collateral in the vault
        try {
          await collateralVaultContract.allowCollateral(
            result.tokenInfo.address
          );
        } catch (e) {
          // Ignore if already allowed
        }

        // Transfer tokens to test users
        const amount = hre.ethers.parseUnits(
          "10000",
          result.tokenInfo.decimals
        );
        await result.contract.transfer(user1, amount);
        await result.contract.transfer(user2, amount);
      }
    });

    describe("Permissionless issuance", () => {
      // Test for each collateral type
      config.collateralSymbols.forEach((collateralSymbol) => {
        it(`issues ${config.symbol} in exchange for ${collateralSymbol} collateral`, async function () {
          const collateralContract = collateralContracts.get(
            collateralSymbol
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          const collateralAmount = hre.ethers.parseUnits(
            "1000",
            collateralInfo.decimals
          );

          // Calculate expected dStable amount based on asset types and oracle prices
          const expectedDstableAmount = await calculateExpectedDstableAmount(
            collateralAmount,
            collateralSymbol,
            collateralInfo.decimals,
            config.symbol,
            dstableInfo.decimals,
            oracleAggregatorContract,
            collateralInfo.address,
            dstableInfo.address
          );

          // Use this as minimum to ensure test passes
          const minDStable = expectedDstableAmount;

          const vaultBalanceBefore = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress()
          );
          const userDstableBalanceBefore =
            await dstableContract.balanceOf(user1);

          await collateralContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await issuerContract.getAddress(), collateralAmount);

          await issuerContract
            .connect(await hre.ethers.getSigner(user1))
            .issue(collateralAmount, collateralInfo.address, minDStable);

          const vaultBalanceAfter = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress()
          );
          const userDstableBalanceAfter =
            await dstableContract.balanceOf(user1);

          assert.equal(
            vaultBalanceAfter - vaultBalanceBefore,
            collateralAmount,
            "Collateral vault balance did not increase by the expected amount"
          );

          const dstableReceived =
            userDstableBalanceAfter - userDstableBalanceBefore;

          // Use exact equality check - our calculation should match the contract's calculation
          assert.equal(
            dstableReceived,
            expectedDstableAmount,
            `User did not receive the expected amount of dStable. Expected ${expectedDstableAmount}, received ${dstableReceived}`
          );
        });

        it(`cannot issue ${config.symbol} with more than user's ${collateralSymbol} balance`, async function () {
          const collateralContract = collateralContracts.get(
            collateralSymbol
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          // Get user's current balance
          const userBalance = await collateralContract.balanceOf(user1);

          // Try to issue with more than the user has
          const collateralAmount = userBalance + 1n;
          const minDStable = 1n; // Any non-zero value

          await collateralContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await issuerContract.getAddress(), collateralAmount);

          // This should revert because user doesn't have enough balance
          await expect(
            issuerContract
              .connect(await hre.ethers.getSigner(user1))
              .issue(collateralAmount, collateralInfo.address, minDStable)
          ).to.be.reverted;
        });
      });

      it(`circulatingDstable function calculates correctly for ${config.symbol}`, async function () {
        // Issue some dStable to create circulating supply
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        const collateralAmount = hre.ethers.parseUnits(
          "1000",
          collateralInfo.decimals
        );

        // Calculate expected dStable amount
        const expectedDstableAmount = await calculateExpectedDstableAmount(
          collateralAmount,
          collateralSymbol,
          collateralInfo.decimals,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          collateralInfo.address,
          dstableInfo.address
        );

        await collateralContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerContract.getAddress(), collateralAmount);

        await issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(
            collateralAmount,
            collateralInfo.address,
            expectedDstableAmount
          );

        // Create some AMO supply
        const amoSupply = hre.ethers.parseUnits("500", dstableInfo.decimals);
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

      it(`usdValueToDstableAmount converts correctly for ${config.symbol}`, async function () {
        const usdValue = hre.ethers.parseUnits(
          "100",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        ); // 100 USD

        // Calculate expected dStable amount using our dynamic function
        const expectedDstableAmount = await calculateExpectedDstableFromUsd(
          usdValue,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          dstableInfo.address
        );

        const actualDstableAmount =
          await issuerContract.usdValueToDstableAmount(usdValue);

        // Compare the actual amount to our calculated expected amount
        assert.equal(
          actualDstableAmount,
          expectedDstableAmount,
          `USD to ${config.symbol} conversion is incorrect`
        );
      });
    });

    describe("Permissioned issuance", () => {
      it(`increaseAmoSupply mints ${config.symbol} to AMO Manager`, async function () {
        const amoSupply = hre.ethers.parseUnits("1000", dstableInfo.decimals);

        const initialAmoBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress()
        );
        const initialAmoSupply = await amoManagerContract.totalAmoSupply();

        await issuerContract.increaseAmoSupply(amoSupply);

        const finalAmoBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress()
        );
        const finalAmoSupply = await amoManagerContract.totalAmoSupply();

        assert.equal(
          finalAmoBalance - initialAmoBalance,
          amoSupply,
          "AMO Manager balance did not increase by the expected amount"
        );
        assert.equal(
          finalAmoSupply - initialAmoSupply,
          amoSupply,
          "AMO supply did not increase by the expected amount"
        );
      });

      it(`issueUsingExcessCollateral mints ${config.symbol} up to excess collateral`, async function () {
        // Use the first collateral for this test
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        // Ensure the collateral is allowed in the vault
        try {
          await collateralVaultContract.allowCollateral(collateralInfo.address);
        } catch (e) {
          // Ignore if already allowed
        }

        // Ensure there's excess collateral
        const collateralAmount = hre.ethers.parseUnits(
          "2000",
          collateralInfo.decimals
        );
        await collateralContract.approve(
          await collateralVaultContract.getAddress(),
          collateralAmount
        );
        await collateralVaultContract.deposit(
          collateralAmount,
          collateralInfo.address
        );

        // Calculate how much dStable this collateral is worth
        const collateralValueInDstable = await calculateExpectedDstableAmount(
          collateralAmount,
          collateralSymbol,
          collateralInfo.decimals,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          collateralInfo.address,
          dstableInfo.address
        );

        const initialCirculatingDstable =
          await issuerContract.circulatingDstable();

        // Use a value less than the collateral value to ensure it succeeds
        const amountToMint = collateralValueInDstable / 2n;
        const receiver = user2;
        const initialReceiverBalance =
          await dstableContract.balanceOf(receiver);

        await issuerContract.issueUsingExcessCollateral(receiver, amountToMint);

        const finalCirculatingDstable =
          await issuerContract.circulatingDstable();
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
    });
  });
});
