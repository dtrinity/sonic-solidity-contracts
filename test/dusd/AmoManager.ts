import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  Issuer,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import { TokenInfo } from "../../typescript/token/utils";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { standaloneMinimalFixture } from "./fixtures";
import {
  DUSD_AMO_MANAGER_ID,
  DUSD_ISSUER_CONTRACT_ID,
} from "../../typescript/deploy-ids";

describe("AmoManager", () => {
  let amoManagerContract: AmoManager;
  let issuerContract: Issuer;
  let dstableContract: TestMintableERC20;
  let dstableInfo: TokenInfo;
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  beforeEach(async function () {
    await standaloneMinimalFixture();

    ({ deployer, user1, user2 } = await getNamedAccounts());

    const amoManagerAddress = (await hre.deployments.get(DUSD_AMO_MANAGER_ID))
      .address;
    amoManagerContract = await hre.ethers.getContractAt(
      "AmoManager",
      amoManagerAddress,
      await hre.ethers.getSigner(deployer)
    );

    const issuerAddress = (await hre.deployments.get(DUSD_ISSUER_CONTRACT_ID))
      .address;
    issuerContract = await hre.ethers.getContractAt(
      "Issuer",
      issuerAddress,
      await hre.ethers.getSigner(deployer)
    );

    ({ contract: dstableContract, tokenInfo: dstableInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));

    // Mint some dStable to the AmoManager for testing
    const initialAmoSupply = hre.ethers.parseUnits(
      "10000",
      dstableInfo.decimals
    );
    await issuerContract.increaseAmoSupply(initialAmoSupply);
  });

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
  });

  describe("AMO deallocation", () => {
    it("deallocates AMO tokens from an active vault", async function () {
      const amoVault = user1;
      const allocateAmount = hre.ethers.parseUnits(
        "1000",
        dstableInfo.decimals
      );
      const deallocateAmount = hre.ethers.parseUnits(
        "500",
        dstableInfo.decimals
      );

      // Enable the AMO vault
      await amoManagerContract.enableAmoVault(amoVault);

      // Allocate tokens to the vault
      await amoManagerContract.allocateAmo(amoVault, allocateAmount);

      // Approve AmoManager to spend dStable on behalf of the vault
      await dstableContract
        .connect(await hre.ethers.getSigner(user1))
        .approve(
          await amoManagerContract.getAddress(),
          hre.ethers.parseUnits("1000", dstableInfo.decimals)
        );

      const initialAmoSupply = await amoManagerContract.totalAmoSupply();
      const initialVaultBalance = await dstableContract.balanceOf(amoVault);
      const initialManagerBalance = await dstableContract.balanceOf(
        await amoManagerContract.getAddress()
      );

      await amoManagerContract.deallocateAmo(amoVault, deallocateAmount);

      const finalAmoSupply = await amoManagerContract.totalAmoSupply();
      const finalVaultBalance = await dstableContract.balanceOf(amoVault);
      const finalManagerBalance = await dstableContract.balanceOf(
        await amoManagerContract.getAddress()
      );

      assert.equal(
        finalAmoSupply.toString(),
        initialAmoSupply.toString(),
        "Total AMO supply should not change"
      );
      assert.equal(
        initialVaultBalance - finalVaultBalance,
        deallocateAmount,
        "Vault balance should decrease by deallocated amount"
      );
      assert.equal(
        finalManagerBalance - initialManagerBalance,
        deallocateAmount,
        "Manager balance should increase by deallocated amount"
      );
    });
  });

  describe("AMO vault management", () => {
    it("enables and disables AMO vaults", async function () {
      const amoVault = user1;

      // Enable the vault
      await amoManagerContract.enableAmoVault(amoVault);
      assert.isTrue(
        await amoManagerContract.isAmoActive(amoVault),
        "Vault should be active after enabling"
      );

      // Disable the vault
      await amoManagerContract.disableAmoVault(amoVault);
      assert.isFalse(
        await amoManagerContract.isAmoActive(amoVault),
        "Vault should be inactive after disabling"
      );
    });

    it("cannot enable an already enabled vault", async function () {
      const amoVault = user1;

      // Enable the vault
      await amoManagerContract.enableAmoVault(amoVault);

      // Try to enable it again
      await expect(
        amoManagerContract.enableAmoVault(amoVault)
      ).to.be.revertedWithCustomError(
        amoManagerContract,
        "AmoVaultAlreadyEnabled"
      );
    });

    it("cannot disable an inactive vault", async function () {
      const inactiveVault = user2;

      // Try to disable an inactive vault
      await expect(
        amoManagerContract.disableAmoVault(inactiveVault)
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

  describe("USD value conversion", () => {
    it("converts USD value to dStable amount correctly", async function () {
      const usdValue = hre.ethers.parseUnits("1000", 8); // 8 decimals for USD value
      const expectedDstableAmount = hre.ethers.parseUnits(
        "1000",
        dstableInfo.decimals
      );
      const actualDstableAmount =
        await amoManagerContract.usdValueToDstableAmount(usdValue);

      assert.equal(
        actualDstableAmount,
        expectedDstableAmount,
        "USD to dStable conversion is incorrect"
      );
    });

    it("converts dStable amount to USD value correctly", async function () {
      const dstableAmount = hre.ethers.parseUnits("1000", dstableInfo.decimals);
      const expectedUsdValue = hre.ethers.parseUnits("1000", 8); // 8 decimals for USD value
      const actualUsdValue =
        await amoManagerContract.dstableAmountToUsdValue(dstableAmount);

      assert.equal(
        actualUsdValue,
        expectedUsdValue,
        "dStable to USD conversion is incorrect"
      );
    });
  });

  describe("Access control", () => {
    it("only AMO allocator can allocate AMO", async function () {
      const amoVault = user1;
      const allocateAmount = hre.ethers.parseUnits(
        "1000",
        dstableInfo.decimals
      );

      // Enable the AMO vault
      await amoManagerContract.enableAmoVault(amoVault);

      // Try to allocate as a non-allocator
      await expect(
        amoManagerContract
          .connect(await hre.ethers.getSigner(user2))
          .allocateAmo(amoVault, allocateAmount)
      ).to.be.reverted;
    });

    it("only AMO allocator can deallocate AMO", async function () {
      const amoVault = user1;
      const allocateAmount = hre.ethers.parseUnits(
        "1000",
        dstableInfo.decimals
      );
      const deallocateAmount = hre.ethers.parseUnits(
        "500",
        dstableInfo.decimals
      );

      // Enable the AMO vault and allocate tokens
      await amoManagerContract.enableAmoVault(amoVault);
      await amoManagerContract.allocateAmo(amoVault, allocateAmount);

      // Approve AmoManager to spend dStable on behalf of the vault
      await dstableContract
        .connect(await hre.ethers.getSigner(user1))
        .approve(
          await amoManagerContract.getAddress(),
          hre.ethers.parseUnits("1000", dstableInfo.decimals)
        );

      // Try to deallocate as a non-allocator
      await expect(
        amoManagerContract
          .connect(await hre.ethers.getSigner(user2))
          .deallocateAmo(amoVault, deallocateAmount)
      ).to.be.reverted;
    });
  });
});
