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
  let dusdContract: TestMintableERC20;
  let dusdInfo: TokenInfo;
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
    ({ contract: dusdContract, tokenInfo: dusdInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));

    // Allow FRAX as collateral
    await collateralVaultContract.allowCollateral(frxUSDInfo.address);

    // Mint some dUSD to dusdDeployer
    await frxUSDContract.approve(
      issuerAddress,
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals)
    );
    await issuerContract.issue(
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals),
      frxUSDInfo.address,
      hre.ethers.parseUnits("1000", dusdInfo.decimals)
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
      const redeemAmount = hre.ethers.parseUnits("100", dusdInfo.decimals);
      const minimumFraxReceived = hre.ethers.parseUnits(
        "99",
        frxUSDInfo.decimals
      ); // Assuming 1% slippage

      const dusdBalanceBefore = await dusdContract.balanceOf(deployer);
      const fraxBalanceBefore = await frxUSDContract.balanceOf(deployer);

      await dusdContract.approve(
        await redeemerContract.getAddress(),
        redeemAmount
      );

      await redeemerContract.redeem(
        redeemAmount,
        frxUSDInfo.address,
        minimumFraxReceived
      );

      const dusdBalanceAfter = await dusdContract.balanceOf(deployer);
      const fraxBalanceAfter = await frxUSDContract.balanceOf(deployer);

      assert.equal(
        dusdBalanceAfter,
        dusdBalanceBefore - redeemAmount,
        "dUSD balance did not decrease by the expected amount"
      );
      assert.isTrue(
        fraxBalanceAfter - fraxBalanceBefore >= minimumFraxReceived,
        "FRAX received is less than the minimum expected"
      );
    });

    it("fails when slippage is too high", async function () {
      const redeemAmount = hre.ethers.parseUnits("100", dusdInfo.decimals);
      const impossibleMinimumFraxReceived = hre.ethers.parseUnits(
        "101",
        frxUSDInfo.decimals
      ); // Impossible slippage

      await dusdContract.approve(
        await redeemerContract.getAddress(),
        redeemAmount
      );

      await expect(
        redeemerContract.redeem(
          redeemAmount,
          frxUSDInfo.address,
          impossibleMinimumFraxReceived
        )
      ).to.be.revertedWithCustomError(redeemerContract, "SlippageTooHigh");
    });

    it("only redemption manager can redeem", async function () {
      const normalUser = await hre.ethers.getSigner(user1);
      const redeemAmount = hre.ethers.parseUnits("100", dusdInfo.decimals);
      const minimumFraxReceived = hre.ethers.parseUnits(
        "99",
        frxUSDInfo.decimals
      );

      await expect(
        redeemerContract
          .connect(normalUser)
          .redeem(redeemAmount, frxUSDInfo.address, minimumFraxReceived)
      ).to.be.revertedWithCustomError(
        redeemerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("dusdAmountToUsdValue converts correctly", async function () {
      const dusdPriceOracle = await hre.ethers.getContractAt(
        "MockOracleAggregator",
        await redeemerContract.oracle(),
        await hre.ethers.getSigner(deployer)
      );

      const dusdAmount = hre.ethers.parseUnits("100", dusdInfo.decimals); // 100 dUSD
      const dusdPrice = await dusdPriceOracle.getAssetPrice(dusdInfo.address);
      const expectedUsdValue =
        (dusdAmount * dusdPrice) / 10n ** BigInt(dusdInfo.decimals);

      const actualUsdValue =
        await redeemerContract.dusdAmountToUsdValue(dusdAmount);

      assert.equal(
        actualUsdValue,
        expectedUsdValue,
        "dUSD to USD conversion is incorrect"
      );
    });
  });

  describe("Management", () => {
    it("only admin can set collateral vault", async function () {
      const normalUser = await hre.ethers.getSigner(user1);

      await expect(
        redeemerContract.connect(normalUser).setCollateralVault(user2)
      ).to.be.revertedWithCustomError(
        redeemerContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("only admin can set oracle", async function () {
      const normalUser = await hre.ethers.getSigner(user1);

      await expect(
        redeemerContract.connect(normalUser).setOracle(user2)
      ).to.be.revertedWithCustomError(
        redeemerContract,
        "AccessControlUnauthorizedAccount"
      );
    });
  });
});
