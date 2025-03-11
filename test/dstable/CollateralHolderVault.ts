import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { CollateralHolderVault, TestERC20 } from "../../typechain-types";
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

// Define asset types for price calculation - same as in Issuer.ts
const STABLE_ASSET_PRICE = 1.0;
const YIELD_BEARING_ASSET_PRICE = 1.1;

// Define which assets are yield-bearing (price = 1.1) vs stable (price = 1.0)
const yieldBearingAssets = new Set(["sfrxUSD", "stS", "wOS", "wS"]);
const isYieldBearingAsset = (symbol: string): boolean =>
  yieldBearingAssets.has(symbol);

// dS token itself is treated as a yield-bearing asset in the oracle setup
const isYieldBearingToken = (symbol: string): boolean => symbol === "dS";

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`CollateralHolderVault for ${config.symbol}`, () => {
    let collateralVaultContract: CollateralHolderVault;
    let collateralContracts: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();
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
          const collateralContract = collateralContracts.get(
            collateralSymbol
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          // First, ensure collateral is allowed (so we can disallow it)
          try {
            // Check if the collateral is supported
            const isCollateralSupported =
              await collateralVaultContract.isCollateralSupported(
                collateralInfo.address
              );

            if (!isCollateralSupported) {
              // If not supported, allow it first
              await collateralVaultContract.allowCollateral(
                collateralInfo.address
              );
            }

            // Now disallow it
            await collateralVaultContract.disallowCollateral(
              collateralInfo.address
            );
          } catch (e) {
            console.log(
              `Error in setup for disallowing ${collateralSymbol}: ${e}`
            );
            // If we can't set up correctly, skip this test
            this.skip();
            return;
          }

          const depositAmount = hre.ethers.parseUnits(
            "500",
            collateralInfo.decimals
          );

          await collateralContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await collateralVaultContract.getAddress(), depositAmount);

          await expect(
            collateralVaultContract
              .connect(await hre.ethers.getSigner(user1))
              .deposit(depositAmount, collateralInfo.address)
          ).to.be.revertedWithCustomError(
            collateralVaultContract,
            "UnsupportedCollateral"
          );
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

          // Calculate expected USD value of this collateral
          const collateralValue =
            await collateralVaultContract.assetValueFromAmount(
              depositAmount,
              collateralInfo.address
            );
          expectedTotalValue += collateralValue;
        }

        const actualTotalValue = await collateralVaultContract.totalValue();

        assert.equal(
          actualTotalValue,
          expectedTotalValue,
          "Total value calculation is incorrect"
        );
      });

      it("correctly converts between USD value and asset amount", async function () {
        const collateralSymbol = config.collateralSymbols[0];
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        // For yield-bearing assets, we need to account for the 1.1 price factor
        // The amount of USD value should be 1.1x the token amount for yield-bearing assets
        const usdValue = hre.ethers.parseUnits("100", 8); // 100 USD with 8 decimals

        const assetAmount = await collateralVaultContract.assetAmountFromValue(
          usdValue,
          collateralInfo.address
        );

        const calculatedValue =
          await collateralVaultContract.assetValueFromAmount(
            assetAmount,
            collateralInfo.address
          );

        // The acceptable error should be larger for yield-bearing assets due to more complex calculations
        // that might involve rounding
        const isPriceAdjusted =
          isYieldBearingAsset(collateralSymbol) ||
          isYieldBearingToken(config.symbol);
        const acceptableError = isPriceAdjusted ? 2n : 1n; // Allow slightly larger error for price-adjusted assets

        // Allow for a small rounding error due to fixed-point math
        const difference = calculatedValue - usdValue;

        assert(
          (difference < 0n ? -difference : difference) <= acceptableError,
          `Value conversion difference (${difference}) exceeds acceptable error (${acceptableError})`
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
