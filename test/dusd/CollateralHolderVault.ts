import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { CollateralHolderVault, TestERC20 } from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import { standaloneMinimalFixture } from "./fixtures";
import { DUSD_COLLATERAL_VAULT_CONTRACT_ID } from "../../typescript/deploy-ids";

describe("CollateralHolderVault", () => {
  let collateralVaultContract: CollateralHolderVault;
  let frxUSDContract: TestERC20;
  let frxUSDInfo: TokenInfo;
  let sfrxUSDContract: TestERC20;
  let sfrxUSDInfo: TokenInfo;
  let usdcContract: TestERC20;
  let usdcInfo: TokenInfo;
  let deployer: Address;
  let user1: Address;

  beforeEach(async function () {
    await standaloneMinimalFixture();

    ({ deployer, user1 } = await getNamedAccounts());

    const collateralVaultAddress = (
      await hre.deployments.get(DUSD_COLLATERAL_VAULT_CONTRACT_ID)
    ).address;
    collateralVaultContract = await hre.ethers.getContractAt(
      "CollateralHolderVault",
      collateralVaultAddress,
      await hre.ethers.getSigner(deployer)
    );

    ({ contract: frxUSDContract, tokenInfo: frxUSDInfo } =
      await getTokenContractForSymbol(hre, deployer, "frxUSD"));
    ({ contract: sfrxUSDContract, tokenInfo: sfrxUSDInfo } =
      await getTokenContractForSymbol(hre, deployer, "sfrxUSD"));
    ({ contract: usdcContract, tokenInfo: usdcInfo } =
      await getTokenContractForSymbol(hre, deployer, "USDC"));

    // Allow the collateral vault to use frxUSD, sfrxUSD and USDC
    await collateralVaultContract.allowCollateral(frxUSDInfo.address);
    await collateralVaultContract.allowCollateral(sfrxUSDInfo.address);
    await collateralVaultContract.allowCollateral(usdcInfo.address);
  });

  describe("Depositing collateral", () => {
    it("successive successful deposits", async function () {
      // Deposit frxUSD
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", frxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("420", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("420", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );

      // Deposit USDC
      await usdcContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("80", usdcInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("80", usdcInfo.decimals),
        usdcInfo.address
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("500", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );

      // Deposit sfrxUSD
      await sfrxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("100", sfrxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("100", sfrxUSDInfo.decimals),
        sfrxUSDInfo.address
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("610", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
    });
  });

  describe("Withdrawing collateral", () => {
    it("only withdrawer can withdraw", async function () {
      // Deposit frxUSD
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", frxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("420", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      // Withdraw some frxUSD
      await collateralVaultContract.withdraw(
        hre.ethers.parseUnits("351", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("69", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );

      // Normal user cannot withdraw
      await expect(
        collateralVaultContract
          .connect(await hre.ethers.getSigner(user1))
          .withdraw(
            hre.ethers.parseUnits("9", frxUSDInfo.decimals),
            frxUSDInfo.address
          )
      ).to.be.revertedWithCustomError(
        collateralVaultContract,
        "AccessControlUnauthorizedAccount"
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("69", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
    });

    it("can withdraw to a specific address using withdrawTo", async function () {
      // Deposit frxUSD
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", frxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("420", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      const initialBalance = await frxUSDContract.balanceOf(user1);

      // Withdraw some frxUSD to testAccount1
      await collateralVaultContract.withdrawTo(
        user1,
        hre.ethers.parseUnits("100", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      const finalBalance = await frxUSDContract.balanceOf(user1);

      assert.equal(
        finalBalance - initialBalance,
        hre.ethers.parseUnits("100", frxUSDInfo.decimals)
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("320", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
    });
  });

  describe("Exchanging collateral", () => {
    it("exchange exact amount", async function () {
      // Deposit frxUSD
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", frxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("420", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      // Exchange frxUSD for USDC
      await usdcContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("100", usdcInfo.decimals)
      );

      await collateralVaultContract.exchangeCollateral(
        hre.ethers.parseUnits("100", usdcInfo.decimals),
        usdcInfo.address,
        hre.ethers.parseUnits("100", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("420", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
    });

    it("exchange max amount", async function () {
      // Deposit frxUSD
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", frxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("420", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      // Exchange max frxUSD for USDC
      await usdcContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", usdcInfo.decimals)
      );

      await collateralVaultContract.exchangeMaxCollateral(
        hre.ethers.parseUnits("420", usdcInfo.decimals),
        usdcInfo.address,
        frxUSDInfo.address,
        hre.ethers.parseUnits("0", usdcInfo.decimals)
      );

      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("420", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
    });

    it("normal user cannot exchange exact amount", async function () {
      // Deposit frxUSD
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", frxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("420", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      // Connect as testAccount1 to attempt unauthorized exchange
      await expect(
        collateralVaultContract
          .connect(await hre.ethers.getSigner(user1))
          .exchangeCollateral(
            hre.ethers.parseUnits("100", usdcInfo.decimals),
            usdcInfo.address,
            hre.ethers.parseUnits("100", frxUSDInfo.decimals),
            frxUSDInfo.address
          )
      ).to.be.revertedWithCustomError(
        collateralVaultContract,
        "AccessControlUnauthorizedAccount"
      );

      // Ensure total value hasn't changed
      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("420", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
    });

    it("normal user cannot exchange max amount", async function () {
      // Deposit frxUSD
      await frxUSDContract.approve(
        await collateralVaultContract.getAddress(),
        hre.ethers.parseUnits("420", frxUSDInfo.decimals)
      );
      await collateralVaultContract.deposit(
        hre.ethers.parseUnits("420", frxUSDInfo.decimals),
        frxUSDInfo.address
      );

      // Connect as testAccount1 to attempt unauthorized max exchange
      await expect(
        collateralVaultContract
          .connect(await hre.ethers.getSigner(user1))
          .exchangeMaxCollateral(
            hre.ethers.parseUnits("420", usdcInfo.decimals),
            usdcInfo.address,
            frxUSDInfo.address,
            hre.ethers.parseUnits("0", usdcInfo.decimals)
          )
      ).to.be.revertedWithCustomError(
        collateralVaultContract,
        "AccessControlUnauthorizedAccount"
      );

      // Ensure total value hasn't changed
      assert.equal(
        await collateralVaultContract.totalValue(),
        hre.ethers.parseUnits("420", ORACLE_AGGREGATOR_PRICE_DECIMALS)
      );
    });
  });

  describe("Management", () => {
    it("cannot manage collateral assets as a normal user", async function () {
      // Connect as testAccount1 to attempt unauthorized collateral management
      await expect(
        collateralVaultContract
          .connect(await hre.ethers.getSigner(user1))
          .allowCollateral(frxUSDInfo.address)
      ).to.be.revertedWithCustomError(
        collateralVaultContract,
        "AccessControlUnauthorizedAccount"
      );

      await expect(
        collateralVaultContract
          .connect(await hre.ethers.getSigner(user1))
          .disallowCollateral(frxUSDInfo.address)
      ).to.be.revertedWithCustomError(
        collateralVaultContract,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("cannot set oracle as a normal user", async function () {
      // Connect as testAccount1 to attempt unauthorized oracle setting
      await expect(
        collateralVaultContract
          .connect(await hre.ethers.getSigner(user1))
          .setOracle(user1)
      ).to.be.revertedWithCustomError(
        collateralVaultContract,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("Error handling", () => {
    it("should revert with UnsupportedCollateral error", async function () {
      const unsupportedCollateral =
        "0x0000000000000000000000000000000000000001";
      await expect(
        collateralVaultContract.deposit(
          hre.ethers.parseUnits("100", 18),
          unsupportedCollateral
        )
      )
        .to.be.revertedWithCustomError(
          collateralVaultContract,
          "UnsupportedCollateral"
        )
        .withArgs(unsupportedCollateral);
    });

    it("should revert with CollateralAlreadyAllowed error", async function () {
      await expect(collateralVaultContract.allowCollateral(frxUSDInfo.address))
        .to.be.revertedWithCustomError(
          collateralVaultContract,
          "CollateralAlreadyAllowed"
        )
        .withArgs(frxUSDInfo.address);
    });

    it("should revert with CollateralAlreadyAllowed error", async function () {
      // Simulate failure by mocking the add function
      await expect(collateralVaultContract.allowCollateral(usdcInfo.address))
        .to.be.revertedWithCustomError(
          collateralVaultContract,
          "CollateralAlreadyAllowed"
        )
        .withArgs(usdcInfo.address);
    });

    it("should revert with CollateralNotSupported error", async function () {
      const unsupportedCollateral =
        "0x0000000000000000000000000000000000000003";
      await expect(
        collateralVaultContract.disallowCollateral(unsupportedCollateral)
      )
        .to.be.revertedWithCustomError(
          collateralVaultContract,
          "CollateralNotSupported"
        )
        .withArgs(unsupportedCollateral);
    });

    it("should revert with MustSupportAtLeastOneCollateral error", async function () {
      // Simulate removing all collaterals
      await collateralVaultContract.disallowCollateral(usdcInfo.address);
      await collateralVaultContract.disallowCollateral(frxUSDInfo.address);
      await expect(
        collateralVaultContract.disallowCollateral(sfrxUSDInfo.address)
      ).to.be.revertedWithCustomError(
        collateralVaultContract,
        "MustSupportAtLeastOneCollateral"
      );
    });

    it("should revert with CannotWithdrawMoreValueThanDeposited error", async function () {
      await expect(
        collateralVaultContract.exchangeCollateral(
          hre.ethers.parseUnits("100", usdcInfo.decimals),
          usdcInfo.address,
          hre.ethers.parseUnits("200", frxUSDInfo.decimals),
          frxUSDInfo.address
        )
      )
        .to.be.revertedWithCustomError(
          collateralVaultContract,
          "CannotWithdrawMoreValueThanDeposited"
        )
        .withArgs(
          hre.ethers.parseUnits("200", frxUSDInfo.decimals),
          hre.ethers.parseUnits("100", frxUSDInfo.decimals)
        );
    });

    it("should revert with ToCollateralAmountBelowMin error", async function () {
      await expect(
        collateralVaultContract.exchangeMaxCollateral(
          hre.ethers.parseUnits("100", usdcInfo.decimals),
          usdcInfo.address,
          frxUSDInfo.address,
          hre.ethers.parseUnits("200", frxUSDInfo.decimals)
        )
      )
        .to.be.revertedWithCustomError(
          collateralVaultContract,
          "ToCollateralAmountBelowMin"
        )
        .withArgs(
          hre.ethers.parseUnits("100", frxUSDInfo.decimals),
          hre.ethers.parseUnits("200", frxUSDInfo.decimals)
        );
    });
  });
});
