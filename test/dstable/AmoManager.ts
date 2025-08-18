import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  AmoManager,
  CollateralVault,
  IssuerV2,
  MockAmoVault,
  OracleAggregator,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
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

describe("AmoManager", () => {
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  before(async () => {
    ({ deployer, user1, user2 } = await getNamedAccounts());
  });

  // Run tests for each dStable configuration
  dstableConfigs.forEach((config) => {
    runTestsForDStable(config, { deployer, user1, user2 });
  });
});

/**
 *
 * @param config
 * @param root0
 * @param root0.deployer
 * @param root0.user1
 * @param root0.user2
 */
async function runTestsForDStable(
  config: DStableFixtureConfig,
  {
    deployer,
    user1,
    user2,
  }: { deployer: Address; user1: Address; user2: Address },
) {
  describe(`AmoManager for ${config.symbol}`, () => {
    let amoManagerContract: AmoManager;
    let issuerContract: IssuerV2;
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let oracleAggregatorContract: OracleAggregator;
    let collateralVaultContract: CollateralVault;
    let mockAmoVault: MockAmoVault;
    let amoAllocatorRole: string;
    let feeCollectorRole: string;
    let defaultAdminRole: string;
    let mockCollateralTokens: Map<string, TestERC20 | TestMintableERC20>;
    let mockCollateralInfos: Map<string, TokenInfo>;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableAmoFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      const amoManagerAddress = (await hre.deployments.get(config.amoManagerId))
        .address;
      amoManagerContract = await hre.ethers.getContractAt(
        "AmoManager",
        amoManagerAddress,
        await hre.ethers.getSigner(deployer),
      );

      const issuerAddress = (await hre.deployments.get(config.issuerContractId))
        .address;
      issuerContract = await hre.ethers.getContractAt(
        "IssuerV2",
        issuerAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get dStable contract using symbol - we know this is always TestMintableERC20
      ({ contract: dstableContract, tokenInfo: dstableInfo } =
        await getTokenContractForSymbol(hre, deployer, config.symbol));

      // Get the oracle aggregator based on the dStable configuration
      const oracleAggregatorAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the deployed MockAmoVault
      const mockAmoVaultAddress = (await hre.deployments.get("MockAmoVault"))
        .address;
      mockAmoVault = await hre.ethers.getContractAt(
        "MockAmoVault",
        mockAmoVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the collateral vault
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralVault",
        await amoManagerContract.collateralHolderVault(),
        await hre.ethers.getSigner(deployer),
      );

      // Get roles
      amoAllocatorRole = await amoManagerContract.AMO_ALLOCATOR_ROLE();
      feeCollectorRole = await amoManagerContract.FEE_COLLECTOR_ROLE();
      defaultAdminRole = await amoManagerContract.DEFAULT_ADMIN_ROLE();

      // Initialize mock collateral tokens based on dStable type
      mockCollateralTokens = new Map();
      mockCollateralInfos = new Map();

      // Get the network config to access mock token info
      const networkConfig = await getConfig(hre);

      // Get collateral list from config
      const collateralAddresses =
        networkConfig.dStables[config.symbol].collaterals;

      // Get the first non-zero collateral address
      const firstCollateralAddress = collateralAddresses.find(
        (addr) => addr !== hre.ethers.ZeroAddress,
      );

      if (!firstCollateralAddress) {
        throw new Error("No valid collateral address found");
      }

      // Get the token contract and info directly using the address
      const { contract, tokenInfo } = await getTokenContractForAddress(
        hre,
        deployer,
        firstCollateralAddress,
      );

      mockCollateralTokens.set(tokenInfo.symbol, contract);
      mockCollateralInfos.set(tokenInfo.symbol, tokenInfo);

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

      // Ensure the MockAmoVault has the necessary roles
      const collateralWithdrawerRole =
        await mockAmoVault.COLLATERAL_WITHDRAWER_ROLE();

      if (
        !(await mockAmoVault.hasRole(
          collateralWithdrawerRole,
          amoManagerAddress,
        ))
      ) {
        await mockAmoVault.grantRole(
          collateralWithdrawerRole,
          amoManagerAddress,
        );
      }

      // Grant necessary roles to AmoManager for collateral management
      if (
        !(await collateralVaultContract.hasRole(
          collateralWithdrawerRole,
          await amoManagerContract.getAddress(),
        ))
      ) {
        await collateralVaultContract.grantRole(
          collateralWithdrawerRole,
          await amoManagerContract.getAddress(),
        );
      }

      // Ensure vault is in correct state at start
      const amoVault = await mockAmoVault.getAddress();
      await ensureVaultDisabled(amoVault);

      // Allow collateral in the MockAmoVault
      await mockAmoVault.allowCollateral(await contract.getAddress());
    });

    // Helper function to ensure vault is disabled
    /**
     *
     * @param vault
     */
    async function ensureVaultDisabled(vault: Address) {
      if (await amoManagerContract.isAmoActive(vault)) {
        await amoManagerContract.disableAmoVault(vault);
      }
    }

    // Helper function to ensure vault is enabled
    /**
     *
     * @param vault
     */
    async function ensureVaultEnabled(vault: Address) {
      if (!(await amoManagerContract.isAmoActive(vault))) {
        await amoManagerContract.enableAmoVault(vault);
      }
    }

    describe("Role-based access control", () => {
      it("should have correct role assignments after deployment", async function () {
        expect(await amoManagerContract.hasRole(defaultAdminRole, deployer)).to
          .be.true;
        expect(await amoManagerContract.hasRole(amoAllocatorRole, deployer)).to
          .be.true;
        expect(await amoManagerContract.hasRole(feeCollectorRole, deployer)).to
          .be.true;
      });

      it("should prevent unauthorized users from accessing restricted functions", async function () {
        const unauthorizedSigner = await hre.ethers.getSigner(user2);
        const amount = hre.ethers.parseUnits("100", dstableInfo.decimals);

        await expect(
          amoManagerContract
            .connect(unauthorizedSigner)
            .allocateAmo(await mockAmoVault.getAddress(), amount),
        ).to.be.revertedWithCustomError(
          amoManagerContract,
          "AccessControlUnauthorizedAccount",
        );
      });
    });

    describe("AMO allocation", () => {
      it("allocates AMO tokens to an active vault", async function () {
        const amoVault = await mockAmoVault.getAddress();
        const allocateAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );

        await ensureVaultEnabled(amoVault);

        const initialAmoSupply = await amoManagerContract.totalAmoSupply();
        const initialVaultBalance = await dstableContract.balanceOf(amoVault);

        await amoManagerContract.allocateAmo(amoVault, allocateAmount);

        const finalAmoSupply = await amoManagerContract.totalAmoSupply();
        const finalVaultBalance = await dstableContract.balanceOf(amoVault);

        assert.equal(
          finalAmoSupply.toString(),
          initialAmoSupply.toString(),
          "Total AMO supply should not change",
        );
        assert.equal(
          finalVaultBalance - initialVaultBalance,
          allocateAmount,
          "Vault balance should increase by allocated amount",
        );
      });

      it("cannot allocate to an inactive vault", async function () {
        const inactiveVault = await mockAmoVault.getAddress();
        const allocateAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );

        await ensureVaultDisabled(inactiveVault);

        await expect(
          amoManagerContract.allocateAmo(inactiveVault, allocateAmount),
        ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");
      });

      it("cannot allocate more than unallocated supply", async function () {
        const amoVault = await mockAmoVault.getAddress();
        await ensureVaultEnabled(amoVault);

        // Get the total unallocated supply
        const totalAmoSupply = await amoManagerContract.totalAmoSupply();
        // Try to allocate more than the total
        const allocateAmount = totalAmoSupply + 1n;

        await expect(amoManagerContract.allocateAmo(amoVault, allocateAmount))
          .to.be.reverted;
      });
    });

    describe("AMO deallocation", () => {
      let amoVault: Address;
      let allocateAmount: bigint;

      beforeEach(async function () {
        amoVault = await mockAmoVault.getAddress();
        allocateAmount = hre.ethers.parseUnits("1000", dstableInfo.decimals);

        await ensureVaultEnabled(amoVault);
        await amoManagerContract.allocateAmo(amoVault, allocateAmount);
      });

      it("deallocates AMO tokens from an active vault", async function () {
        const deallocateAmount = allocateAmount; // Deallocate all

        // Impersonate the AMO vault
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [amoVault],
        });

        // Fund the AMO vault with some ETH for gas
        await hre.network.provider.send("hardhat_setBalance", [
          amoVault,
          "0x1000000000000000000",
        ]);

        // Get the impersonated signer
        const amoVaultSigner = await hre.ethers.getSigner(amoVault);

        // Approve the AMO Manager to transfer tokens from the vault
        await dstableContract
          .connect(amoVaultSigner)
          .approve(await amoManagerContract.getAddress(), deallocateAmount);

        const initialVaultBalance = await dstableContract.balanceOf(amoVault);
        const initialAmoManagerBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress(),
        );

        await amoManagerContract.deallocateAmo(amoVault, deallocateAmount);

        const finalVaultBalance = await dstableContract.balanceOf(amoVault);
        const finalAmoManagerBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress(),
        );

        // Stop impersonating
        await hre.network.provider.request({
          method: "hardhat_stopImpersonatingAccount",
          params: [amoVault],
        });

        assert.equal(
          initialVaultBalance - finalVaultBalance,
          deallocateAmount,
          "Vault balance should decrease by deallocated amount",
        );
        assert.equal(
          finalAmoManagerBalance - initialAmoManagerBalance,
          deallocateAmount,
          "AMO Manager balance should increase by deallocated amount",
        );
      });

      it("cannot deallocate more than allocated to vault", async function () {
        const deallocateAmount = allocateAmount + 1n; // More than allocated

        // Impersonate the AMO vault
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [amoVault],
        });

        // Fund the AMO vault with some ETH for gas
        await hre.network.provider.send("hardhat_setBalance", [
          amoVault,
          "0x1000000000000000000",
        ]);

        // Get the impersonated signer
        const amoVaultSigner = await hre.ethers.getSigner(amoVault);

        // Approve the AMO Manager to transfer tokens from the vault
        await dstableContract
          .connect(amoVaultSigner)
          .approve(await amoManagerContract.getAddress(), deallocateAmount);

        await expect(
          amoManagerContract.deallocateAmo(amoVault, deallocateAmount),
        ).to.be.revertedWithCustomError(
          amoManagerContract,
          "InsufficientAllocation",
        );

        // Stop impersonating
        await hre.network.provider.request({
          method: "hardhat_stopImpersonatingAccount",
          params: [amoVault],
        });
      });
    });

    describe("AMO vault management", () => {
      it("enables an AMO vault", async function () {
        const vault = await mockAmoVault.getAddress();
        await ensureVaultDisabled(vault);

        // Check if vault is initially inactive
        await expect(
          amoManagerContract.allocateAmo(vault, 1n),
        ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");

        await amoManagerContract.enableAmoVault(vault);

        // Should be able to allocate to the vault now
        const allocateAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        await amoManagerContract.allocateAmo(vault, allocateAmount);

        const vaultBalance = await dstableContract.balanceOf(vault);
        assert.equal(
          vaultBalance,
          allocateAmount,
          "Vault should receive allocated tokens after enabling",
        );
      });

      it("disables an AMO vault", async function () {
        const vault = await mockAmoVault.getAddress();
        await ensureVaultEnabled(vault);

        // Should be able to allocate to the vault
        const allocateAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        await amoManagerContract.allocateAmo(vault, allocateAmount);

        // Now disable the vault
        await amoManagerContract.disableAmoVault(vault);

        // Try to allocate more to the disabled vault
        await expect(
          amoManagerContract.allocateAmo(vault, allocateAmount),
        ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");
      });

      it("cannot enable an already enabled vault", async function () {
        const vault = await mockAmoVault.getAddress();
        await ensureVaultEnabled(vault);

        await expect(
          amoManagerContract.enableAmoVault(vault),
        ).to.be.revertedWithCustomError(
          amoManagerContract,
          "AmoVaultAlreadyEnabled",
        );
      });

      it("cannot disable an already disabled vault", async function () {
        const vault = await mockAmoVault.getAddress();
        await ensureVaultDisabled(vault);

        await expect(
          amoManagerContract.disableAmoVault(vault),
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
          "AMO supply should decrease by burn amount",
        );
        assert.equal(
          initialTotalSupply - finalTotalSupply,
          burnAmount,
          "dStable total supply should decrease by burn amount",
        );
      });

      it("cannot decrease AMO supply more than available", async function () {
        const totalAmoSupply = await amoManagerContract.totalAmoSupply();
        const burnAmount = totalAmoSupply + 1n;

        await expect(amoManagerContract.decreaseAmoSupply(burnAmount)).to.be
          .reverted;
      });
    });

    describe("Collateral Management", () => {
      let testCollateralToken: TestERC20;
      let testCollateralInfo: TokenInfo;

      beforeEach(async function () {
        // Get the network config to access mock token info
        const networkConfig = await getConfig(hre);

        // Get collateral list from config
        const collateralAddresses =
          networkConfig.dStables[config.symbol].collaterals;

        // Get the first non-zero collateral address
        const firstCollateralAddress = collateralAddresses.find(
          (addr) => addr !== hre.ethers.ZeroAddress,
        );

        if (!firstCollateralAddress) {
          throw new Error("No valid collateral address found");
        }

        // Get the token contract and info directly using the address
        const { contract, tokenInfo } = await getTokenContractForAddress(
          hre,
          deployer,
          firstCollateralAddress,
        );

        testCollateralInfo = tokenInfo;
        testCollateralToken = contract;

        // Ensure the token is initialized
        if (!testCollateralToken || !testCollateralInfo) {
          throw new Error("Failed to initialize test collateral token");
        }

        // Ensure vault is in correct state at start
        const amoVault = await mockAmoVault.getAddress();
        await ensureVaultDisabled(amoVault);
      });

      it("transfers collateral from AMO vault to holding vault", async function () {
        const amoVault = await mockAmoVault.getAddress();
        const collateralAmount = hre.ethers.parseUnits(
          "100",
          testCollateralInfo.decimals,
        );

        await ensureVaultEnabled(amoVault);

        // Transfer collateral to the AMO vault from deployer
        await testCollateralToken.transfer(amoVault, collateralAmount);

        const initialHoldingVaultBalance = await testCollateralToken.balanceOf(
          await collateralVaultContract.getAddress(),
        );

        await amoManagerContract.transferFromAmoVaultToHoldingVault(
          amoVault,
          await testCollateralToken.getAddress(),
          collateralAmount,
        );

        const finalHoldingVaultBalance = await testCollateralToken.balanceOf(
          await collateralVaultContract.getAddress(),
        );

        expect(finalHoldingVaultBalance - initialHoldingVaultBalance).to.equal(
          collateralAmount,
        );
      });

      it("transfers collateral from holding vault to AMO vault", async function () {
        const amoVault = await mockAmoVault.getAddress();
        const collateralAmount = hre.ethers.parseUnits(
          "100",
          testCollateralInfo.decimals,
        );

        await ensureVaultEnabled(amoVault);

        // Transfer collateral to the holding vault
        await testCollateralToken.transfer(
          await collateralVaultContract.getAddress(),
          collateralAmount,
        );

        const initialAmoVaultBalance =
          await testCollateralToken.balanceOf(amoVault);

        await amoManagerContract.transferFromHoldingVaultToAmoVault(
          amoVault,
          await testCollateralToken.getAddress(),
          collateralAmount,
        );

        const finalAmoVaultBalance =
          await testCollateralToken.balanceOf(amoVault);

        expect(finalAmoVaultBalance - initialAmoVaultBalance).to.equal(
          collateralAmount,
        );
      });

      it("cannot transfer dStable as collateral", async function () {
        const amoVault = await mockAmoVault.getAddress();
        const amount = hre.ethers.parseUnits("100", dstableInfo.decimals);

        await expect(
          amoManagerContract.transferFromAmoVaultToHoldingVault(
            amoVault,
            await dstableContract.getAddress(),
            amount,
          ),
        ).to.be.revertedWithCustomError(
          amoManagerContract,
          "CannotTransferDStable",
        );

        await expect(
          amoManagerContract.transferFromHoldingVaultToAmoVault(
            amoVault,
            await dstableContract.getAddress(),
            amount,
          ),
        ).to.be.revertedWithCustomError(
          amoManagerContract,
          "CannotTransferDStable",
        );
      });

      it("does not reactivate a disabled vault when transferring collateral", async function () {
        const amoVault = await mockAmoVault.getAddress();

        const collateralAmount = hre.ethers.parseUnits(
          "50",
          testCollateralInfo.decimals,
        );

        // Ensure vault starts enabled so we can move some collateral into it
        await ensureVaultEnabled(amoVault);

        // Transfer collateral into the AMO vault directly (simulate profits / balances)
        await testCollateralToken.transfer(amoVault, collateralAmount);

        // Disable the vault
        await amoManagerContract.disableAmoVault(amoVault);
        expect(await amoManagerContract.isAmoActive(amoVault)).to.be.false;

        // Record holding vault balance before withdrawal
        const initialHoldingBalance = await testCollateralToken.balanceOf(
          await collateralVaultContract.getAddress(),
        );

        // Withdraw collateral from the (now inactive) vault
        await amoManagerContract.transferFromAmoVaultToHoldingVault(
          amoVault,
          await testCollateralToken.getAddress(),
          collateralAmount,
        );

        // Check vault remains inactive
        expect(await amoManagerContract.isAmoActive(amoVault)).to.be.false;

        // Check collateral landed in the holding vault
        const finalHoldingBalance = await testCollateralToken.balanceOf(
          await collateralVaultContract.getAddress(),
        );
        expect(finalHoldingBalance - initialHoldingBalance).to.equal(
          collateralAmount,
        );

        // Verify that attempting to allocate to this vault now reverts
        await expect(
          amoManagerContract.allocateAmo(
            amoVault,
            hre.ethers.parseUnits("10", dstableInfo.decimals),
          ),
        ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");
      });

      it("emits AllocationSurplus when collateral value exceeds allocation", async function () {
        const amoVault = await mockAmoVault.getAddress();

        // Enable the vault but do NOT allocate any dStable so currentAllocation = 0
        await ensureVaultEnabled(amoVault);

        const collateralAmount = hre.ethers.parseUnits(
          "25",
          testCollateralInfo.decimals,
        );

        // Transfer collateral to the AMO vault from deployer (simulate profit)
        await testCollateralToken.transfer(amoVault, collateralAmount);

        // Compute expected surplus in dStable equivalent
        const collateralBaseValue =
          await collateralVaultContract.assetValueFromAmount(
            collateralAmount,
            await testCollateralToken.getAddress(),
          );
        const collateralInDstable =
          await amoManagerContract.baseValueToDstableAmount(
            collateralBaseValue,
          );

        await expect(
          amoManagerContract.transferFromAmoVaultToHoldingVault(
            amoVault,
            await testCollateralToken.getAddress(),
            collateralAmount,
          ),
        )
          .to.emit(amoManagerContract, "AllocationSurplus")
          .withArgs(amoVault, collateralInDstable);
      });
    });

    describe("Profit Management", () => {
      let testCollateralToken: TestERC20;
      let testCollateralInfo: TokenInfo;

      beforeEach(async function () {
        // Get the network config to access mock token info
        const networkConfig = await getConfig(hre);

        // Get collateral list from config
        const collateralAddresses =
          networkConfig.dStables[config.symbol].collaterals;

        // Get the first non-zero collateral address
        const firstCollateralAddress = collateralAddresses.find(
          (addr) => addr !== hre.ethers.ZeroAddress,
        );

        if (!firstCollateralAddress) {
          throw new Error("No valid collateral address found");
        }

        // Get the token contract and info directly using the address
        const { contract, tokenInfo } = await getTokenContractForAddress(
          hre,
          deployer,
          firstCollateralAddress,
        );

        testCollateralInfo = tokenInfo;
        testCollateralToken = contract;

        // Ensure the token is initialized
        if (!testCollateralToken || !testCollateralInfo) {
          throw new Error("Failed to initialize test collateral token");
        }

        // Ensure vault is in correct state at start
        const amoVault = await mockAmoVault.getAddress();
        await ensureVaultDisabled(amoVault);
      });

      it("calculates available vault profits correctly", async function () {
        const amoVault = await mockAmoVault.getAddress();
        const allocateAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );

        // Enable and allocate to the vault
        await ensureVaultEnabled(amoVault);
        await amoManagerContract.allocateAmo(amoVault, allocateAmount);

        // Add some profit to the vault (through collateral)
        const profitAmount = hre.ethers.parseUnits(
          "100",
          testCollateralInfo.decimals,
        );
        await testCollateralToken.transfer(amoVault, profitAmount);

        const availableProfit =
          await amoManagerContract.availableVaultProfitsInBase(amoVault);

        expect(availableProfit).to.be.gt(0);
      });

      it("withdraws profits from AMO vault", async function () {
        const amoVault = await mockAmoVault.getAddress();
        const recipient = user1;

        // First allocate some dStable to establish a baseline
        const allocateAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );

        // Enable vault and allocate dStable
        await ensureVaultEnabled(amoVault);
        await amoManagerContract.allocateAmo(amoVault, allocateAmount);

        // Add profit through collateral
        const profitAmount = hre.ethers.parseUnits(
          "100",
          testCollateralInfo.decimals,
        );
        await testCollateralToken.transfer(amoVault, profitAmount);

        const initialRecipientBalance =
          await testCollateralToken.balanceOf(recipient);

        // Try to withdraw profits
        await amoManagerContract.withdrawProfits(
          mockAmoVault,
          recipient,
          await testCollateralToken.getAddress(),
          profitAmount,
        );

        const finalRecipientBalance =
          await testCollateralToken.balanceOf(recipient);

        expect(finalRecipientBalance - initialRecipientBalance).to.equal(
          profitAmount,
        );
      });

      it("cannot withdraw more than available profits", async function () {
        const amoVault = await mockAmoVault.getAddress();
        const recipient = user1;

        // First allocate some dStable to establish a baseline
        const allocateAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );

        // Enable vault and allocate dStable
        await ensureVaultEnabled(amoVault);
        await amoManagerContract.allocateAmo(amoVault, allocateAmount);

        const availableAmount = hre.ethers.parseUnits(
          "100",
          testCollateralInfo.decimals,
        );
        const withdrawAmount = availableAmount + 1n;

        // Add some collateral as profit
        await testCollateralToken.transfer(amoVault, availableAmount);

        await expect(
          amoManagerContract.withdrawProfits(
            mockAmoVault,
            recipient,
            await testCollateralToken.getAddress(),
            withdrawAmount,
          ),
        ).to.be.revertedWithCustomError(
          amoManagerContract,
          "InsufficientProfits",
        );
      });
    });

    describe("Base value conversion", () => {
      it("converts base value to dStable amount correctly", async function () {
        const baseValue = hre.ethers.parseUnits("1000", 8); // 8 decimals for base value
        const dstableAmount =
          await amoManagerContract.baseValueToDstableAmount(baseValue);

        // Convert back to base value
        const convertedBaseValue =
          await amoManagerContract.dstableAmountToBaseValue(dstableAmount);

        // Allow for small rounding errors
        const difference =
          convertedBaseValue > baseValue
            ? convertedBaseValue - baseValue
            : baseValue - convertedBaseValue;
        const acceptableError = (baseValue * 1n) / 100n; // 1% error margin

        expect(difference).to.be.lte(
          acceptableError,
          "Base value conversion should be within acceptable error margin",
        );
      });

      it("converts dStable amount to base value correctly", async function () {
        const dstableAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals,
        );
        const baseValue =
          await amoManagerContract.dstableAmountToBaseValue(dstableAmount);

        // Convert back to dStable amount
        const convertedDstableAmount =
          await amoManagerContract.baseValueToDstableAmount(baseValue);

        // Allow for small rounding errors
        const difference =
          convertedDstableAmount > dstableAmount
            ? convertedDstableAmount - dstableAmount
            : dstableAmount - convertedDstableAmount;
        const acceptableError = (dstableAmount * 1n) / 100n; // 1% error margin

        expect(difference).to.be.lte(
          acceptableError,
          "dStable amount conversion should be within acceptable error margin",
        );
      });
    });

    describe("Admin functions", () => {
      it("allows admin to set collateral vault", async function () {
        const newCollateralVault = user1;

        await amoManagerContract.setCollateralVault(newCollateralVault);

        expect(await amoManagerContract.collateralHolderVault()).to.equal(
          newCollateralVault,
        );
      });

      it("prevents non-admin from setting collateral vault", async function () {
        const newCollateralVault = user1;
        const nonAdmin = await hre.ethers.getSigner(user2);

        await expect(
          amoManagerContract
            .connect(nonAdmin)
            .setCollateralVault(newCollateralVault),
        ).to.be.revertedWithCustomError(
          amoManagerContract,
          "AccessControlUnauthorizedAccount",
        );
      });
    });

    describe("AmoVault manager allowance", () => {
      it("revokes the old manager allowance and grants it to the new one", async function () {
        const amoVaultAddress = await mockAmoVault.getAddress();

        // Old manager is the initially deployed AmoManager contract
        const oldManagerAddress = await amoManagerContract.getAddress();
        const newManagerAddress = user1;

        const maxUint = hre.ethers.MaxUint256;

        // Initial allowance should be max for the old manager
        expect(
          await dstableContract.allowance(amoVaultAddress, oldManagerAddress),
        ).to.equal(maxUint);

        // Change the manager on the vault
        await mockAmoVault.setAmoManager(newManagerAddress);

        // Old manager's allowance should now be zero
        expect(
          await dstableContract.allowance(amoVaultAddress, oldManagerAddress),
        ).to.equal(0n);

        // New manager should have max allowance
        expect(
          await dstableContract.allowance(amoVaultAddress, newManagerAddress),
        ).to.equal(maxUint);
      });

      it("allows admin to set a custom allowance for the current manager", async function () {
        const amoVaultAddress = await mockAmoVault.getAddress();
        const managerAddress = await amoManagerContract.getAddress();

        const customAllowance = hre.ethers.parseUnits(
          "5000",
          dstableInfo.decimals,
        );

        // Update allowance to custom amount (cast to any to avoid type issues before TypeChain re-generation)
        await (mockAmoVault as any).setAmoManagerApproval(customAllowance);

        expect(
          await dstableContract.allowance(amoVaultAddress, managerAddress),
        ).to.equal(customAllowance);
      });
    });
  });
}
