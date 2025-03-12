import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  CollateralHolderVault,
  TestERC20,
  OracleAggregator,
} from "../../typechain-types";
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

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`CollateralHolderVault for ${config.symbol}`, () => {
    let collateralVaultContract: CollateralHolderVault;
    let collateralContracts: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();
    let oracleAggregatorContract: OracleAggregator;
    let deployer: Address;
    let user1: Address;
    let user2: Address;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      const vaultAddress = (
        await hre.deployments.get(config.collateralVaultContractId)
      ).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        vaultAddress,
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

      // Initialize all collateral tokens for this dStable
      for (const collateralSymbol of config.collateralSymbols) {
        const { contract, tokenInfo } = await getTokenContractForSymbol(
          hre,
          deployer,
          collateralSymbol
        );
        collateralContracts.set(collateralSymbol, contract as TestERC20);
        collateralInfos.set(collateralSymbol, tokenInfo);

        // Transfer 1000 of each collateral to user1 for testing
        const amount = hre.ethers.parseUnits("1000", tokenInfo.decimals);
        await contract.transfer(user1, amount);
      }
    });

    /**
     * Calculates the expected USD value of a token amount based on oracle prices
     * @param amount - The amount of token
     * @param tokenAddress - The address of the token
     * @returns The USD value of the token amount
     */
    async function calculateUsdValueFromAmount(
      amount: bigint,
      tokenAddress: Address
    ): Promise<bigint> {
      const price = await oracleAggregatorContract.getAssetPrice(tokenAddress);
      const decimals = await (
        await hre.ethers.getContractAt("TestERC20", tokenAddress)
      ).decimals();
      return (amount * price) / 10n ** BigInt(decimals);
    }

    /**
     * Calculates the expected token amount from a USD value based on oracle prices
     * @param usdValue - The USD value
     * @param tokenAddress - The address of the token
     * @returns The token amount equivalent to the USD value
     */
    async function calculateAmountFromUsdValue(
      usdValue: bigint,
      tokenAddress: Address
    ): Promise<bigint> {
      const price = await oracleAggregatorContract.getAssetPrice(tokenAddress);
      const decimals = await (
        await hre.ethers.getContractAt("TestERC20", tokenAddress)
      ).decimals();
      return (usdValue * 10n ** BigInt(decimals)) / price;
    }

    describe("Collateral management", () => {
      // Test for each collateral type
      config.collateralSymbols.forEach((collateralSymbol) => {
        it(`allows ${collateralSymbol} as collateral`, async function () {
          const collateralInfo = collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          await collateralVaultContract.allowCollateral(collateralInfo.address);

          // There's no direct method to check if collateral is allowed, so we'll test by trying to deposit
          const depositAmount = hre.ethers.parseUnits(
            "1",
            collateralInfo.decimals
          );
          const collateralContract = collateralContracts.get(
            collateralSymbol
          ) as TestERC20;

          await collateralContract.approve(
            await collateralVaultContract.getAddress(),
            depositAmount
          );

          // If this doesn't revert, then collateral is allowed
          await collateralVaultContract.deposit(
            depositAmount,
            collateralInfo.address
          );
        });

        it(`allows depositing ${collateralSymbol}`, async function () {
          const collateralContract = collateralContracts.get(
            collateralSymbol
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          // Allow this collateral in the vault
          await collateralVaultContract.allowCollateral(collateralInfo.address);

          const depositAmount = hre.ethers.parseUnits(
            "500",
            collateralInfo.decimals
          );

          await collateralContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await collateralVaultContract.getAddress(), depositAmount);

          const vaultBalanceBefore = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress()
          );
          const userBalanceBefore = await collateralContract.balanceOf(user1);

          await collateralVaultContract
            .connect(await hre.ethers.getSigner(user1))
            .deposit(depositAmount, collateralInfo.address);

          const vaultBalanceAfter = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress()
          );
          const userBalanceAfter = await collateralContract.balanceOf(user1);

          assert.equal(
            vaultBalanceAfter - vaultBalanceBefore,
            depositAmount,
            `Vault ${collateralSymbol} balance should increase by deposit amount`
          );
          assert.equal(
            userBalanceBefore - userBalanceAfter,
            depositAmount,
            `User ${collateralSymbol} balance should decrease by deposit amount`
          );
        });

        it(`disallows depositing non-allowed ${collateralSymbol}`, async function () {
          const collateralInfo = collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;
          const depositAmount = hre.ethers.parseUnits(
            "1",
            collateralInfo.decimals
          );
          const collateralContract = collateralContracts.get(
            collateralSymbol
          ) as TestERC20;

          // Create a non-allowed collateral address
          const nonAllowedCollateral =
            "0x0000000000000000000000000000000000000123";

          // Try to deposit using the non-allowed collateral address
          // We'll still use the original collateral contract for approval
          await collateralContract.approve(
            await collateralVaultContract.getAddress(),
            depositAmount
          );

          // Should revert with UnsupportedCollateral error
          await expect(
            collateralVaultContract.deposit(depositAmount, nonAllowedCollateral)
          )
            .to.be.revertedWithCustomError(
              collateralVaultContract,
              "UnsupportedCollateral"
            )
            .withArgs(nonAllowedCollateral);
        });
      });
    });

    describe("USD value calculations", () => {
      // Test with first collateral for simplicity
      it("calculates total value correctly", async function () {
        let expectedTotalValue = 0n;

        // Deposit all collaterals and track expected total value
        for (const collateralSymbol of config.collateralSymbols) {
          const collateralContract = collateralContracts.get(
            collateralSymbol
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          // Allow this collateral in the vault
          await collateralVaultContract.allowCollateral(collateralInfo.address);

          const depositAmount = hre.ethers.parseUnits(
            "100",
            collateralInfo.decimals
          );

          await collateralContract.approve(
            await collateralVaultContract.getAddress(),
            depositAmount
          );

          await collateralVaultContract.deposit(
            depositAmount,
            collateralInfo.address
          );

          // Calculate expected USD value of this collateral using oracle prices
          const collateralValue = await calculateUsdValueFromAmount(
            depositAmount,
            collateralInfo.address
          );
          expectedTotalValue += collateralValue;
        }

        const actualTotalValue = await collateralVaultContract.totalValue();

        // Allow for a small rounding error due to fixed-point math
        const difference =
          actualTotalValue > expectedTotalValue
            ? actualTotalValue - expectedTotalValue
            : expectedTotalValue - actualTotalValue;

        const acceptableError = 10n; // Small error margin for fixed-point calculations

        assert.isTrue(
          difference <= acceptableError,
          `Total value difference (${difference}) exceeds acceptable error (${acceptableError}). Expected: ${expectedTotalValue}, Actual: ${actualTotalValue}`
        );
      });

      it("correctly converts between USD value and asset amount", async function () {
        const collateralSymbol = config.collateralSymbols[0];
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        // Use a standard USD value for testing
        const usdValue = hre.ethers.parseUnits("100", 8); // 100 USD with 8 decimals

        // Get the asset amount from the contract
        const assetAmount = await collateralVaultContract.assetAmountFromValue(
          usdValue,
          collateralInfo.address
        );

        // Calculate the expected asset amount using oracle prices
        const expectedAssetAmount = await calculateAmountFromUsdValue(
          usdValue,
          collateralInfo.address
        );

        // Calculate the USD value from the asset amount using the contract
        const calculatedValue =
          await collateralVaultContract.assetValueFromAmount(
            assetAmount,
            collateralInfo.address
          );

        // Allow for a small rounding error due to fixed-point math
        const amountDifference =
          assetAmount > expectedAssetAmount
            ? assetAmount - expectedAssetAmount
            : expectedAssetAmount - assetAmount;

        const valueDifference =
          calculatedValue > usdValue
            ? calculatedValue - usdValue
            : usdValue - calculatedValue;

        const acceptableAmountError = (expectedAssetAmount * 1n) / 100n; // 1% error margin
        const acceptableValueError = (usdValue * 1n) / 100n; // 1% error margin

        assert.isTrue(
          amountDifference <= acceptableAmountError,
          `Asset amount difference (${amountDifference}) exceeds acceptable error (${acceptableAmountError}). Expected: ${expectedAssetAmount}, Actual: ${assetAmount}`
        );

        assert.isTrue(
          valueDifference <= acceptableValueError,
          `USD value difference (${valueDifference}) exceeds acceptable error (${acceptableValueError}). Expected: ${usdValue}, Actual: ${calculatedValue}`
        );
      });
    });

    describe("Administrative functions", () => {
      it("allows authorized withdrawals", async function () {
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        // Allow this collateral in the vault and deposit
        await collateralVaultContract.allowCollateral(collateralInfo.address);
        const depositAmount = hre.ethers.parseUnits(
          "100",
          collateralInfo.decimals
        );

        await collateralContract.approve(
          await collateralVaultContract.getAddress(),
          depositAmount
        );

        await collateralVaultContract.deposit(
          depositAmount,
          collateralInfo.address
        );

        // Grant COLLATERAL_WITHDRAWER_ROLE to user2
        const COLLATERAL_WITHDRAWER_ROLE =
          await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();
        await collateralVaultContract.grantRole(
          COLLATERAL_WITHDRAWER_ROLE,
          user2
        );

        // Withdraw as authorized user
        const withdrawAmount = hre.ethers.parseUnits(
          "50",
          collateralInfo.decimals
        );
        const vaultBalanceBefore = await collateralContract.balanceOf(
          await collateralVaultContract.getAddress()
        );
        const user1BalanceBefore = await collateralContract.balanceOf(user1);

        await collateralVaultContract
          .connect(await hre.ethers.getSigner(user2))
          .withdrawTo(user1, withdrawAmount, collateralInfo.address);

        const vaultBalanceAfter = await collateralContract.balanceOf(
          await collateralVaultContract.getAddress()
        );
        const user1BalanceAfter = await collateralContract.balanceOf(user1);

        assert.equal(
          vaultBalanceBefore - vaultBalanceAfter,
          withdrawAmount,
          "Vault balance should decrease by withdraw amount"
        );

        assert.equal(
          user1BalanceAfter - user1BalanceBefore,
          withdrawAmount,
          "User1 balance should increase by withdraw amount"
        );
      });

      it("prevents unauthorized withdrawals", async function () {
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        // Allow this collateral in the vault and deposit
        await collateralVaultContract.allowCollateral(collateralInfo.address);
        const depositAmount = hre.ethers.parseUnits(
          "100",
          collateralInfo.decimals
        );

        await collateralContract.approve(
          await collateralVaultContract.getAddress(),
          depositAmount
        );

        await collateralVaultContract.deposit(
          depositAmount,
          collateralInfo.address
        );

        // Try to withdraw as unauthorized user
        const withdrawAmount = hre.ethers.parseUnits(
          "50",
          collateralInfo.decimals
        );

        await expect(
          collateralVaultContract
            .connect(await hre.ethers.getSigner(user1))
            .withdrawTo(user1, withdrawAmount, collateralInfo.address)
        ).to.be.reverted;
      });
    });
  });
});
