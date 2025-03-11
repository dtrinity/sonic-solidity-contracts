import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  Issuer,
  Redeemer,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import {
  createDStableFixture,
  DUSD_CONFIG,
  DS_CONFIG,
  DStableFixtureConfig,
} from "./fixtures";

// Define asset types for price calculation - same as in Issuer.ts
const STABLE_ASSET_PRICE = 1.0;
const YIELD_BEARING_ASSET_PRICE = 1.1;

// Define which assets are yield-bearing (price = 1.1) vs stable (price = 1.0)
const yieldBearingAssets = new Set(["sfrxUSD", "stS", "wOS", "wS"]);
const isYieldBearingAsset = (symbol: string): boolean =>
  yieldBearingAssets.has(symbol);

// dS token itself is treated as a yield-bearing asset in the oracle setup
const isYieldBearingToken = (symbol: string): boolean => symbol === "dS";

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`Redeemer for ${config.symbol}`, () => {
    let redeemerContract: Redeemer;
    let issuerContract: Issuer;
    let collateralVaultContract: CollateralHolderVault;
    let amoManagerContract: AmoManager;
    let collateralContracts: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let deployer: Address;
    let user1: Address;
    let user2: Address;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      const redeemerAddress = (
        await hre.deployments.get(config.redeemerContractId)
      ).address;
      redeemerContract = await hre.ethers.getContractAt(
        "Redeemer",
        redeemerAddress,
        await hre.ethers.getSigner(deployer)
      );

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

      // Get dStable token info
      ({ contract: dstableContract, tokenInfo: dstableInfo } =
        await getTokenContractForSymbol(
          hre,
          deployer,
          config.symbol as "dUSD" | "dS"
        ));

      // Initialize all collateral tokens for this dStable
      for (const collateralSymbol of config.collateralSymbols) {
        const { contract, tokenInfo } = await getTokenContractForSymbol(
          hre,
          deployer,
          collateralSymbol
        );
        collateralContracts.set(collateralSymbol, contract as TestERC20);
        collateralInfos.set(collateralSymbol, tokenInfo);

        // Allow this collateral in the vault
        await collateralVaultContract.allowCollateral(tokenInfo.address);

        // Transfer collateral to the vault for redemption
        const amount = hre.ethers.parseUnits("10000", tokenInfo.decimals);
        await contract.approve(
          await collateralVaultContract.getAddress(),
          amount
        );
        await collateralVaultContract.deposit(amount, tokenInfo.address);

        // Mint tokens to user1 (assuming these are test tokens with mint function)
        const userAmount = hre.ethers.parseUnits("10000", tokenInfo.decimals);
        if ("mint" in contract) {
          await (contract as TestMintableERC20).mint(user1, userAmount);
        } else {
          // If not mintable, transfer from deployer to user1
          await contract.transfer(user1, userAmount);
        }

        // Give user1 some dStable for testing redemption by using the Issuer
        // The proper way to get dStable tokens is to issue them using collateral
        const dstableAmount = hre.ethers.parseUnits(
          "1000",
          dstableInfo.decimals
        );

        // First, we need to approve the issuer to use our collateral
        await contract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerContract.getAddress(), userAmount);

        // Calculate a min amount that's safe to receive
        const minAmount = dstableAmount / 2n; // Just being conservative

        // Issue dStable tokens to user1 using collateral - use the full approved amount
        await issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(userAmount, tokenInfo.address, minAmount);
      }

      // Grant REDEMPTION_MANAGER_ROLE to user1
      const REDEMPTION_MANAGER_ROLE =
        await redeemerContract.REDEMPTION_MANAGER_ROLE();
      await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user1);
      console.log(`Granted REDEMPTION_MANAGER_ROLE to user1 (${user1})`);

      // Store for tests
      this.redeemerContract = redeemerContract;
      this.issuerContract = issuerContract;
      this.dstableContract = dstableContract;
      this.dstableInfo = dstableInfo;
      this.collateralContracts = collateralContracts;
      this.collateralInfos = collateralInfos;
      this.collateralVaultContract = collateralVaultContract;
      this.amoManagerContract = amoManagerContract;
      this.user1 = user1;
      this.user2 = user2;
    });

    describe("Basic redemption", () => {
      // Test redemption for each collateral type
      config.collateralSymbols.forEach((collateralSymbol) => {
        it(`redeems ${config.symbol} for ${collateralSymbol}`, async function () {
          const collateralContract = this.collateralContracts.get(
            collateralSymbol
          ) as TestERC20;
          const collateralInfo = this.collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          const redeemAmount = hre.ethers.parseUnits(
            "100",
            this.dstableInfo.decimals
          );

          // For dS token, we need more slippage since it's a yield-bearing asset
          // with a different price than its collateral
          let slippagePercentage = 1; // Default 1% slippage
          if (this.dstableInfo.symbol === "dS") {
            slippagePercentage = 20; // 20% slippage for dS
          }

          const minCollateralOut = hre.ethers.parseUnits(
            (100 - slippagePercentage).toString(),
            collateralInfo.decimals
          ); // Allow for appropriate slippage

          const userDstableBalanceBefore = await this.dstableContract.balanceOf(
            this.user1
          );
          const userCollateralBalanceBefore =
            await collateralContract.balanceOf(this.user1);
          const vaultCollateralBalanceBefore =
            await collateralContract.balanceOf(
              await this.collateralVaultContract.getAddress()
            );

          await this.dstableContract
            .connect(await hre.ethers.getSigner(this.user1))
            .approve(await this.redeemerContract.getAddress(), redeemAmount);

          await this.redeemerContract
            .connect(await hre.ethers.getSigner(this.user1))
            .redeem(redeemAmount, collateralInfo.address, minCollateralOut);

          const userDstableBalanceAfter = await this.dstableContract.balanceOf(
            this.user1
          );
          const userCollateralBalanceAfter = await collateralContract.balanceOf(
            this.user1
          );
          const vaultCollateralBalanceAfter =
            await collateralContract.balanceOf(
              await this.collateralVaultContract.getAddress()
            );

          assert.equal(
            (userDstableBalanceBefore - userDstableBalanceAfter).toString(),
            redeemAmount.toString(),
            "User's dStable balance should decrease by the redeemed amount"
          );

          assert.isTrue(
            userCollateralBalanceAfter > userCollateralBalanceBefore,
            "User should receive collateral tokens"
          );

          assert.isTrue(
            userCollateralBalanceAfter - userCollateralBalanceBefore >=
              minCollateralOut,
            "User should receive at least the minimum collateral output"
          );

          assert.equal(
            vaultCollateralBalanceBefore - vaultCollateralBalanceAfter,
            userCollateralBalanceAfter - userCollateralBalanceBefore,
            "Vault collateral balance should decrease by the amount given to the user"
          );
        });

        it(`cannot redeem ${config.symbol} with insufficient balance`, async function () {
          const collateralInfo = this.collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          const userDstableBalance = await this.dstableContract.balanceOf(
            this.user1
          );
          const redeemAmount = userDstableBalance + 1n; // More than the user has
          const minCollateralOut = hre.ethers.parseUnits(
            "99",
            collateralInfo.decimals
          );

          await this.dstableContract
            .connect(await hre.ethers.getSigner(this.user1))
            .approve(await this.redeemerContract.getAddress(), redeemAmount);

          await expect(
            this.redeemerContract
              .connect(await hre.ethers.getSigner(this.user1))
              .redeem(redeemAmount, collateralInfo.address, minCollateralOut)
          ).to.be.reverted;
        });

        it(`cannot redeem ${config.symbol} when slippage is too high`, async function () {
          const collateralInfo = this.collateralInfos.get(
            collateralSymbol
          ) as TokenInfo;

          const redeemAmount = hre.ethers.parseUnits(
            "100",
            this.dstableInfo.decimals
          );
          const unrealistically_high_min_collateral = hre.ethers.parseUnits(
            "200",
            collateralInfo.decimals
          );

          await this.dstableContract
            .connect(await hre.ethers.getSigner(this.user1))
            .approve(await this.redeemerContract.getAddress(), redeemAmount);

          await expect(
            this.redeemerContract
              .connect(await hre.ethers.getSigner(this.user1))
              .redeem(
                redeemAmount,
                collateralInfo.address,
                unrealistically_high_min_collateral
              )
          ).to.be.revertedWithCustomError(
            this.redeemerContract,
            "SlippageTooHigh"
          );
        });
      });
    });

    describe("Administrative functions", () => {
      it("allows changing the collateral vault", async function () {
        // Deploy a new vault for testing
        const newVault = await hre.deployments.deploy("TestCollateralVault", {
          from: deployer, // Use deployer from named accounts directly
          contract: "CollateralHolderVault",
          args: [await this.redeemerContract.oracle()],
          autoMine: true,
          log: false,
        });

        await this.redeemerContract.setCollateralVault(newVault.address);

        const updatedVault = await this.redeemerContract.collateralVault();
        assert.equal(
          updatedVault,
          newVault.address,
          "Collateral vault should be updated"
        );
      });

      it("allows setting collateral vault only by admin", async function () {
        await expect(
          this.redeemerContract
            .connect(await hre.ethers.getSigner(this.user1))
            .setCollateralVault(hre.ethers.ZeroAddress)
        ).to.be.reverted;
      });

      it("allows admin to grant REDEMPTION_MANAGER_ROLE", async function () {
        const REDEMPTION_MANAGER_ROLE =
          await this.redeemerContract.REDEMPTION_MANAGER_ROLE();

        await this.redeemerContract.grantRole(
          REDEMPTION_MANAGER_ROLE,
          this.user2
        );

        const hasRole = await this.redeemerContract.hasRole(
          REDEMPTION_MANAGER_ROLE,
          this.user2
        );
        assert.isTrue(hasRole, "User should have REDEMPTION_MANAGER_ROLE");
      });
    });
  });
});
