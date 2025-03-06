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
  let dusdContract: TestMintableERC20;
  let dusdInfo: TokenInfo;
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

    ({ contract: dusdContract, tokenInfo: dusdInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));

    // Mint some dUSD to the AmoManager for testing
    const initialAmoSupply = hre.ethers.parseUnits("10000", dusdInfo.decimals);
    await issuerContract.increaseAmoSupply(initialAmoSupply);
  });

  describe("AMO allocation", () => {
    it("allocates AMO tokens to an active vault", async function () {
      const amoVault = user1;
      const allocateAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      // Enable the AMO vault
      await amoManagerContract.enableAmoVault(amoVault);

      const initialAmoSupply = await amoManagerContract.totalAmoSupply();
      const initialVaultBalance = await dusdContract.balanceOf(amoVault);

      await amoManagerContract.allocateAmo(amoVault, allocateAmount);

      const finalAmoSupply = await amoManagerContract.totalAmoSupply();
      const finalVaultBalance = await dusdContract.balanceOf(amoVault);

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
      const allocateAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      await expect(
        amoManagerContract.allocateAmo(inactiveVault, allocateAmount)
      ).to.be.revertedWithCustomError(amoManagerContract, "InactiveAmoVault");
    });
  });

  describe("AMO deallocation", () => {
    it("deallocates AMO tokens from an active vault", async function () {
      const amoVault = user1;
      const allocateAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);
      const deallocateAmount = hre.ethers.parseUnits("500", dusdInfo.decimals);

      // Enable the AMO vault and allocate tokens
      await amoManagerContract.enableAmoVault(amoVault);
      await amoManagerContract.allocateAmo(amoVault, allocateAmount);

      // Approve AmoManager to spend dUSD on behalf of the vault
      await dusdContract
        .connect(await hre.ethers.getSigner(amoVault))
        .approve(amoManagerContract.getAddress(), deallocateAmount);

      const initialAmoSupply = await amoManagerContract.totalAmoSupply();
      const initialVaultBalance = await dusdContract.balanceOf(amoVault);

      await amoManagerContract.deallocateAmo(amoVault, deallocateAmount);

      const finalAmoSupply = await amoManagerContract.totalAmoSupply();
      const finalVaultBalance = await dusdContract.balanceOf(amoVault);

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
    });

    it("can also deallocate AMO tokens from an inactive vault", async function () {
      const amoVault = user1;
      const allocateAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);
      const deallocateAmount = hre.ethers.parseUnits("500", dusdInfo.decimals);

      // First enable the AMO vault and allocate tokens
      await amoManagerContract.enableAmoVault(amoVault);
      await amoManagerContract.allocateAmo(amoVault, allocateAmount);

      // Approve AmoManager to spend dUSD on behalf of the vault
      await dusdContract
        .connect(await hre.ethers.getSigner(amoVault))
        .approve(amoManagerContract.getAddress(), deallocateAmount);

      const initialAmoSupply = await amoManagerContract.totalAmoSupply();
      const initialVaultBalance = await dusdContract.balanceOf(amoVault);

      // Disable the AMO vault
      await amoManagerContract.disableAmoVault(amoVault);

      // We can still deallocate the AMO tokens
      await amoManagerContract.deallocateAmo(amoVault, deallocateAmount);

      const finalAmoSupply = await amoManagerContract.totalAmoSupply();
      const finalVaultBalance = await dusdContract.balanceOf(amoVault);

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
    });
  });

  describe("AMO supply management", () => {
    it("decreases AMO supply by burning dUSD", async function () {
      const burnAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      const initialAmoSupply = await amoManagerContract.totalAmoSupply();
      const initialDusdSupply = await dusdContract.totalSupply();

      await amoManagerContract.decreaseAmoSupply(burnAmount);

      const finalAmoSupply = await amoManagerContract.totalAmoSupply();
      const finalDusdSupply = await dusdContract.totalSupply();

      assert.equal(
        initialAmoSupply - finalAmoSupply,
        burnAmount,
        "AMO supply should decrease by burn amount"
      );
      assert.equal(
        initialDusdSupply - finalDusdSupply,
        burnAmount,
        "dUSD total supply should decrease by burn amount"
      );
    });

    it("calculates total AMO supply correctly", async function () {
      const amoVault = user1;
      const allocateAmount = hre.ethers.parseUnits("500", dusdInfo.decimals);

      await amoManagerContract.enableAmoVault(amoVault);
      await amoManagerContract.allocateAmo(amoVault, allocateAmount);

      const expectedTotalSupply =
        (await dusdContract.balanceOf(amoManagerContract.getAddress())) +
        allocateAmount;
      const actualTotalSupply = await amoManagerContract.totalAmoSupply();

      assert.equal(
        actualTotalSupply.toString(),
        expectedTotalSupply.toString(),
        "Total AMO supply calculation is incorrect"
      );
    });
  });

  describe("AMO vault management", () => {
    it("enables an AMO vault", async function () {
      const newVault = user2;

      await amoManagerContract.enableAmoVault(newVault);

      const isActive = await amoManagerContract.isAmoActive(newVault);
      assert.isTrue(isActive, "AMO vault should be active after enabling");
    });

    it("disables an AMO vault", async function () {
      const vault = user1;

      await amoManagerContract.enableAmoVault(vault);
      await amoManagerContract.disableAmoVault(vault);

      const isActive = await amoManagerContract.isAmoActive(vault);
      assert.isFalse(isActive, "AMO vault should be inactive after disabling");
    });

    it("only admin can enable/disable AMO vaults", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const newVault = user2;

      await expect(
        amoManagerContract.connect(normalUser).enableAmoVault(newVault)
      ).to.be.revertedWithCustomError(
        amoManagerContract,
        "AccessControlUnauthorizedAccount"
      );

      await expect(
        amoManagerContract.connect(normalUser).disableAmoVault(newVault)
      ).to.be.revertedWithCustomError(
        amoManagerContract,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("Access control", () => {
    it("only AMO allocator can allocate AMO", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const amoVault = user2;
      const allocateAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      await amoManagerContract.enableAmoVault(amoVault);

      await expect(
        amoManagerContract
          .connect(normalUser)
          .allocateAmo(amoVault, allocateAmount)
      ).to.be.revertedWithCustomError(
        amoManagerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("only AMO allocator can deallocate AMO", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const amoVault = user2;
      const deallocateAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      await amoManagerContract.enableAmoVault(amoVault);

      await expect(
        amoManagerContract
          .connect(normalUser)
          .deallocateAmo(amoVault, deallocateAmount)
      ).to.be.revertedWithCustomError(
        amoManagerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("only AMO allocator can decrease AMO supply", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const burnAmount = hre.ethers.parseUnits("1000", dusdInfo.decimals);

      await expect(
        amoManagerContract.connect(normalUser).decreaseAmoSupply(burnAmount)
      ).to.be.revertedWithCustomError(
        amoManagerContract,
        "AccessControlUnauthorizedAccount"
      );
    });
  });
});
