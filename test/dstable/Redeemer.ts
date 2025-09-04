import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  Issuer,
  OracleAggregator,
  Redeemer,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import {
  createDStableFixture,
  DS_CONFIG,
  DStableFixtureConfig,
  DUSD_CONFIG,
} from "./fixtures";

// Define which assets are yield-bearing vs stable for reference
const yieldBearingAssets = new Set(["sfrxUSD", "stS", "wOS", "wS"]);
const isYieldBearingAsset = (symbol: string): boolean =>
  yieldBearingAssets.has(symbol);

/**
 * Calculates expected collateral amount when redeeming dStable based on oracle prices
 * This uses the actual oracle prices instead of hard-coded values
 *
 * @param dstableAmount
 * @param dstableSymbol
 * @param dstableDecimals
 * @param collateralSymbol
 * @param collateralDecimals
 * @param oracleAggregator
 * @param dstableAddress
 * @param collateralAddress
 */
async function calculateExpectedCollateralAmount(
  dstableAmount: bigint,
  dstableSymbol: string,
  dstableDecimals: number,
  collateralSymbol: string,
  collateralDecimals: number,
  oracleAggregator: OracleAggregator,
  dstableAddress: string,
  collateralAddress: string,
): Promise<bigint> {
  // Get prices from oracle aggregator
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);
  const collateralPrice =
    await oracleAggregator.getAssetPrice(collateralAddress);

  // Calculate base value of dStable
  // Formula: (dstableAmount * dstablePrice) / 10^dstableDecimals
  const dstableBaseValue =
    (dstableAmount * dstablePrice) / 10n ** BigInt(dstableDecimals);

  // Convert base value to collateral amount
  // Formula: (dstableBaseValue * 10^collateralDecimals) / collateralPrice
  return (
    (dstableBaseValue * 10n ** BigInt(collateralDecimals)) / collateralPrice
  );
}

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe.skip(`DEPRECATED: Redeemer for ${config.symbol}`, () => {
    let redeemerContract: Redeemer;
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

      const redeemerAddress = (
        await hre.deployments.get(config.redeemerContractId)
      ).address;
      redeemerContract = await hre.ethers.getContractAt(
        "Redeemer",
        redeemerAddress,
        await hre.ethers.getSigner(deployer),
      );

      const issuerAddress = (await hre.deployments.get(config.issuerContractId))
        .address;
      issuerContract = await hre.ethers.getContractAt(
        "Issuer",
        issuerAddress,
        await hre.ethers.getSigner(deployer),
      );

      const collateralVaultAddress = (
        await hre.deployments.get(config.collateralVaultContractId)
      ).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      const amoManagerAddress = (await hre.deployments.get(config.amoManagerId))
        .address;
      amoManagerContract = await hre.ethers.getContractAt(
        "AmoManager",
        amoManagerAddress,
        await hre.ethers.getSigner(deployer),
      );

      const oracleAggregatorAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get dStable token
      const { contract, tokenInfo } = await getTokenContractForSymbol(
        hre,
        deployer,
        config.symbol,
      );
      dstableContract = contract as TestMintableERC20;
      dstableInfo = tokenInfo;

      // Initialize all collateral tokens for this dStable
      for (const collateralSymbol of config.peggedCollaterals) {
        const result = await getTokenContractForSymbol(
          hre,
          deployer,
          collateralSymbol,
        );
        collateralContracts.set(collateralSymbol, result.contract as TestERC20);
        collateralInfos.set(collateralSymbol, result.tokenInfo);

        // Transfer 1000 of each collateral to user1 for testing
        const amount = hre.ethers.parseUnits("1000", result.tokenInfo.decimals);
        await result.contract.transfer(user1, amount);

        // Approve collateral for issuer
        const userAmount = hre.ethers.parseUnits(
          "500",
          result.tokenInfo.decimals,
        );
        await result.contract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerContract.getAddress(), userAmount);

        // Calculate minimum dStable amount to receive (with 5% slippage)
        const expectedDstableAmount =
          await issuerContract.baseValueToDstableAmount(
            await collateralVaultContract.assetValueFromAmount(
              userAmount,
              result.tokenInfo.address,
            ),
          );
        const minAmount = (expectedDstableAmount * 95n) / 100n; // 5% slippage

        // Issue dStable tokens to user1 using collateral - use the full approved amount
        await issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(userAmount, result.tokenInfo.address, minAmount);
      }

      // Grant REDEMPTION_MANAGER_ROLE to user1
      const REDEMPTION_MANAGER_ROLE =
        await redeemerContract.REDEMPTION_MANAGER_ROLE();
      await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user1);
    });

    describe("Basic redemption", () => {
      // Test redemption for each collateral type
      config.peggedCollaterals.forEach((collateralSymbol) => {
        it(`redeems ${config.symbol} for ${collateralSymbol}`, async function () {
          const collateralContract = collateralContracts.get(
            collateralSymbol,
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol,
          ) as TokenInfo;

          const redeemAmount = hre.ethers.parseUnits(
            "100",
            dstableInfo.decimals,
          );

          // Calculate expected collateral amount based on oracle prices
          const expectedCollateralAmount =
            await calculateExpectedCollateralAmount(
              redeemAmount,
              dstableInfo.symbol,
              dstableInfo.decimals,
              collateralSymbol,
              collateralInfo.decimals,
              oracleAggregatorContract,
              dstableInfo.address,
              collateralInfo.address,
            );

          // Apply a small slippage to ensure the test passes
          const slippagePercentage = 5; // 5% slippage
          const minCollateralOut =
            (expectedCollateralAmount * BigInt(100 - slippagePercentage)) /
            100n;

          const userDstableBalanceBefore =
            await dstableContract.balanceOf(user1);
          const userCollateralBalanceBefore =
            await collateralContract.balanceOf(user1);
          const vaultCollateralBalanceBefore =
            await collateralContract.balanceOf(
              await collateralVaultContract.getAddress(),
            );

          await dstableContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await redeemerContract.getAddress(), redeemAmount);

          await redeemerContract
            .connect(await hre.ethers.getSigner(user1))
            .redeem(redeemAmount, collateralInfo.address, minCollateralOut);

          const userDstableBalanceAfter =
            await dstableContract.balanceOf(user1);
          const userCollateralBalanceAfter =
            await collateralContract.balanceOf(user1);
          const vaultCollateralBalanceAfter =
            await collateralContract.balanceOf(
              await collateralVaultContract.getAddress(),
            );

          assert.equal(
            (userDstableBalanceBefore - userDstableBalanceAfter).toString(),
            redeemAmount.toString(),
            "User's dStable balance should decrease by the redeemed amount",
          );

          assert.isTrue(
            userCollateralBalanceAfter > userCollateralBalanceBefore,
            "User should receive collateral tokens",
          );

          assert.isTrue(
            userCollateralBalanceAfter - userCollateralBalanceBefore >=
              minCollateralOut,
            "User should receive at least the minimum collateral output",
          );

          // Check that the received amount is close to the expected amount (within slippage)
          const receivedCollateral =
            userCollateralBalanceAfter - userCollateralBalanceBefore;
          const lowerBound = (expectedCollateralAmount * BigInt(95)) / 100n; // 5% below expected
          const upperBound = (expectedCollateralAmount * BigInt(105)) / 100n; // 5% above expected

          assert.isTrue(
            receivedCollateral >= lowerBound &&
              receivedCollateral <= upperBound,
            `Received collateral (${receivedCollateral}) should be within 5% of expected amount (${expectedCollateralAmount})`,
          );

          assert.equal(
            vaultCollateralBalanceBefore - vaultCollateralBalanceAfter,
            userCollateralBalanceAfter - userCollateralBalanceBefore,
            "Vault collateral balance should decrease by the amount given to the user",
          );
        });

        it(`cannot redeem ${config.symbol} with insufficient balance`, async function () {
          const collateralInfo = collateralInfos.get(
            collateralSymbol,
          ) as TokenInfo;

          const userDstableBalance = await dstableContract.balanceOf(user1);
          const redeemAmount = userDstableBalance + 1n; // More than the user has
          const minCollateralOut = 1n; // Any non-zero value

          await dstableContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await redeemerContract.getAddress(), redeemAmount);

          await expect(
            redeemerContract
              .connect(await hre.ethers.getSigner(user1))
              .redeem(redeemAmount, collateralInfo.address, minCollateralOut),
          ).to.be.reverted;
        });

        it(`cannot redeem ${config.symbol} when slippage is too high`, async function () {
          const collateralInfo = collateralInfos.get(
            collateralSymbol,
          ) as TokenInfo;

          const redeemAmount = hre.ethers.parseUnits(
            "100",
            dstableInfo.decimals,
          );

          // Calculate expected collateral amount
          const expectedCollateralAmount =
            await calculateExpectedCollateralAmount(
              redeemAmount,
              dstableInfo.symbol,
              dstableInfo.decimals,
              collateralSymbol,
              collateralInfo.decimals,
              oracleAggregatorContract,
              dstableInfo.address,
              collateralInfo.address,
            );

          // Set an unrealistically high minimum (2x the expected amount)
          const unrealistically_high_min_collateral =
            expectedCollateralAmount * 2n;

          await dstableContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await redeemerContract.getAddress(), redeemAmount);

          await expect(
            redeemerContract
              .connect(await hre.ethers.getSigner(user1))
              .redeem(
                redeemAmount,
                collateralInfo.address,
                unrealistically_high_min_collateral,
              ),
          ).to.be.revertedWithCustomError(redeemerContract, "SlippageTooHigh");
        });
      });
    });

    describe("Administrative functions", () => {
      it("allows changing the collateral vault", async function () {
        // Deploy a new vault for testing
        const newVault = await hre.deployments.deploy("TestCollateralVault", {
          from: deployer,
          contract: "CollateralHolderVault",
          args: [await redeemerContract.oracle()],
          autoMine: true,
          log: false,
        });

        await redeemerContract.setCollateralVault(newVault.address);

        const updatedVault = await redeemerContract.collateralVault();
        assert.equal(
          updatedVault,
          newVault.address,
          "Collateral vault should be updated",
        );
      });

      it("allows setting collateral vault only by admin", async function () {
        await expect(
          redeemerContract
            .connect(await hre.ethers.getSigner(user1))
            .setCollateralVault(hre.ethers.ZeroAddress),
        ).to.be.reverted;
      });

      it("allows admin to grant REDEMPTION_MANAGER_ROLE", async function () {
        const REDEMPTION_MANAGER_ROLE =
          await redeemerContract.REDEMPTION_MANAGER_ROLE();

        await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user2);

        const hasRole = await redeemerContract.hasRole(
          REDEMPTION_MANAGER_ROLE,
          user2,
        );
        assert.isTrue(hasRole, "User should have REDEMPTION_MANAGER_ROLE");
      });
    });
  });
});
