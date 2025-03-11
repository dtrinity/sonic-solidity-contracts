import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  CollateralVault,
  TestERC20,
  Redeemer,
  TestMintableERC20,
  Issuer,
} from "../../typechain-types";
import { TokenInfo } from "../../typescript/token/utils";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { standaloneMinimalFixture } from "./fixtures";
import {
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_ISSUER_CONTRACT_ID,
} from "../../typescript/deploy-ids";

describe("Redeemer", () => {
  let redeemerContract: Redeemer;
  let issuerContract: Issuer;
  let collateralVaultContract: CollateralVault;
  let frxUSDContract: TestERC20;
  let frxUSDInfo: TokenInfo;
  let dstableContract: TestMintableERC20;
  let dstableInfo: TokenInfo;
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  beforeEach(async function () {
    await standaloneMinimalFixture();

    ({ deployer, user1, user2 } = await getNamedAccounts());

    const redeemerAddress = (
      await hre.deployments.get(DUSD_REDEEMER_CONTRACT_ID)
    ).address;
    redeemerContract = await hre.ethers.getContractAt(
      "Redeemer",
      redeemerAddress,
      await hre.ethers.getSigner(deployer)
    );

    const collateralVaultAddress = await redeemerContract.collateralVault();
    collateralVaultContract = await hre.ethers.getContractAt(
      "CollateralHolderVault",
      collateralVaultAddress,
      await hre.ethers.getSigner(deployer)
    );

    const issuerAddress = (await hre.deployments.get(DUSD_ISSUER_CONTRACT_ID))
      .address;
    issuerContract = await hre.ethers.getContractAt(
      "Issuer",
      issuerAddress,
      await hre.ethers.getSigner(deployer)
    );

    ({ contract: frxUSDContract, tokenInfo: frxUSDInfo } =
      await getTokenContractForSymbol(hre, deployer, "frxUSD"));
    ({ contract: dstableContract, tokenInfo: dstableInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));

    // Allow FRAX as collateral
    await collateralVaultContract.allowCollateral(frxUSDInfo.address);

    // Mint some dStable to deployer
    await frxUSDContract.approve(
      issuerAddress,
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals)
    );
    await issuerContract.issue(
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals),
      frxUSDInfo.address,
      hre.ethers.parseUnits("1000", dstableInfo.decimals)
    );

    // Deposit frxUSD into the collateral vault
    await frxUSDContract.transfer(
      deployer,
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals)
    );
    await frxUSDContract.approve(
      await collateralVaultContract.getAddress(),
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals)
    );
    await collateralVaultContract.deposit(
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals),
      frxUSDInfo.address
    );
  });

  describe("Permissioned redemption", () => {
    it("redeem for collateral", async function () {
      const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
      const minimumFraxReceived = hre.ethers.parseUnits(
        "99",
        frxUSDInfo.decimals
      );

      // Grant REDEMPTION_MANAGER_ROLE to deployer
      const REDEMPTION_MANAGER_ROLE =
        await redeemerContract.REDEMPTION_MANAGER_ROLE();
      await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, deployer);

      // Approve redeemer to spend dStable
      await dstableContract.approve(
        await redeemerContract.getAddress(),
        redeemAmount
      );

      const initialDstableBalance = await dstableContract.balanceOf(deployer);
      const initialFraxBalance = await frxUSDContract.balanceOf(deployer);

      await redeemerContract.redeem(
        redeemAmount,
        frxUSDInfo.address,
        minimumFraxReceived
      );

      const finalDstableBalance = await dstableContract.balanceOf(deployer);
      const finalFraxBalance = await frxUSDContract.balanceOf(deployer);

      assert.equal(
        initialDstableBalance - finalDstableBalance,
        redeemAmount,
        "dStable balance did not decrease by the expected amount"
      );
      assert.isTrue(
        finalFraxBalance - initialFraxBalance >= minimumFraxReceived,
        "Did not receive minimum amount of collateral"
      );
    });

    it("reverts when slippage is too high", async function () {
      const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
      const tooHighMinimumFraxReceived = hre.ethers.parseUnits(
        "101",
        frxUSDInfo.decimals
      );

      // Grant REDEMPTION_MANAGER_ROLE to deployer
      const REDEMPTION_MANAGER_ROLE =
        await redeemerContract.REDEMPTION_MANAGER_ROLE();
      await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, deployer);

      // Approve redeemer to spend dStable
      await dstableContract.approve(
        await redeemerContract.getAddress(),
        redeemAmount
      );

      await expect(
        redeemerContract.redeem(
          redeemAmount,
          frxUSDInfo.address,
          tooHighMinimumFraxReceived
        )
      ).to.be.revertedWithCustomError(redeemerContract, "SlippageTooHigh");
    });

    it("only redemption manager can redeem", async function () {
      const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
      const minimumFraxReceived = hre.ethers.parseUnits(
        "99",
        frxUSDInfo.decimals
      );

      // Connect with user1 who does not have the REDEMPTION_MANAGER_ROLE
      const user1Signer = await hre.ethers.getSigner(user1);
      const redeemerAsUser1 = redeemerContract.connect(user1Signer);

      // Make sure user1 has some dStable tokens to redeem
      await dstableContract.transfer(user1, redeemAmount);

      // Connect to dStable contract with user1
      const dstableAsUser1 = dstableContract.connect(user1Signer);

      // Approve redeemer to spend dStable
      await dstableAsUser1.approve(
        await redeemerContract.getAddress(),
        redeemAmount
      );

      // Try to redeem without the role
      await expect(
        redeemerAsUser1.redeem(
          redeemAmount,
          frxUSDInfo.address,
          minimumFraxReceived
        )
      ).to.be.revertedWithCustomError(
        redeemerContract,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("USD value conversion", () => {
    it("converts dStable amount to USD value correctly", async function () {
      const dstableAmount = hre.ethers.parseUnits("100", dstableInfo.decimals); // 100 dStable
      const expectedUsdValue = hre.ethers.parseUnits("100", 8); // 100 USD with 8 decimals

      const actualUsdValue =
        await redeemerContract.dstableAmountToUsdValue(dstableAmount);

      assert.equal(
        actualUsdValue,
        expectedUsdValue,
        "dStable to USD conversion is incorrect"
      );
    });
  });

  describe("Admin functions", () => {
    it("allows admin to set collateral vault", async function () {
      const newVaultAddress = user1;

      await redeemerContract.setCollateralVault(newVaultAddress);

      const updatedVaultAddress = await redeemerContract.collateralVault();
      assert.equal(
        updatedVaultAddress,
        newVaultAddress,
        "Collateral vault address was not updated"
      );
    });

    it("only admin can set collateral vault", async function () {
      const newVaultAddress = user1;
      const nonAdmin = await hre.ethers.getSigner(user2);

      await expect(
        redeemerContract.connect(nonAdmin).setCollateralVault(newVaultAddress)
      ).to.be.reverted;
    });
  });
});
