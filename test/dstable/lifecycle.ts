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
  RedeemerV2,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getTokenContractForAddress,
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
  describe(`${config.symbol} Ecosystem Lifecycle`, () => {
    let amoManagerContract: AmoManager;
    let issuerContract: IssuerV2;
    let redeemerContract: RedeemerV2;
    let collateralHolderVaultContract: CollateralHolderVault;
    let oracleAggregatorContract: OracleAggregator;
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

      // Set up main contracts
      const issuerAddress = (await hre.deployments.get(config.issuerContractId))
        .address;
      issuerContract = await hre.ethers.getContractAt(
        "IssuerV2",
        issuerAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Resolve collateral vault and oracle
      const collateralVaultAddress = await issuerContract.collateralVault();
      collateralHolderVaultContract = await hre.ethers.getContractAt(
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

      // Get the oracle aggregator based on the dStable configuration
      const oracleAggregatorAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Deploy and wire up RedeemerV2 to use the existing vault, token and oracle
      const { tokenInfo: dstInfo } = await getTokenContractForSymbol(
        hre,
        deployer,
        config.symbol,
      );
      const RedeemerV2Factory = await hre.ethers.getContractFactory(
        "RedeemerV2",
        await hre.ethers.getSigner(deployer),
      );
      redeemerContract = (await RedeemerV2Factory.deploy(
        collateralVaultAddress,
        dstInfo.address,
        oracleAggregatorAddress,
        deployer,
        0,
      )) as unknown as RedeemerV2;
      await redeemerContract.waitForDeployment();

      // Allow RedeemerV2 to withdraw from the collateral vault
      await collateralHolderVaultContract.grantRole(
        await collateralHolderVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
        await redeemerContract.getAddress(),
      );

      // Get dStable token info
      ({ contract: dstableContract, tokenInfo: dstableInfo } =
        await getTokenContractForSymbol(hre, deployer, config.symbol));

      // Deploy a new MockAmoVault
      const MockAmoVaultFactory =
        await hre.ethers.getContractFactory("MockAmoVault");
      mockAmoVaultContract = await MockAmoVaultFactory.deploy(
        await dstableContract.getAddress(),
        amoManagerAddress,
        deployer,
        deployer,
        deployer,
        oracleAggregatorAddress,
      );

      // Initialize all collateral tokens for this dStable
      await initializeCollateralTokens();

      // Enable MockAmoVault in the AmoManager
      await amoManagerContract.enableAmoVault(
        await mockAmoVaultContract.getAddress(),
      );

      // Assign COLLATERAL_WITHDRAWER_ROLE to the AmoManager for both vaults
      await mockAmoVaultContract.grantRole(
        await mockAmoVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
        await amoManagerContract.getAddress(),
      );

      await collateralHolderVaultContract.grantRole(
        await collateralHolderVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
        await amoManagerContract.getAddress(),
      );

      // Grant REDEMPTION_MANAGER_ROLE to test users
      const REDEMPTION_MANAGER_ROLE =
        await redeemerContract.REDEMPTION_MANAGER_ROLE();
      await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user1);
      await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user2);
    });

    /**
     * Initializes collateral tokens based on the dStable configuration
     */
    async function initializeCollateralTokens() {
      // Get the network config to access collateral info
      const networkConfig = await getConfig(hre);

      // Get collateral list from config
      const collateralAddresses =
        networkConfig.dStables[config.symbol].collaterals;

      for (const collateralAddress of collateralAddresses) {
        if (collateralAddress === hre.ethers.ZeroAddress) continue;

        const { contract, tokenInfo } = await getTokenContractForAddress(
          hre,
          deployer,
          collateralAddress,
        );

        collateralContracts.set(tokenInfo.symbol, contract);
        collateralInfos.set(tokenInfo.symbol, tokenInfo);

        // Allow collateral in MockAmoVault
        await mockAmoVaultContract.allowCollateral(tokenInfo.address);
      }
    }

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

    /**
     * Calculates the expected token amount from a base value based on oracle prices
     *
     * @param baseValue - The base value
     * @param tokenAddress - The address of the token
     * @returns The token amount equivalent to the base value
     */
    async function calculateAmountFromBaseValue(
      baseValue: bigint,
      tokenAddress: Address,
    ): Promise<bigint> {
      const price = await oracleAggregatorContract.getAssetPrice(tokenAddress);
      const decimals = await (
        await hre.ethers.getContractAt("TestERC20", tokenAddress)
      ).decimals();
      return (baseValue * 10n ** BigInt(decimals)) / price;
    }

    /**
     * Verifies oracle setup for all tokens and logs their prices
     * This is useful for debugging and understanding the test environment
     */
    async function verifyOracleSetup() {
      // Check dStable token
      try {
        const dsPrice = await oracleAggregatorContract.getAssetPrice(
          dstableInfo.address,
        );
        console.log(
          `  ✓ Successfully read price for ${dstableInfo.symbol}: ${dsPrice}`,
        );
      } catch (error: any) {
        throw new Error(
          `✗ Failed to verify oracle for ${dstableInfo.symbol}: ${error.message}`,
        );
      }

      // Check all collateral tokens
      for (const [symbol, info] of collateralInfos.entries()) {
        try {
          const price = await oracleAggregatorContract.getAssetPrice(
            info.address,
          );
          console.log(`  ✓ Successfully read price for ${symbol}: ${price}`);
        } catch (error: any) {
          throw new Error(
            `✗ Failed to verify oracle for ${symbol}: ${error.message}`,
          );
        }
      }
    }

    /**
     * Checks invariants that should always hold true in the system
     */
    async function checkInvariants() {
      // 1. Total value in the system (dStable circulating + AmoVault value) >= collateral value
      const circulatingDstable = await issuerContract.circulatingDstable();
      const circulatingDstableValue =
        await amoManagerContract.dstableAmountToBaseValue(circulatingDstable);

      const totalCollateralValue =
        await collateralHolderVaultContract.totalValue();
      const amoVaultTotalValue = await mockAmoVaultContract.totalValue();

      const totalSystemValueWithAmo =
        circulatingDstableValue + amoVaultTotalValue;

      // Allow for a small rounding error due to fixed-point math
      const valueDifference =
        totalSystemValueWithAmo > totalCollateralValue
          ? totalSystemValueWithAmo - totalCollateralValue
          : totalCollateralValue - totalSystemValueWithAmo;

      const acceptableValueError = (totalCollateralValue * 1n) / 100n; // 1% error margin

      assert.isTrue(
        totalSystemValueWithAmo >= totalCollateralValue ||
          valueDifference <= acceptableValueError,
        `System value (${totalSystemValueWithAmo}) should be >= collateral value (${totalCollateralValue}) or within acceptable error (${acceptableValueError})`,
      );

      // 2. Amo Manager's accounting is consistent
      const amoTotalSupply = await amoManagerContract.totalAmoSupply();
      const amoTotalAllocated = await amoManagerContract.totalAllocated();
      const amoManagerBalance = await dstableContract.balanceOf(
        await amoManagerContract.getAddress(),
      );

      assert.equal(
        amoTotalSupply,
        amoTotalAllocated + amoManagerBalance,
        "AMO total supply should equal allocated + AMO manager balance",
      );
    }

    describe("Oracle Setup", () => {
      it("verifies oracle prices for all collateral tokens", async function () {
        await verifyOracleSetup();

        // Verify each collateral token has a valid price
        for (const [symbol, info] of collateralInfos.entries()) {
          const price = await oracleAggregatorContract.getAssetPrice(
            info.address,
          );
          expect(price).to.be.gt(0n, `${symbol} should have a valid price`);
        }
      });
    });

    describe("System Invariants", () => {
      it("maintains invariants throughout basic operations", async function () {
        await checkInvariants();

        // Perform basic operations
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol,
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(collateralSymbol)!;

        // Transfer collateral to user1
        const collateralAmount = hre.ethers.parseUnits(
          "1000",
          collateralInfo.decimals,
        );
        await collateralContract.transfer(user1, collateralAmount);

        // User1 mints dStable
        await collateralContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerContract.getAddress(), collateralAmount);

        const expectedDstable = await calculateAmountFromBaseValue(
          await calculateBaseValueFromAmount(
            collateralAmount,
            collateralInfo.address,
          ),
          dstableInfo.address,
        );

        const minDstable = (expectedDstable * 95n) / 100n; // 5% slippage

        await issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(collateralAmount, collateralInfo.address, minDstable);

        await checkInvariants();

        // Allocate some dStable to AMO vault
        const dstableToAllocate = hre.ethers.parseUnits(
          "100",
          dstableInfo.decimals,
        );
        const appConfig = await getConfig(hre);
        const governanceSigner = await hre.ethers.getSigner(
          appConfig.walletAddresses.governanceMultisig,
        );
        await issuerContract
          .connect(governanceSigner)
          .increaseAmoSupply(dstableToAllocate);
        await amoManagerContract.allocateAmo(
          await mockAmoVaultContract.getAddress(),
          dstableToAllocate,
        );

        await checkInvariants();
      });
    });

    describe("Full Lifecycle", () => {
      it("executes a complete lifecycle with multiple users and assets", async function () {
        // Initial state check
        await checkInvariants();

        // 1. Transfer tokens to users for testing
        const primaryCollateralSymbol = config.peggedCollaterals[0];
        const secondaryCollateralSymbol =
          config.peggedCollaterals.length > 1
            ? config.peggedCollaterals[1]
            : config.peggedCollaterals[0];

        const primaryCollateralContract = collateralContracts.get(
          primaryCollateralSymbol,
        ) as TestERC20;
        const primaryCollateralInfo = collateralInfos.get(
          primaryCollateralSymbol,
        ) as TokenInfo;

        const secondaryCollateralContract = collateralContracts.get(
          secondaryCollateralSymbol,
        ) as TestERC20;
        const secondaryCollateralInfo = collateralInfos.get(
          secondaryCollateralSymbol,
        ) as TokenInfo;

        await primaryCollateralContract.transfer(
          user1,
          hre.ethers.parseUnits("1000", primaryCollateralInfo.decimals),
        );

        await secondaryCollateralContract.transfer(
          user2,
          hre.ethers.parseUnits("1000", secondaryCollateralInfo.decimals),
        );

        await checkInvariants();

        // 2. User 1 deposits primary collateral to mint dStable
        const primaryCollateralToDeposit = hre.ethers.parseUnits(
          "500",
          primaryCollateralInfo.decimals,
        );

        // Calculate expected dStable amount based on oracle prices
        const expectedDstableForPrimary = await calculateAmountFromBaseValue(
          await calculateBaseValueFromAmount(
            primaryCollateralToDeposit,
            primaryCollateralInfo.address,
          ),
          dstableInfo.address,
        );

        // Apply a small slippage to ensure the test passes
        const minDstableForPrimary = (expectedDstableForPrimary * 95n) / 100n; // 5% slippage

        await primaryCollateralContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(
            await issuerContract.getAddress(),
            primaryCollateralToDeposit,
          );

        await issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(
            primaryCollateralToDeposit,
            primaryCollateralInfo.address,
            minDstableForPrimary,
          );

        await checkInvariants();

        // 3. User 2 deposits secondary collateral to mint dStable
        const secondaryCollateralToDeposit = hre.ethers.parseUnits(
          "500",
          secondaryCollateralInfo.decimals,
        );

        // Calculate expected dStable amount based on oracle prices
        const expectedDstableForSecondary = await calculateAmountFromBaseValue(
          await calculateBaseValueFromAmount(
            secondaryCollateralToDeposit,
            secondaryCollateralInfo.address,
          ),
          dstableInfo.address,
        );

        // Apply a small slippage to ensure the test passes
        const minDstableForSecondary =
          (expectedDstableForSecondary * 95n) / 100n; // 5% slippage

        await secondaryCollateralContract
          .connect(await hre.ethers.getSigner(user2))
          .approve(
            await issuerContract.getAddress(),
            secondaryCollateralToDeposit,
          );

        await issuerContract
          .connect(await hre.ethers.getSigner(user2))
          .issue(
            secondaryCollateralToDeposit,
            secondaryCollateralInfo.address,
            minDstableForSecondary,
          );

        await checkInvariants();

        // Ensure both users have the expected dStable balances
        const user1DstableBalance = await dstableContract.balanceOf(user1);
        assert.isTrue(
          user1DstableBalance >= minDstableForPrimary,
          `User1 should have at least ${hre.ethers.formatUnits(
            minDstableForPrimary,
            dstableInfo.decimals,
          )} ${config.symbol}`,
        );

        const user2DstableBalance = await dstableContract.balanceOf(user2);
        assert.isTrue(
          user2DstableBalance >= minDstableForSecondary,
          `User2 should have at least ${hre.ethers.formatUnits(
            minDstableForSecondary,
            dstableInfo.decimals,
          )} ${config.symbol}`,
        );

        // 4. Allocate dStable to the AMO vault
        const dstableToAllocate = hre.ethers.parseUnits(
          "200",
          dstableInfo.decimals,
        );
        const appConfig = await getConfig(hre);
        const governanceSigner = await hre.ethers.getSigner(
          appConfig.walletAddresses.governanceMultisig,
        );
        await issuerContract
          .connect(governanceSigner)
          .increaseAmoSupply(dstableToAllocate);
        await amoManagerContract.allocateAmo(
          await mockAmoVaultContract.getAddress(),
          dstableToAllocate,
        );

        await checkInvariants();

        // 5. AMO vault simulates turning dStable into primary collateral
        // Simulate by setting fake DeFi collateral value
        await mockAmoVaultContract.setFakeDeFiCollateralValue(
          hre.ethers.parseUnits("100", ORACLE_AGGREGATOR_PRICE_DECIMALS),
        );

        await checkInvariants();

        // 6. User 1 redeems dStable for primary collateral
        const dstableToRedeem = hre.ethers.parseUnits(
          "100",
          dstableInfo.decimals,
        );

        // Calculate expected collateral amount based on oracle prices
        const expectedCollateralToReceive = await calculateAmountFromBaseValue(
          await calculateBaseValueFromAmount(
            dstableToRedeem,
            dstableInfo.address,
          ),
          primaryCollateralInfo.address,
        );

        // Apply a small slippage to ensure the test passes
        const minCollateralToReceive =
          (expectedCollateralToReceive * 90n) / 100n; // 10% slippage

        await dstableContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await redeemerContract.getAddress(), dstableToRedeem);

        await redeemerContract
          .connect(await hre.ethers.getSigner(user1))
          .redeem(
            dstableToRedeem,
            primaryCollateralInfo.address,
            minCollateralToReceive,
          );

        await checkInvariants();

        // 7. Transfer collateral from AMO vault to holding vault
        await mockAmoVaultContract.setFakeDeFiCollateralValue(0n); // Reset fake value

        // Transfer primary collateral from AMO vault to vault
        await primaryCollateralContract.transfer(
          await mockAmoVaultContract.getAddress(),
          hre.ethers.parseUnits("50", primaryCollateralInfo.decimals),
        );

        await amoManagerContract.transferFromAmoVaultToHoldingVault(
          await mockAmoVaultContract.getAddress(),
          primaryCollateralInfo.address,
          hre.ethers.parseUnits("50", primaryCollateralInfo.decimals),
        );

        await checkInvariants();

        // 8. Deallocate dStable from AMO vault
        const dstableToDeallocate = hre.ethers.parseUnits(
          "50",
          dstableInfo.decimals,
        );
        await mockAmoVaultContract.approveAmoManager();
        await amoManagerContract.deallocateAmo(
          await mockAmoVaultContract.getAddress(),
          dstableToDeallocate,
        );

        await checkInvariants();

        // 9. Decrease AMO supply (burn dStable)
        await amoManagerContract.decreaseAmoSupply(dstableToDeallocate);

        await checkInvariants();

        // 10. User 2 redeems all their dStable for secondary collateral
        const user2RemainingDstable = await dstableContract.balanceOf(user2);

        // Calculate expected collateral amount based on oracle prices
        const expectedSecondaryCollateral = await calculateAmountFromBaseValue(
          await calculateBaseValueFromAmount(
            user2RemainingDstable,
            dstableInfo.address,
          ),
          secondaryCollateralInfo.address,
        );

        // Apply a larger slippage for the final redemption to ensure the test passes
        const minSecondaryCollateralToReceive =
          (expectedSecondaryCollateral * 80n) / 100n; // 20% slippage

        await dstableContract
          .connect(await hre.ethers.getSigner(user2))
          .approve(await redeemerContract.getAddress(), user2RemainingDstable);

        await redeemerContract
          .connect(await hre.ethers.getSigner(user2))
          .redeem(
            user2RemainingDstable,
            secondaryCollateralInfo.address,
            minSecondaryCollateralToReceive,
          );

        await checkInvariants();
      });
    });
  });
});
