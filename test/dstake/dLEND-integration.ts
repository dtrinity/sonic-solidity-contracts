import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, getNamedAccounts } from "hardhat";

import {
  DStakeCollateralVault,
  DStakeRouterDLend,
  DStakeToken,
  ERC20,
  IDStableConversionAdapter,
  IERC20,
} from "../../typechain-types";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { IStaticATokenLM } from "../../typechain-types/contracts/vaults/atoken_wrapper/interfaces/IStaticATokenLM";
import {
  createDStakeFixture,
  DStakeFixtureConfig,
  SDS_CONFIG,
  SDUSD_CONFIG,
} from "./fixture";

const STAKE_CONFIGS: DStakeFixtureConfig[] = [SDUSD_CONFIG, SDS_CONFIG];

STAKE_CONFIGS.forEach((cfg) => {
  describe(`dStake Ecosystem - ${cfg.DStakeTokenSymbol} - Basic Deposit and dLEND Interaction Verification`, function () {
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

    beforeEach(async function () {
      const named = await getNamedAccounts();
      const userAddr = named.user1 || named.deployer;

      // Revert to snapshot instead of full deployment
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

      // Grant MINTER_ROLE to deployer so we can mint dStable for user
      stable = (await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        await dStableToken.getAddress(),
        deployer,
      )) as ERC20StablecoinUpgradeable;
      const minterRole = await stable.MINTER_ROLE();
      await stable.grantRole(minterRole, deployer.address);
    });

    it("should deposit dStable, mint shares, and supply to dLEND", async function () {
      // Define deposit amount
      const depositAmount = ethers.parseUnits("100", dStableDecimals);

      // Pre-deposit checks
      const initialTotalSupply = await DStakeToken.totalSupply();
      const initialTotalAssets = await DStakeToken.totalAssets();
      const collateralVaultAddr = await collateralVault.getAddress();
      const initialVaultAssetBalance =
        await vaultAssetToken.balanceOf(collateralVaultAddr);
      const initialUserDStableBalance = await dStableToken.balanceOf(
        user.address,
      );

      expect(initialTotalSupply).to.equal(0n);
      expect(initialTotalAssets).to.equal(0n);
      expect(initialVaultAssetBalance).to.equal(0n);
      expect(initialUserDStableBalance).to.equal(0n);

      // Mint dStable to user and approve token to DStakeToken
      await stable.mint(user.address, depositAmount);
      await dStableToken
        .connect(user)
        .approve(await DStakeToken.getAddress(), depositAmount);

      // Perform deposit
      await expect(
        DStakeToken.connect(user).deposit(depositAmount, user.address),
      )
        .to.emit(DStakeToken, "Deposit")
        .withArgs(user.address, user.address, depositAmount, depositAmount);

      // Post-deposit checks
      const finalUserDStableBalance = await dStableToken.balanceOf(
        user.address,
      );
      expect(finalUserDStableBalance).to.equal(0n);

      const userShares = await DStakeToken.balanceOf(user.address);
      expect(userShares).to.equal(depositAmount);

      const finalTotalSupply = await DStakeToken.totalSupply();
      expect(finalTotalSupply).to.equal(depositAmount);

      const finalTotalAssets = await DStakeToken.totalAssets();
      expect(finalTotalAssets).to.equal(depositAmount);

      // Verify supply to dLEND via adapter
      const [, expectedVaultAssetAmount] =
        await adapter.previewConvertToVaultAsset(depositAmount);
      const finalVaultAssetBalance =
        await vaultAssetToken.balanceOf(collateralVaultAddr);
      expect(finalVaultAssetBalance).to.equal(expectedVaultAssetAmount);

      // Verify AAVE aToken minted via wrapper
      const staticWrapper = (await ethers.getContractAt(
        "IStaticATokenLM",
        vaultAssetAddress,
      )) as unknown as IStaticATokenLM;
      const aTokenAddress = await staticWrapper.aToken();
      const aTokenContract = (await ethers.getContractAt(
        "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
        aTokenAddress,
      )) as unknown as IERC20;
      const aTokenBalance = await aTokenContract.balanceOf(vaultAssetAddress);
      expect(aTokenBalance).to.equal(depositAmount);
    });
  });
});
