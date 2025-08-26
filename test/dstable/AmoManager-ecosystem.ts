import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  AmoManager,
  CollateralHolderVault,
  IssuerV2,
  MockAmoVault,
  OracleAggregator,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import {
  createDStableAmoFixture,
  DS_CONFIG,
  DStableFixtureConfig,
  DUSD_CONFIG,
} from "./fixtures";

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`AmoManager Ecosystem Tests for ${config.symbol}`, () => {
    let amoManagerContract: AmoManager;
    let issuerContract: IssuerV2;
    let collateralVaultContract: CollateralHolderVault;
    let mockAmoVaultContract: MockAmoVault;
    let oracleAggregatorContract: OracleAggregator;

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
        "IssuerV2",
        issuerAddress,
        await hre.ethers.getSigner(deployer),
      );

      const collateralVaultAddress = await issuerContract.collateralVault();
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      const amoManagerAddress = await issuerContract.amoManager();
      amoManagerContract = await hre.ethers.getContractAt(
        "AmoManager",
        amoManagerAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the oracle aggregator
      const oracleAggregatorAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get dStable token info
      const dstableResult = await getTokenContractForSymbol(
        hre,
        deployer,
        config.symbol,
      );
      dstableContract = dstableResult.contract as TestMintableERC20;
      dstableInfo = dstableResult.tokenInfo;

      // Create a new MockAmoVault for testing
      const mockAmoVaultAddress = (await hre.deployments.get("MockAmoVault"))
        .address;
      mockAmoVaultContract = await hre.ethers.getContractAt(
        "MockAmoVault",
        mockAmoVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Verify the MockAmoVault is set up correctly
      expect(await mockAmoVaultContract.dstable()).to.equal(
        dstableInfo.address,
      );
      expect(await mockAmoVaultContract.amoManager()).to.equal(
        amoManagerAddress,
      );
      expect(await mockAmoVaultContract.oracle()).to.equal(
        oracleAggregatorAddress,
      );

      // Initialize all collateral tokens for this dStable
      for (const collateralSymbol of [
        ...config.peggedCollaterals,
        ...config.yieldBearingCollaterals,
      ]) {
        const { contract, tokenInfo } = await getTokenContractForSymbol(
          hre,
          deployer,
          collateralSymbol,
        );
        collateralContracts.set(collateralSymbol, contract as TestERC20);
        collateralInfos.set(collateralSymbol, tokenInfo);

        // Allow this collateral in MockAmoVault only since CollateralVault is already set up by fixture
        await mockAmoVaultContract.allowCollateral(tokenInfo.address);
      }

      // Enable MockAmoVault in the AmoManager
      await amoManagerContract.enableAmoVault(
        await mockAmoVaultContract.getAddress(),
      );

      // Assign COLLATERAL_WITHDRAWER_ROLE to the AmoManager for both vaults
      await mockAmoVaultContract.grantRole(
        await mockAmoVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
        await amoManagerContract.getAddress(),
      );

      await collateralVaultContract.grantRole(
        await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
        await amoManagerContract.getAddress(),
      );

      // Mint some dStable to the AmoManager for testing
      const initialAmoSupply = hre.ethers.parseUnits(
        "10000",
        dstableInfo.decimals,
      );
      const appConfig = await getConfig(hre);
      const governanceSigner = await hre.ethers.getSigner(
        appConfig.walletAddresses.governanceMultisig,
      );
      await issuerContract
        .connect(governanceSigner)
        .increaseAmoSupply(initialAmoSupply);
    });

    /**
     * Calculates the expected base value of a token amount based on oracle prices
     *
     * @param amount - The amount of token
     * @param tokenAddress - The address of the token
     * @returns The base value of the token amount
     */
    async function calculateBaseValueFromAmount(
      amount: bigint,
      tokenAddress: Address,
    ): Promise<bigint> {
      const price = await oracleAggregatorContract.getAssetPrice(tokenAddress);
      const decimals = await (
        await hre.ethers.getContractAt("TestERC20", tokenAddress)
      ).decimals();
      return (amount * price) / 10n ** BigInt(decimals);
    }

    describe("AMO ecosystem interactions", () => {
      it("verifies oracle prices for pegged and yield-bearing collateral", async function () {
        // Check pegged collateral prices (should be 1:1)
        for (const symbol of config.peggedCollaterals) {
          const collateralInfo = collateralInfos.get(symbol)!;
          const price = await oracleAggregatorContract.getAssetPrice(
            collateralInfo.address,
          );
          const expectedPrice = hre.ethers.parseUnits("1", 18); // API3 uses 18 decimals
          assert.equal(
            price,
            expectedPrice,
            `Pegged collateral ${symbol} should have 1:1 price ratio`,
          );
        }

        // Check yield-bearing collateral prices (should be 1:1.1)
        for (const symbol of config.yieldBearingCollaterals) {
          const collateralInfo = collateralInfos.get(symbol)!;
          const price = await oracleAggregatorContract.getAssetPrice(
            collateralInfo.address,
          );
          const expectedPrice = hre.ethers.parseUnits("1.1", 18); // API3 uses 18 decimals
          assert.equal(
            price,
            expectedPrice,
            `Yield-bearing collateral ${symbol} should have 1:1.1 price ratio`,
          );
        }
      });

      it("calculates profit correctly with yield-bearing collateral", async function () {
        if (config.yieldBearingCollaterals.length === 0) {
          console.log(
            "Skipping yield-bearing test as no yield-bearing collateral configured",
          );
          return;
        }

        // Get a yield-bearing collateral token to use for the test
        const collateralSymbol = config.yieldBearingCollaterals[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol,
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(collateralSymbol)!;

        // Allocate dStable to the AMO vault
        const dstableToAllocate = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );
        await amoManagerContract.allocateAmo(
          await mockAmoVaultContract.getAddress(),
          dstableToAllocate,
        );

        // Calculate initial vault profit/loss - should be zero at this point
        const initialProfitBase =
          await amoManagerContract.availableVaultProfitsInBase(
            await mockAmoVaultContract.getAddress(),
          );

        // Deposit yield-bearing collateral into the MockAmoVault
        const collateralAmount = hre.ethers.parseUnits(
          "1000",
          collateralInfo.decimals,
        );

        // Approve and deposit collateral
        await collateralContract.approve(
          await mockAmoVaultContract.getAddress(),
          collateralAmount,
        );
        await mockAmoVaultContract.deposit(
          collateralAmount,
          collateralInfo.address,
        );

        // Calculate vault profit after depositing collateral
        const profitAfterDepositBase =
          await amoManagerContract.availableVaultProfitsInBase(
            await mockAmoVaultContract.getAddress(),
          );

        // Calculate expected value of deposited collateral in base units using oracle prices
        const expectedDepositValueBase = await calculateBaseValueFromAmount(
          collateralAmount,
          collateralInfo.address,
        );

        // Since yield-bearing collateral is worth 1.1x, we should see a profit
        const expectedProfit = expectedDepositValueBase;

        assert.equal(
          profitAfterDepositBase - initialProfitBase,
          expectedProfit,
          `Profit from yield-bearing collateral should match expected value`,
        );
      });

      it("calculates vault value with various assets", async function () {
        // 1. Allocate dStable to the AMO vault
        const dstableToAllocate = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );

        await amoManagerContract.allocateAmo(
          await mockAmoVaultContract.getAddress(),
          dstableToAllocate,
        );

        // 2. AmoVault acquires both pegged and yield-bearing collateral
        const peggedCollateralSymbol = config.peggedCollaterals[0];
        const peggedCollateralContract = collateralContracts.get(
          peggedCollateralSymbol,
        ) as TestERC20;
        const peggedCollateralInfo = collateralInfos.get(
          peggedCollateralSymbol,
        ) as TokenInfo;

        const peggedCollateralAmount = hre.ethers.parseUnits(
          "500",
          peggedCollateralInfo.decimals,
        );

        // Approve and deposit pegged collateral
        await peggedCollateralContract.approve(
          await mockAmoVaultContract.getAddress(),
          peggedCollateralAmount,
        );
        await mockAmoVaultContract.deposit(
          peggedCollateralAmount,
          peggedCollateralInfo.address,
        );

        // Add yield-bearing collateral if available
        let yieldBearingCollateralAmount = 0n;
        let yieldBearingCollateralInfo: TokenInfo | undefined;

        if (config.yieldBearingCollaterals.length > 0) {
          const yieldBearingCollateralSymbol =
            config.yieldBearingCollaterals[0];
          const yieldBearingCollateralContract = collateralContracts.get(
            yieldBearingCollateralSymbol,
          ) as TestERC20;
          yieldBearingCollateralInfo = collateralInfos.get(
            yieldBearingCollateralSymbol,
          ) as TokenInfo;

          yieldBearingCollateralAmount = hre.ethers.parseUnits(
            "300",
            yieldBearingCollateralInfo.decimals,
          );

          // Approve and deposit yield-bearing collateral
          await yieldBearingCollateralContract.approve(
            await mockAmoVaultContract.getAddress(),
            yieldBearingCollateralAmount,
          );
          await mockAmoVaultContract.deposit(
            yieldBearingCollateralAmount,
            yieldBearingCollateralInfo.address,
          );
        }

        // 3. Set some fake DeFi value
        const fakeDeFiValue = hre.ethers.parseUnits(
          "200",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );
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
          "Total value should be sum of dStable and collateral value",
        );

        // Calculate expected dStable value using oracle prices
        const expectedDstableValue = await calculateBaseValueFromAmount(
          dstableToAllocate,
          dstableInfo.address,
        );

        // Calculate expected pegged collateral value using oracle prices
        const expectedPeggedCollateralValue =
          await calculateBaseValueFromAmount(
            peggedCollateralAmount,
            peggedCollateralInfo.address,
          );

        // Calculate expected yield-bearing collateral value using oracle prices
        let expectedYieldBearingCollateralValue = 0n;

        if (yieldBearingCollateralInfo && yieldBearingCollateralAmount > 0n) {
          expectedYieldBearingCollateralValue =
            await calculateBaseValueFromAmount(
              yieldBearingCollateralAmount,
              yieldBearingCollateralInfo.address,
            );
        }

        // The collateral value should include pegged collateral, yield-bearing collateral, and the fake DeFi value
        const expectedTotalCollateralValue =
          expectedPeggedCollateralValue +
          expectedYieldBearingCollateralValue +
          fakeDeFiValue;

        assert.equal(
          collateralValue,
          expectedTotalCollateralValue,
          `Collateral value should match expected value`,
        );
      });

      it("transfers collateral between AMO vault and collateral vault", async function () {
        // Test with both pegged and yield-bearing collateral
        const testTransfer = async (collateralSymbol: string) => {
          const collateralContract = collateralContracts.get(
            collateralSymbol,
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol,
          ) as TokenInfo;

          const collateralAmount = hre.ethers.parseUnits(
            "500",
            collateralInfo.decimals,
          );
          await collateralContract.transfer(
            await mockAmoVaultContract.getAddress(),
            collateralAmount,
          );

          // Check initial balances
          const initialAmoVaultBalance = await collateralContract.balanceOf(
            await mockAmoVaultContract.getAddress(),
          );
          const initialVaultBalance = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress(),
          );

          // Transfer half of the collateral from AmoVault to collateral vault
          const transferAmount = collateralAmount / 2n;
          await amoManagerContract.transferFromAmoVaultToHoldingVault(
            await mockAmoVaultContract.getAddress(),
            collateralInfo.address,
            transferAmount,
          );

          // Check final balances
          const finalAmoVaultBalance = await collateralContract.balanceOf(
            await mockAmoVaultContract.getAddress(),
          );
          const finalVaultBalance = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress(),
          );

          assert.equal(
            initialAmoVaultBalance - finalAmoVaultBalance,
            transferAmount,
            `AmoVault balance should decrease by transfer amount for ${collateralSymbol}`,
          );

          assert.equal(
            finalVaultBalance - initialVaultBalance,
            transferAmount,
            `Vault balance should increase by transfer amount for ${collateralSymbol}`,
          );

          // Now test transfer back to AMO vault
          await amoManagerContract.transferFromHoldingVaultToAmoVault(
            await mockAmoVaultContract.getAddress(),
            collateralInfo.address,
            transferAmount,
          );

          const finalAmoVaultBalanceAfterReturn =
            await collateralContract.balanceOf(
              await mockAmoVaultContract.getAddress(),
            );
          const finalVaultBalanceAfterReturn =
            await collateralContract.balanceOf(
              await collateralVaultContract.getAddress(),
            );

          assert.equal(
            finalAmoVaultBalanceAfterReturn,
            initialAmoVaultBalance,
            `AmoVault balance should return to initial amount for ${collateralSymbol}`,
          );
          assert.equal(
            finalVaultBalanceAfterReturn,
            initialVaultBalance,
            `Vault balance should return to initial amount for ${collateralSymbol}`,
          );
        };

        // Test with pegged collateral
        await testTransfer(config.peggedCollaterals[0]);

        // Test with yield-bearing collateral if available
        if (config.yieldBearingCollaterals.length > 0) {
          await testTransfer(config.yieldBearingCollaterals[0]);
        }
      });
    });
  });
});
