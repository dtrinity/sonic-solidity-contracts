import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  Issuer,
  TestMintableERC20,
  OracleAggregator,
} from "../../typechain-types";
import { TokenInfo } from "../../typescript/token/utils";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
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
  describe(`AmoManager for ${config.symbol}`, () => {
    let amoManagerContract: AmoManager;
    let issuerContract: Issuer;
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let oracleAggregatorContract: OracleAggregator;
    let deployer: Address;
    let user1: Address;
    let user2: Address;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      const amoManagerAddress = (await hre.deployments.get(config.amoManagerId))
        .address;
      amoManagerContract = await hre.ethers.getContractAt(
        "AmoManager",
        amoManagerAddress,
        await hre.ethers.getSigner(deployer)
      );

      const issuerAddress = (await hre.deployments.get(config.issuerContractId))
        .address;
      issuerContract = await hre.ethers.getContractAt(
        "Issuer",
        issuerAddress,
        await hre.ethers.getSigner(deployer)
      );

      ({ contract: dstableContract, tokenInfo: dstableInfo } =
        await getTokenContractForSymbol(
          hre,
          deployer,
          config.symbol as "dUSD" | "dS"
        ));

      // Get the oracle aggregator
      const oracleAggregatorAddress = (
        await hre.deployments.get(ORACLE_AGGREGATOR_ID)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer)
      );

      // Mint some dStable to the AmoManager for testing
      const initialAmoSupply = hre.ethers.parseUnits(
        "10000",
        dstableInfo.decimals
      );
      await issuerContract.increaseAmoSupply(initialAmoSupply);
    });

    /**
     * Calculates the expected base value of a token amount based on oracle prices
     * @param amount - The amount of token
     * @param tokenAddress - The address of the token
     * @returns The base value of the token amount
     */
    async function calculateBaseValueFromAmount(
      amount: bigint,
      tokenAddress: Address
    ): Promise<bigint> {
      const price = await oracleAggregatorContract.getAssetPrice(tokenAddress);
      const decimals = await (
        await hre.ethers.getContractAt("TestMintableERC20", tokenAddress)
      ).decimals();
      return (amount * price) / 10n ** BigInt(decimals);
    }

    /**
     * Calculates the expected token amount from a base value based on oracle prices
     * @param baseValue - The base value
     * @param tokenAddress - The address of the token
     * @returns The token amount equivalent to the base value
     */
    async function calculateAmountFromBaseValue(
      baseValue: bigint,
      tokenAddress: Address
    ): Promise<bigint> {
      const price = await oracleAggregatorContract.getAssetPrice(tokenAddress);
      const decimals = await (
        await hre.ethers.getContractAt("TestMintableERC20", tokenAddress)
      ).decimals();
      return (baseValue * 10n ** BigInt(decimals)) / price;
    }

    describe("AMO allocation", () => {
      it("allocates AMO tokens to an active vault", async function () {
        const amoVault = user1;
        const allocateAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals
        );

        // Enable the AMO vault
        await amoManagerContract.enableAmoVault(amoVault);

        const initialAmoSupply = await amoManagerContract.totalAmoSupply();
        const initialVaultBalance = await dstableContract.balanceOf(amoVault);

        await amoManagerContract.allocateAmo(amoVault, allocateAmount);

        const finalAmoSupply = await amoManagerContract.totalAmoSupply();
        const finalVaultBalance = await dstableContract.balanceOf(amoVault);

        assert.equal(
          finalAmoSupply.toString(),
          initialAmoSupply.toString(),
          "Total AMO supply should not change"
        );
        assert.equal(
          finalVaultBalance - initialVaultBalance,
          allocateAmount,
          "Vault balance should increase by allocated amount"
        );
      });

      it("cannot allocate to an inactive vault", async function () {
        const inactiveVault = user2;
        const allocateAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals
        );

        await expect(
          amoManagerContract.allocateAmo(inactiveVault, allocateAmount)
        ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");
      });

      it("cannot allocate more than unallocated supply", async function () {
        const amoVault = user1;
        // Enable the AMO vault
        await amoManagerContract.enableAmoVault(amoVault);

        // Get the total unallocated supply
        const totalAmoSupply = await amoManagerContract.totalAmoSupply();
        // Try to allocate more than the total
        const allocateAmount = totalAmoSupply + 1n;

        await expect(amoManagerContract.allocateAmo(amoVault, allocateAmount))
          .to.be.reverted; // Expect any revert, not a specific custom error
      });
    });

    describe("AMO deallocation", () => {
      let amoVault: Address;
      let allocateAmount: bigint;

      beforeEach(async function () {
        amoVault = user1;
        allocateAmount = hre.ethers.parseUnits("1000", dstableInfo.decimals);

        // Enable the AMO vault and allocate tokens
        await amoManagerContract.enableAmoVault(amoVault);
        await amoManagerContract.allocateAmo(amoVault, allocateAmount);
      });

      it("deallocates AMO tokens from an active vault", async function () {
        const deallocateAmount = allocateAmount; // Deallocate all

        // Approve the AMO Manager to transfer tokens from the vault
        await dstableContract
          .connect(await hre.ethers.getSigner(amoVault))
          .approve(await amoManagerContract.getAddress(), deallocateAmount);

        const initialVaultBalance = await dstableContract.balanceOf(amoVault);
        const initialAmoManagerBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress()
        );

        await amoManagerContract.deallocateAmo(amoVault, deallocateAmount);

        const finalVaultBalance = await dstableContract.balanceOf(amoVault);
        const finalAmoManagerBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress()
        );

        assert.equal(
          initialVaultBalance - finalVaultBalance,
          deallocateAmount,
          "Vault balance should decrease by deallocated amount"
        );
        assert.equal(
          finalAmoManagerBalance - initialAmoManagerBalance,
          deallocateAmount,
          "AMO Manager balance should increase by deallocated amount"
        );
      });

      it("cannot deallocate more than allocated to vault", async function () {
        const deallocateAmount = allocateAmount + 1n; // More than allocated

        // Approve the AMO Manager to transfer tokens from the vault
        await dstableContract
          .connect(await hre.ethers.getSigner(amoVault))
          .approve(await amoManagerContract.getAddress(), deallocateAmount);

        await expect(
          amoManagerContract.deallocateAmo(amoVault, deallocateAmount)
        ).to.be.reverted; // Expect any revert, not a specific custom error
      });
    });

    describe("AMO vault management", () => {
      it("enables an AMO vault", async function () {
        const vault = user1;

        // Check if vault is initially inactive
        await expect(
          amoManagerContract.allocateAmo(vault, 1n)
        ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");

        await amoManagerContract.enableAmoVault(vault);

        // Should be able to allocate to the vault now
        const allocateAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        await amoManagerContract.allocateAmo(vault, allocateAmount);

        const vaultBalance = await dstableContract.balanceOf(vault);
        assert.equal(
          vaultBalance,
          allocateAmount,
          "Vault should receive allocated tokens after enabling"
        );
      });

      it("disables an AMO vault", async function () {
        const vault = user1;

        // First enable the vault
        await amoManagerContract.enableAmoVault(vault);

        // Should be able to allocate to the vault
        const allocateAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        await amoManagerContract.allocateAmo(vault, allocateAmount);

        // Now disable the vault
        await amoManagerContract.disableAmoVault(vault);

        // Try to allocate more to the disabled vault
        await expect(
          amoManagerContract.allocateAmo(vault, allocateAmount)
        ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");
      });
    });

    describe("AMO supply management", () => {
      it("decreases AMO supply by burning dStable", async function () {
        const burnAmount = hre.ethers.parseUnits("1000", dstableInfo.decimals);

        const initialAmoSupply = await amoManagerContract.totalAmoSupply();
        const initialTotalSupply = await dstableContract.totalSupply();

        await amoManagerContract.decreaseAmoSupply(burnAmount);

        const finalAmoSupply = await amoManagerContract.totalAmoSupply();
        const finalTotalSupply = await dstableContract.totalSupply();

        assert.equal(
          initialAmoSupply - finalAmoSupply,
          burnAmount,
          "AMO supply should decrease by burn amount"
        );
        assert.equal(
          initialTotalSupply - finalTotalSupply,
          burnAmount,
          "dStable total supply should decrease by burn amount"
        );
      });
    });

    describe("Base value conversion", () => {
      it("converts base value to dStable amount correctly", async function () {
        const baseValue = hre.ethers.parseUnits("1000", 8); // 8 decimals for base value

        // Calculate expected dStable amount using oracle prices
        const expectedDstableAmount = await calculateAmountFromBaseValue(
          baseValue,
          dstableInfo.address
        );

        const actualDstableAmount =
          await amoManagerContract.baseValueToDstableAmount(baseValue);

        // Allow for a small rounding error due to fixed-point math
        const difference =
          actualDstableAmount > expectedDstableAmount
            ? actualDstableAmount - expectedDstableAmount
            : expectedDstableAmount - actualDstableAmount;

        const acceptableError = (expectedDstableAmount * 1n) / 100n; // 1% error margin

        assert.isTrue(
          difference <= acceptableError,
          `dStable amount difference (${difference}) exceeds acceptable error (${acceptableError}). Expected: ${expectedDstableAmount}, Actual: ${actualDstableAmount}`
        );
      });

      it("converts dStable amount to base value correctly", async function () {
        const dstableAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals
        );

        // Calculate expected base value using oracle prices
        const expectedBaseValue = await calculateBaseValueFromAmount(
          dstableAmount,
          dstableInfo.address
        );

        const actualBaseValue =
          await amoManagerContract.dstableAmountToBaseValue(dstableAmount);

        // Allow for a small rounding error due to fixed-point math
        const difference =
          actualBaseValue > expectedBaseValue
            ? actualBaseValue - expectedBaseValue
            : expectedBaseValue - actualBaseValue;

        const acceptableError = (expectedBaseValue * 1n) / 100n; // 1% error margin

        assert.isTrue(
          difference <= acceptableError,
          `Base value difference (${difference}) exceeds acceptable error (${acceptableError}). Expected: ${expectedBaseValue}, Actual: ${actualBaseValue}`
        );
      });
    });
  });
});
