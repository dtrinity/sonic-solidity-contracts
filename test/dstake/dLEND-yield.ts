import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre, { ethers, getNamedAccounts, network } from "hardhat";

import { getConfig } from "../../config/config";
import {
  DStakeCollateralVault,
  DStakeRouterDLend,
  DStakeToken,
  ERC20,
  IDStableConversionAdapter,
  IERC20,
} from "../../typechain-types";
import { IPool } from "../../typechain-types/contracts/dlend/core/interfaces/IPool";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { TestERC20 } from "../../typechain-types/contracts/testing/token/TestERC20";
import { StaticATokenLM } from "../../typechain-types/contracts/vaults/atoken_wrapper/StaticATokenLM";
import {
  createDStakeFixture,
  DStakeFixtureConfig,
  SDS_CONFIG,
  SDUSD_CONFIG,
} from "./fixture";

const STAKE_CONFIGS: DStakeFixtureConfig[] = [SDUSD_CONFIG, SDS_CONFIG];

STAKE_CONFIGS.forEach((cfg) => {
  describe(`dSTAKE Ecosystem - ${cfg.DStakeTokenSymbol} - Yield Accrual and Exchange Rate Update`, function () {
    // Create fixture function once per suite for snapshot caching
    const fixture = createDStakeFixture(cfg);

    let deployer: SignerWithAddress;
    let user: SignerWithAddress;
    let DStakeToken: DStakeToken;
    let collateralVault: DStakeCollateralVault;
    let router: DStakeRouterDLend;
    let dStableToken: ERC20;
    let dStableDecimals: number;
    let vaultAssetToken: IERC20;
    let vaultAssetAddress: string;
    let adapter: IDStableConversionAdapter;
    let stable: ERC20StablecoinUpgradeable;
    let staticWrapper: StaticATokenLM;
    let pool: IPool;
    let poolAddress: string;

    beforeEach(async function () {
      const named = await getNamedAccounts();
      const userAddr = named.user1 || named.deployer;

      // Revert to snapshot instead of redeploying
      const out = await fixture();
      deployer = out.deployer;
      user = await ethers.getSigner(userAddr);
      DStakeToken = out.DStakeToken as unknown as DStakeToken;
      collateralVault = out.collateralVault as unknown as DStakeCollateralVault;
      router = out.router as unknown as DStakeRouterDLend;
      dStableToken = out.dStableToken as unknown as ERC20;
      dStableDecimals = out.dStableInfo.decimals;
      vaultAssetToken = out.vaultAssetToken as unknown as IERC20;
      vaultAssetAddress = out.vaultAssetAddress;
      adapter = out.adapter as unknown as IDStableConversionAdapter;

      // Setup dStable minting
      stable = (await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        await dStableToken.getAddress(),
        deployer,
      )) as ERC20StablecoinUpgradeable;
      const minterRole = await (stable as any).MINTER_ROLE();
      await stable.grantRole(minterRole, deployer.address);

      // Initial deposit into dSTAKE vault
      const depositAmount = ethers.parseUnits("100", dStableDecimals);
      await stable.mint(user.address, depositAmount);
      await dStableToken
        .connect(user)
        .approve(await DStakeToken.getAddress(), depositAmount);
      await DStakeToken.connect(user).deposit(depositAmount, user.address);

      // Locate static wrapper and pool contracts
      staticWrapper = (await ethers.getContractAt(
        "StaticATokenLM",
        vaultAssetAddress,
        deployer,
      )) as StaticATokenLM;
      poolAddress = await staticWrapper.POOL();
      pool = (await ethers.getContractAt(
        "contracts/dlend/core/interfaces/IPool.sol:IPool",
        poolAddress,
        deployer,
      )) as unknown as IPool;
    });

    it("should accrue yield over time, improve exchange rate, and allow correct withdrawals", async function () {
      // Record initial state
      const initialTotalSupply = await DStakeToken.totalSupply();
      const initialTotalAssets = await DStakeToken.totalAssets();
      const WAD = ethers.parseUnits("1", dStableDecimals);
      const initialRate = (initialTotalAssets * WAD) / initialTotalSupply;
      const initialPreview =
        await DStakeToken.previewRedeem(initialTotalSupply);

      // Setup small borrow to generate interest for lenders
      const globalConfig = await getConfig(hre);
      const dStableCollaterals = globalConfig.dStables[
        cfg.dStableSymbol
      ].collaterals.filter((addr) => addr !== ethers.ZeroAddress);
      const collateralAsset = dStableCollaterals[dStableCollaterals.length - 1];
      const collateralToken = (await ethers.getContractAt(
        "TestERC20",
        collateralAsset,
        deployer,
      )) as unknown as TestERC20;
      const colDecimals = await collateralToken.decimals();
      const collateralDeposit = ethers.parseUnits("125", colDecimals);
      // Approve and deposit collateral
      await collateralToken
        .connect(deployer)
        .approve(poolAddress, collateralDeposit);
      await pool
        .connect(deployer)
        .deposit(collateralAsset, collateralDeposit, deployer.address, 0);
      await pool
        .connect(deployer)
        .setUserUseReserveAsCollateral(collateralAsset, true);
      // Borrow a small amount to create utilization
      const borrowAmountSmall = ethers.parseUnits("1", dStableDecimals);
      await pool
        .connect(deployer)
        .borrow(
          await staticWrapper.asset(),
          borrowAmountSmall,
          2,
          0,
          deployer.address,
        );

      // Simulate time passing
      const thirtyDays = 3600 * 24 * 30;
      await network.provider.send("evm_increaseTime", [thirtyDays]);
      await network.provider.send("evm_mine");

      // Trigger reserve interest update via small supply
      const yieldDeposit = ethers.parseUnits("1", dStableDecimals);
      await stable.mint(deployer.address, yieldDeposit);
      // Approve the dStable token to be pulled by the Pool for supply
      await stable.approve(poolAddress, yieldDeposit);
      // Supply to dLEND directly to update interest index
      await pool.supply(
        await staticWrapper.asset(),
        yieldDeposit,
        deployer.address,
        0,
      );

      // Post-yield checks
      const newTotalSupply = await DStakeToken.totalSupply();
      expect(newTotalSupply).to.equal(initialTotalSupply);
      const newTotalAssets = await DStakeToken.totalAssets();
      expect(newTotalAssets).to.be.greaterThan(initialTotalAssets);
      const newRate = (newTotalAssets * WAD) / newTotalSupply;
      expect(newRate).to.be.greaterThan(initialRate);
      const newPreview = await DStakeToken.previewRedeem(initialTotalSupply);
      expect(newPreview).to.be.greaterThan(initialPreview);

      // Withdraw a portion of shares
      const withdrawShares = initialTotalSupply / 2n;
      const userBalanceBefore = await dStableToken.balanceOf(user.address);
      await DStakeToken.connect(user).redeem(
        withdrawShares,
        user.address,
        user.address,
      );
      const userBalanceAfter = await dStableToken.balanceOf(user.address);
      const actualRedeemed = userBalanceAfter - userBalanceBefore;
      expect(actualRedeemed).to.be.gt(0);

      // Verify shares and vault metrics update
      const userSharesRemaining = await DStakeToken.balanceOf(user.address);
      expect(userSharesRemaining).to.equal(initialTotalSupply - withdrawShares);
      const finalTotalSupply = await DStakeToken.totalSupply();
      expect(finalTotalSupply).to.equal(initialTotalSupply - withdrawShares);
      const finalTotalAssets = await DStakeToken.totalAssets();
      // After redemption, total assets should be less than newTotalAssets due to withdrawn shares
      expect(finalTotalAssets).to.be.lt(newTotalAssets);
    });

    it("should fail gracefully on insufficient pool liquidity when withdrawing", async function () {
      // Record initial state
      const initialTotalSupply = await DStakeToken.totalSupply();
      const initialUserShares = await DStakeToken.balanceOf(user.address);
      const initialUserDStable = await dStableToken.balanceOf(user.address);

      // Drain pool liquidity by borrowing all available dStable
      const globalConfig = await getConfig(hre);
      const dStableCollaterals = globalConfig.dStables[
        cfg.dStableSymbol
      ].collaterals.filter((addr) => addr !== ethers.ZeroAddress);
      const collateralAsset = dStableCollaterals[dStableCollaterals.length - 1];
      const collateralToken = (await ethers.getContractAt(
        "TestERC20",
        collateralAsset,
        deployer,
      )) as TestERC20;
      const colDecimals = await collateralToken.decimals();
      const collateralDeposit = ethers.parseUnits("125", colDecimals);
      // Supply collateral and enable
      await collateralToken
        .connect(deployer)
        .approve(poolAddress, collateralDeposit);
      await pool
        .connect(deployer)
        .deposit(collateralAsset, collateralDeposit, deployer.address, 0);
      await pool
        .connect(deployer)
        .setUserUseReserveAsCollateral(collateralAsset, true);
      // Borrow all pool liquidity (underlying tokens held in the AToken contract)
      const aTokenAddress = await staticWrapper.aToken();
      const poolLiquidity = await dStableToken.balanceOf(aTokenAddress);
      await pool
        .connect(deployer)
        .borrow(
          await staticWrapper.asset(),
          poolLiquidity,
          2,
          0,
          deployer.address,
        );

      // Attempt to withdraw full user's dStable should revert due to insufficient liquidity
      const depositAmount = ethers.parseUnits("100", dStableDecimals);
      await expect(
        DStakeToken.connect(user).withdraw(
          depositAmount,
          user.address,
          user.address,
        ),
      ).to.be.reverted;

      // State invariants remain unchanged
      expect(await DStakeToken.balanceOf(user.address)).to.equal(
        initialUserShares,
      );
      expect(await DStakeToken.totalSupply()).to.equal(initialTotalSupply);
      expect(await dStableToken.balanceOf(user.address)).to.equal(
        initialUserDStable,
      );
    });
  });
});
