import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  Issuer,
  MockAmoVault,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import { ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  createDStableAmoFixture,
  DUSD_CONFIG,
  DS_CONFIG,
  DStableFixtureConfig,
} from "./fixtures";

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`AmoManager Ecosystem Tests for ${config.symbol}`, () => {
    let amoManagerContract: AmoManager;
    let issuerContract: Issuer;
    let collateralVaultContract: CollateralHolderVault;
    let mockAmoVaultContract: MockAmoVault;

    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;

    // Collateral contracts and info
    let collateralContracts: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();

    let deployer: Address;
    let user1: Address;
    let user2: Address;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableAmoFixture(config);

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

      // Get dStable token info first
      ({ contract: dstableContract, tokenInfo: dstableInfo } =
        await getTokenContractForSymbol(
          hre,
          deployer,
          config.symbol as "dUSD" | "dS"
        ));

      // Deploy a new MockAmoVault directly instead of trying to find it in logs
      const MockAmoVaultFactory =
        await hre.ethers.getContractFactory("MockAmoVault");
      mockAmoVaultContract = await MockAmoVaultFactory.deploy(
        await dstableContract.getAddress(),
        amoManagerAddress,
        deployer,
        deployer,
        deployer,
        (await hre.deployments.get(ORACLE_AGGREGATOR_ID)).address
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

        // Allow collaterals in vaults
        await collateralVaultContract.allowCollateral(tokenInfo.address);
        await mockAmoVaultContract.allowCollateral(tokenInfo.address);
      }

      // Enable MockAmoVault in the AmoManager
      await amoManagerContract.enableAmoVault(
        await mockAmoVaultContract.getAddress()
      );

      // Assign COLLATERAL_WITHDRAWER_ROLE to the AmoManager for the MockAmoVault
      await mockAmoVaultContract.grantRole(
        await mockAmoVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
        await amoManagerContract.getAddress()
      );

      // Assign COLLATERAL_WITHDRAWER_ROLE to the AmoManager for the CollateralHolderVault
      await collateralVaultContract.grantRole(
        await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
        await amoManagerContract.getAddress()
      );

      // Mint some dStable to the AmoManager for testing
      const initialAmoSupply = hre.ethers.parseUnits(
        "10000",
        dstableInfo.decimals
      );
      await issuerContract.increaseAmoSupply(initialAmoSupply);
    });

    describe("AMO ecosystem interactions", () => {
      it("calculates vault value with various assets", async function () {
        // 1. Allocate dStable to the AMO vault
        const dstableToAllocate = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals
        );

        await amoManagerContract.allocateAmo(
          await mockAmoVaultContract.getAddress(),
          dstableToAllocate
        );

        // 2. AmoVault acquires some collateral
        // Use the first collateral type
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        const collateralAmount = hre.ethers.parseUnits(
          "500",
          collateralInfo.decimals
        );
        await collateralContract.transfer(
          await mockAmoVaultContract.getAddress(),
          collateralAmount
        );

        // 3. Set some fake DeFi value
        const fakeDeFiValue = hre.ethers.parseUnits("200", 8); // $200 with 8 decimals
        await mockAmoVaultContract.setFakeDeFiCollateralValue(fakeDeFiValue);

        // 4. Calculate total vault value
        const dstableValue = await mockAmoVaultContract.totalDstableValue();
        const collateralValue =
          await mockAmoVaultContract.totalCollateralValue();
        const totalValue = await mockAmoVaultContract.totalValue();

        // 5. Verify the values
        assert.equal(
          totalValue,
          dstableValue + collateralValue,
          "Total value should be sum of dStable and collateral value"
        );

        // The collateral value should include both the actual collateral and the fake DeFi value
        const expectedCollateralValue =
          (await collateralVaultContract.assetValueFromAmount(
            collateralAmount,
            collateralInfo.address
          )) + fakeDeFiValue;

        assert.equal(
          collateralValue,
          expectedCollateralValue,
          "Collateral value calculation is incorrect"
        );
      });

      it("transfers collateral between AMO vault and collateral vault", async function () {
        // 1. AmoVault acquires some collateral
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        const collateralAmount = hre.ethers.parseUnits(
          "500",
          collateralInfo.decimals
        );
        await collateralContract.transfer(
          await mockAmoVaultContract.getAddress(),
          collateralAmount
        );

        // 2. Check initial balances
        const initialAmoVaultBalance = await collateralContract.balanceOf(
          await mockAmoVaultContract.getAddress()
        );
        const initialVaultBalance = await collateralContract.balanceOf(
          await collateralVaultContract.getAddress()
        );

        // 3. Transfer half of the collateral from AmoVault to collateral vault
        const transferAmount = collateralAmount / 2n;
        await amoManagerContract.transferFromAmoVaultToHoldingVault(
          await mockAmoVaultContract.getAddress(),
          collateralInfo.address,
          transferAmount
        );

        // 4. Check final balances
        const finalAmoVaultBalance = await collateralContract.balanceOf(
          await mockAmoVaultContract.getAddress()
        );
        const finalVaultBalance = await collateralContract.balanceOf(
          await collateralVaultContract.getAddress()
        );

        assert.equal(
          initialAmoVaultBalance - finalAmoVaultBalance,
          transferAmount,
          "AmoVault balance should decrease by transfer amount"
        );

        assert.equal(
          finalVaultBalance - initialVaultBalance,
          transferAmount,
          "Vault balance should increase by transfer amount"
        );
      });

      it("transfers collateral from collateral vault to AMO vault", async function () {
        // 1. Deposit collateral into the collateral vault
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol
        ) as TokenInfo;

        const collateralAmount = hre.ethers.parseUnits(
          "500",
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

        // 2. Check initial balances
        const initialAmoVaultBalance = await collateralContract.balanceOf(
          await mockAmoVaultContract.getAddress()
        );
        const initialVaultBalance = await collateralContract.balanceOf(
          await collateralVaultContract.getAddress()
        );

        // 3. Transfer half of the collateral from collateral vault to AmoVault
        const transferAmount = collateralAmount / 2n;
        await amoManagerContract.transferFromHoldingVaultToAmoVault(
          await mockAmoVaultContract.getAddress(),
          collateralInfo.address,
          transferAmount
        );

        // 4. Check final balances
        const finalAmoVaultBalance = await collateralContract.balanceOf(
          await mockAmoVaultContract.getAddress()
        );
        const finalVaultBalance = await collateralContract.balanceOf(
          await collateralVaultContract.getAddress()
        );

        assert.equal(
          finalAmoVaultBalance - initialAmoVaultBalance,
          transferAmount,
          "AmoVault balance should increase by transfer amount"
        );

        assert.equal(
          initialVaultBalance - finalVaultBalance,
          transferAmount,
          "Vault balance should decrease by transfer amount"
        );
      });
    });

    describe("AMO vault performance tracking", () => {
      beforeEach(async function () {
        // Allocate dStable to the AMO vault
        const dstableToAllocate = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals
        );
        await amoManagerContract.allocateAmo(
          await mockAmoVaultContract.getAddress(),
          dstableToAllocate
        );
      });

      it("calculates profit and loss correctly", async function () {
        // Get a collateral token to use for the test
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(collateralSymbol)!;

        // Set up initial values
        const collateralAmount = hre.ethers.parseUnits(
          "1000",
          collateralInfo.decimals
        );

        // Calculate initial vault profit/loss - should be zero at this point
        const initialProfitUsd =
          await amoManagerContract.availableVaultProfitsInUsd(
            await mockAmoVaultContract.getAddress()
          );

        // Deposit collateral into the MockAmoVault
        await collateralContract.approve(
          await mockAmoVaultContract.getAddress(),
          collateralAmount
        );
        await mockAmoVaultContract.deposit(
          collateralAmount,
          await collateralContract.getAddress()
        );

        // Calculate vault profit after depositing collateral
        const profitAfterDepositUsd =
          await amoManagerContract.availableVaultProfitsInUsd(
            await mockAmoVaultContract.getAddress()
          );

        // Value of deposited collateral in USD
        const depositValueUsd = await mockAmoVaultContract.assetValueFromAmount(
          collateralAmount,
          await collateralContract.getAddress()
        );

        // Profit should increase by the value of the deposited collateral
        assert.equal(
          profitAfterDepositUsd - initialProfitUsd,
          depositValueUsd,
          "Profit should increase by the value of the deposited collateral"
        );

        // Now simulate a loss by removing some of the collateral
        const lossAmount = hre.ethers.parseUnits(
          "500",
          collateralInfo.decimals
        );

        await mockAmoVaultContract.mockRemoveAsset(
          await collateralContract.getAddress(),
          lossAmount
        );

        // Calculate vault profit after loss
        const profitAfterLossUsd =
          await amoManagerContract.availableVaultProfitsInUsd(
            await mockAmoVaultContract.getAddress()
          );

        // Value of removed collateral in USD
        const lossValueUsd = await mockAmoVaultContract.assetValueFromAmount(
          lossAmount,
          await collateralContract.getAddress()
        );

        // Profit should decrease by the value of the removed collateral
        assert.equal(
          profitAfterDepositUsd - profitAfterLossUsd,
          lossValueUsd,
          "Profit should decrease by the value of the removed collateral"
        );

        // Set fake DeFi collateral value to simulate additional profit
        const fakeDeFiValueUsd = hre.ethers.parseUnits(
          "300",
          ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        await mockAmoVaultContract.setFakeDeFiCollateralValue(fakeDeFiValueUsd);

        // Calculate profit after adding DeFi value
        const profitAfterDeFiUsd =
          await amoManagerContract.availableVaultProfitsInUsd(
            await mockAmoVaultContract.getAddress()
          );

        // Profit should increase by the fake DeFi value
        assert.equal(
          profitAfterDeFiUsd - profitAfterLossUsd,
          fakeDeFiValueUsd,
          "Profit should increase by the fake DeFi value"
        );

        // Calculate the available profit in dstable (may differ from USD if dstable price ≠ 1)
        // We need to get the price from the vault's perspective - using a collateral token with 1 unit
        // to see what the oracle says about dstable's price
        const oneUnit = 1n * 10n ** BigInt(dstableInfo.decimals);
        const dstablePriceInUsd =
          await mockAmoVaultContract.assetValueFromAmount(
            oneUnit,
            await dstableContract.getAddress()
          );

        // Try to withdraw some of the profit
        const takeProfitAmount = hre.ethers.parseUnits(
          "100",
          collateralInfo.decimals
        );

        // Value of profit amount in USD
        const takeProfitValueUsd =
          await mockAmoVaultContract.assetValueFromAmount(
            takeProfitAmount,
            await collateralContract.getAddress()
          );

        // Calculate the expected amount based on dstable price
        // If dstable price isn't 1, the amount that can be withdrawn will be affected

        // Check the token's balances before taking profit
        const initialRecipientBalance =
          await collateralContract.balanceOf(user1);

        // Take profit
        await amoManagerContract.withdrawProfits(
          await mockAmoVaultContract.getAddress(),
          user1,
          await collateralContract.getAddress(),
          takeProfitAmount
        );

        // Check the token's balances after taking profit
        const finalRecipientBalance = await collateralContract.balanceOf(user1);

        // Recipient should receive the profit amount
        assert.equal(
          finalRecipientBalance - initialRecipientBalance,
          takeProfitAmount,
          "Recipient should receive the correct profit amount"
        );

        // Calculate profit after withdrawing
        const profitAfterWithdrawUsd =
          await amoManagerContract.availableVaultProfitsInUsd(
            await mockAmoVaultContract.getAddress()
          );

        // Profit should decrease by the value of the withdrawn profit
        assert.equal(
          profitAfterDeFiUsd - profitAfterWithdrawUsd,
          takeProfitValueUsd,
          "Profit should decrease by the value of the withdrawn profit"
        );
      });

      it("handles recovery of non-vault assets", async function () {
        // Use a collateral that's not in the vault configuration
        const recovererRole = await mockAmoVaultContract.RECOVERER_ROLE();
        await mockAmoVaultContract.grantRole(recovererRole, deployer);

        // Transfer some ERC20 token to the vault
        // For this test we'll use a collateral token but assume it was sent accidentally
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;

        // First disallow the collateral to make it a "non-vault asset"
        await mockAmoVaultContract.disallowCollateral(
          collateralContract.getAddress()
        );

        // Send some tokens to the vault
        const tokenAmount = hre.ethers.parseUnits(
          "100",
          await collateralContract.decimals()
        );
        await collateralContract.transfer(
          await mockAmoVaultContract.getAddress(),
          tokenAmount
        );

        // Recover the tokens
        const receiverBalanceBefore = await collateralContract.balanceOf(user1);

        await mockAmoVaultContract.recoverERC20(
          await collateralContract.getAddress(),
          user1,
          tokenAmount
        );

        const receiverBalanceAfter = await collateralContract.balanceOf(user1);

        assert.equal(
          receiverBalanceAfter - receiverBalanceBefore,
          tokenAmount,
          "Token recovery failed"
        );
      });

      it("prevents recovery of vault assets", async function () {
        // Add a recoverer
        const recovererRole = await mockAmoVaultContract.RECOVERER_ROLE();
        await mockAmoVaultContract.grantRole(recovererRole, deployer);

        // Try to recover dStable (a vault asset)
        await expect(
          mockAmoVaultContract.recoverERC20(
            await dstableContract.getAddress(),
            user1,
            hre.ethers.parseUnits("1", dstableInfo.decimals)
          )
        ).to.be.revertedWithCustomError(
          mockAmoVaultContract,
          "CannotRecoverVaultToken"
        );

        // Try to recover a collateral asset
        const collateralSymbol = config.collateralSymbols[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol
        ) as TestERC20;

        // First add some collateral to the vault
        await collateralContract.transfer(
          await mockAmoVaultContract.getAddress(),
          hre.ethers.parseUnits("10", await collateralContract.decimals())
        );

        // Try to recover the collateral
        await expect(
          mockAmoVaultContract.recoverERC20(
            await collateralContract.getAddress(),
            user1,
            hre.ethers.parseUnits("1", await collateralContract.decimals())
          )
        ).to.be.revertedWithCustomError(
          mockAmoVaultContract,
          "CannotRecoverVaultToken"
        );
      });
    });
  });
});
