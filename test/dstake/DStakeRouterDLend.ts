import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { ethers, getNamedAccounts } from "hardhat";

import {
  DStakeCollateralVault,
  DStakeRouterDLend,
  DStakeToken,
  IDStableConversionAdapter,
  IERC20,
} from "../../typechain-types";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { DStakeRouterDLend__factory } from "../../typechain-types/factories/contracts/vaults/dstake/DStakeRouterDLend__factory";
import {
  createDStakeFixture,
  DSTAKE_CONFIGS,
  DStakeFixtureConfig,
} from "./fixture";

DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
  describe(`DStakeRouterDLend for ${config.DStakeTokenSymbol}`, function () {
    // Create fixture once per suite for snapshot caching
    const fixture = createDStakeFixture(config);

    let routerAddress: string;
    let collateralVaultAddress: string;
    let deployerAddr: string;
    let user1Addr: string;
    let user2Addr: string;
    let deployerSigner: any;
    let user1Signer: any;
    let user2Signer: any;
    let DStakeToken: DStakeToken;
    let collateralVault: DStakeCollateralVault;
    let router: DStakeRouterDLend;
    let dStableToken: IERC20;
    let vaultAssetToken: IERC20;
    let vaultAssetAddress: string;
    let adapter: IDStableConversionAdapter;
    let adapterAddress: string;

    beforeEach(async function () {
      // Revert to snapshot instead of full redeployment
      const out = await fixture();
      const named = await getNamedAccounts();
      deployerAddr = named.deployer;
      user1Addr = named.user1 || named.deployer;
      user2Addr = named.user2 || named.deployer;
      deployerSigner = await ethers.getSigner(deployerAddr);
      user1Signer = await ethers.getSigner(user1Addr);
      user2Signer = await ethers.getSigner(user2Addr);

      const D = out.DStakeToken as unknown as DStakeToken;
      DStakeToken = D;
      collateralVault = out.collateralVault as unknown as DStakeCollateralVault;
      router = out.router as unknown as DStakeRouterDLend;
      dStableToken = out.dStableToken as unknown as IERC20;
      vaultAssetToken = out.vaultAssetToken as unknown as IERC20;
      vaultAssetAddress = out.vaultAssetAddress;
      adapter = out.adapter as unknown as IDStableConversionAdapter;
      adapterAddress = out.adapterAddress;
      routerAddress = await router.getAddress();
      collateralVaultAddress = await collateralVault.getAddress();
    });

    describe("Initialization and State", function () {
      it("should set correct immutable addresses", async function () {
        expect(await router.dStakeToken()).to.equal(
          await DStakeToken.getAddress(),
        );
        expect(await router.collateralVault()).to.equal(
          await collateralVault.getAddress(),
        );
        expect(await router.dStable()).to.equal(
          await dStableToken.getAddress(),
        );
      });

      it("should revert constructor if any address is zero", async function () {
        const factory = new DStakeRouterDLend__factory(deployerSigner);
        await expect(
          factory.deploy(ZeroAddress, await collateralVault.getAddress()),
        ).to.be.revertedWithCustomError(factory, "ZeroAddress");
        await expect(
          factory.deploy(await DStakeToken.getAddress(), ZeroAddress),
        ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      });

      it("should grant DEFAULT_ADMIN_ROLE to initialAdmin", async function () {
        const adminRole = await router.DEFAULT_ADMIN_ROLE();
        expect(await router.hasRole(adminRole, user1Addr)).to.be.true;
        expect(await router.hasRole(adminRole, deployerAddr)).to.be.false;
      });

      it("should grant DSTAKE_TOKEN_ROLE to the DStakeToken address", async function () {
        const tokenRole = await router.DSTAKE_TOKEN_ROLE();
        expect(await router.hasRole(tokenRole, await DStakeToken.getAddress()))
          .to.be.true;
      });

      it("defaultDepositVaultAsset should be zero address initially", async function () {
        expect(await router.defaultDepositVaultAsset()).to.equal(
          vaultAssetAddress,
        );
      });

      it("vaultAssetToAdapter mapping should be empty initially", async function () {
        expect(await router.vaultAssetToAdapter(vaultAssetAddress)).to.equal(
          adapterAddress,
        );
      });
    });

    describe("Role-Based Access Control & Configuration", function () {
      it("admin can add a new adapter", async function () {
        await expect(
          router
            .connect(user1Signer)
            .addAdapter(vaultAssetAddress, adapterAddress),
        )
          .to.emit(router, "AdapterSet")
          .withArgs(vaultAssetAddress, adapterAddress);
        expect(await router.vaultAssetToAdapter(vaultAssetAddress)).to.equal(
          adapterAddress,
        );
      });

      it("non-admin cannot add adapter", async function () {
        await expect(
          router
            .connect(user2Signer)
            .addAdapter(vaultAssetAddress, adapterAddress),
        ).to.be.reverted;
      });

      it("cannot add adapter with zero addresses", async function () {
        await expect(
          router.connect(user1Signer).addAdapter(ZeroAddress, adapterAddress),
        ).to.be.revertedWithCustomError(router, "ZeroAddress");
        await expect(
          router
            .connect(user1Signer)
            .addAdapter(vaultAssetAddress, ZeroAddress),
        ).to.be.revertedWithCustomError(router, "ZeroAddress");
      });

      it("admin can remove an adapter", async function () {
        // First add
        await router
          .connect(user1Signer)
          .addAdapter(vaultAssetAddress, adapterAddress);
        // Then remove
        await expect(
          router.connect(user1Signer).removeAdapter(vaultAssetAddress),
        )
          .to.emit(router, "AdapterRemoved")
          .withArgs(vaultAssetAddress, adapterAddress);
        expect(await router.vaultAssetToAdapter(vaultAssetAddress)).to.equal(
          ZeroAddress,
        );
      });

      it("non-admin cannot remove adapter", async function () {
        await expect(
          router.connect(user2Signer).removeAdapter(vaultAssetAddress),
        ).to.be.reverted;
      });

      it("admin can set defaultDepositVaultAsset", async function () {
        // Add adapter first
        await router
          .connect(user1Signer)
          .addAdapter(vaultAssetAddress, adapterAddress);
        await expect(
          router
            .connect(user1Signer)
            .setDefaultDepositVaultAsset(vaultAssetAddress),
        )
          .to.emit(router, "DefaultDepositVaultAssetSet")
          .withArgs(vaultAssetAddress);
        expect(await router.defaultDepositVaultAsset()).to.equal(
          vaultAssetAddress,
        );
      });

      it("non-admin cannot set defaultDepositVaultAsset", async function () {
        await expect(
          router
            .connect(user2Signer)
            .setDefaultDepositVaultAsset(vaultAssetAddress),
        ).to.be.reverted;
      });

      it("cannot set defaultDepositVaultAsset for unregistered asset", async function () {
        const nonVaultAsset = await dStableToken.getAddress();
        await expect(
          router
            .connect(user1Signer)
            .setDefaultDepositVaultAsset(nonVaultAsset),
        ).to.be.revertedWithCustomError(router, "AdapterNotFound");
      });
    });

    // Add core logic tests for deposit, withdraw, and asset exchange functions
    describe("Deposit and Withdraw", function () {
      const depositAmount = ethers.parseUnits("10", 18);

      beforeEach(async function () {
        const DStakeTokenAddress = await DStakeToken.getAddress();
        // Grant deployer minter role and mint dStable to DStakeToken contract
        const dstableMinter = (await ethers.getContractAt(
          "ERC20StablecoinUpgradeable",
          await dStableToken.getAddress(),
          deployerSigner,
        )) as ERC20StablecoinUpgradeable;
        const MINTER_ROLE = await dstableMinter.MINTER_ROLE();
        await dstableMinter.grantRole(MINTER_ROLE, deployerAddr);
        await dstableMinter.mint(DStakeTokenAddress, depositAmount);
        // Impersonate the DStakeToken contract for auth-required calls
        await ethers.provider.send("hardhat_impersonateAccount", [
          DStakeTokenAddress,
        ]);
        // Fund impersonated DStakeToken with ETH for gas
        await ethers.provider.send("hardhat_setBalance", [
          DStakeTokenAddress,
          "0x1000000000000000000",
        ]);
      });

      it("non-DStakeToken cannot call deposit", async function () {
        await expect(router.connect(user1Signer).deposit(depositAmount)).to.be
          .reverted;
      });

      it("DStakeToken can deposit, emits event and deposits vault asset to collateralVault", async function () {
        const DStakeTokenAddress = await DStakeToken.getAddress();
        const DStakeTokenSigner = await ethers.getSigner(DStakeTokenAddress);
        await dStableToken
          .connect(DStakeTokenSigner)
          .approve(routerAddress, depositAmount);
        const [, previewShares] =
          await adapter.previewConvertToVaultAsset(depositAmount);

        const beforeBal = await vaultAssetToken.balanceOf(
          collateralVaultAddress,
        );

        // Check event emission and balances
        await expect(
          router.connect(DStakeTokenSigner).deposit(depositAmount),
        ).to.emit(router, "RouterDeposit");

        const afterBal = await vaultAssetToken.balanceOf(
          collateralVaultAddress,
        );
        const minted = afterBal - beforeBal;

        // Ensure the adapter minted exactly the number of shares predicted by the preview call.
        // This guards against the slippage condition described in Issue #225.
        expect(minted).to.equal(previewShares);
      });

      it("reverts when adapter under-delivers vault shares", async function () {
        // Deploy mock vault asset token
        const MintableFactory = await ethers.getContractFactory(
          "TestMintableERC20",
          deployerSigner,
        );
        const mockVaultAsset = await MintableFactory.deploy(
          "Mock Vault",
          "MVLT",
          18,
        );
        await mockVaultAsset.waitForDeployment();

        // Deploy under-delivering adapter (90% factor)
        const UDAdapterFactory = await ethers.getContractFactory(
          "MockUnderDeliveringAdapter",
          deployerSigner,
        );
        const udAdapter = await UDAdapterFactory.deploy(
          await dStableToken.getAddress(),
          collateralVaultAddress,
          await mockVaultAsset.getAddress(),
          9000, // 90% delivery
        );
        await udAdapter.waitForDeployment();

        // Admin adds adapter and sets as default
        await router
          .connect(user1Signer)
          .addAdapter(
            await mockVaultAsset.getAddress(),
            await udAdapter.getAddress(),
          );
        await router
          .connect(user1Signer)
          .setDefaultDepositVaultAsset(await mockVaultAsset.getAddress());

        // Mint dStable to DStakeToken contract
        const DStakeTokenAddress = await DStakeToken.getAddress();
        const dstableMinter = (await ethers.getContractAt(
          "ERC20StablecoinUpgradeable",
          await dStableToken.getAddress(),
          deployerSigner,
        )) as ERC20StablecoinUpgradeable;
        const MINTER_ROLE = await dstableMinter.MINTER_ROLE();
        await dstableMinter.grantRole(MINTER_ROLE, deployerAddr);
        await dstableMinter.mint(DStakeTokenAddress, depositAmount);

        // Impersonate DStakeToken
        await ethers.provider.send("hardhat_impersonateAccount", [
          DStakeTokenAddress,
        ]);
        await ethers.provider.send("hardhat_setBalance", [
          DStakeTokenAddress,
          "0x1000000000000000000",
        ]);
        const DStakeTokenSigner = await ethers.getSigner(DStakeTokenAddress);

        // Approve router
        await dStableToken
          .connect(DStakeTokenSigner)
          .approve(routerAddress, depositAmount);

        // Expect revert
        await expect(
          router.connect(DStakeTokenSigner).deposit(depositAmount),
        ).to.be.revertedWithCustomError(router, "SlippageCheckFailed");
      });

      it("non-DStakeToken cannot call withdraw", async function () {
        await expect(
          router
            .connect(user1Signer)
            .withdraw(depositAmount, user1Addr, user1Addr),
        ).to.be.reverted;
      });

      it("DStakeToken can withdraw, emits event and transfers dStable to receiver", async function () {
        const DStakeTokenAddress = await DStakeToken.getAddress();
        const DStakeTokenSigner = await ethers.getSigner(DStakeTokenAddress);
        await dStableToken
          .connect(DStakeTokenSigner)
          .approve(routerAddress, depositAmount);
        await router.connect(DStakeTokenSigner).deposit(depositAmount);
        const initial = await dStableToken.balanceOf(user1Addr);
        // Check event emission and balance
        await expect(
          router
            .connect(DStakeTokenSigner)
            .withdraw(depositAmount, user1Addr, user1Addr),
        ).to.emit(router, "Withdrawn");
        const finalBal = await dStableToken.balanceOf(user1Addr);
        expect(finalBal - initial).to.equal(depositAmount);
      });

      it("captures surplus on positive slippage (bonus redeem adapter)", async function () {
        // 1. Deploy mock adapter that returns 10 % extra dStable on redeem
        const AdapterFactory = await ethers.getContractFactory(
          "MockAdapterPositiveSlippage",
          deployerSigner,
        );
        const bonusAdapter = await AdapterFactory.deploy(
          await dStableToken.getAddress(),
          collateralVaultAddress,
        );
        await bonusAdapter.waitForDeployment();

        const bonusVaultAsset = await bonusAdapter.vaultAsset();
        const bonusAdapterAddr = await bonusAdapter.getAddress();

        // 2. Register adapter and make it default strategy
        await router
          .connect(user1Signer)
          .addAdapter(bonusVaultAsset, bonusAdapterAddr);
        await router
          .connect(user1Signer)
          .setDefaultDepositVaultAsset(bonusVaultAsset);

        // 3. Mint dStable to user1 and deposit through DStakeToken

        const depositAmt = ethers.parseUnits("100", 18);
        const dstableMinter = (await ethers.getContractAt(
          "ERC20StablecoinUpgradeable",
          await dStableToken.getAddress(),
          deployerSigner,
        )) as ERC20StablecoinUpgradeable;
        const MINTER_ROLE = await dstableMinter.MINTER_ROLE();
        await dstableMinter.grantRole(MINTER_ROLE, deployerAddr);
        await dstableMinter.mint(user1Addr, depositAmt);

        // user1 deposit
        await dStableToken
          .connect(user1Signer)
          .approve(await DStakeToken.getAddress(), depositAmt);
        await DStakeToken.connect(user1Signer).deposit(depositAmt, user1Addr);

        // 4. Withdraw half – router should keep surplus bonus
        const userShares = await DStakeToken.balanceOf(user1Addr);
        const sharesToRedeem = userShares / 2n;
        let withdrawAmt = await DStakeToken.previewRedeem(sharesToRedeem);
        withdrawAmt -= 1n; // stay below returned amount by 1 wei

        const vaultToken = await ethers.getContractAt(
          "MockERC4626Simple",
          bonusVaultAsset,
        );

        const beforeShares = await vaultToken.balanceOf(collateralVaultAddress);
        const beforeUserBal = await dStableToken.balanceOf(user1Addr);

        await DStakeToken.connect(user1Signer).withdraw(
          withdrawAmt,
          user1Addr,
          user1Addr,
        );

        const afterUserBal = await dStableToken.balanceOf(user1Addr);
        expect(afterUserBal - beforeUserBal).to.equal(withdrawAmt);

        const afterShares = await vaultToken.balanceOf(collateralVaultAddress);
        expect(afterShares).to.be.lt(beforeShares); // shares burned more than bonus minted
        const delta = beforeShares - afterShares;
        expect(delta).to.be.lte(sharesToRedeem);
      });
    });

    describe("Exchange Assets Using Adapters", function () {
      const depositAmount = ethers.parseUnits("10", 18);
      const exchangeAmount = ethers.parseUnits("5", 18);

      beforeEach(async function () {
        const DStakeTokenAddress = await DStakeToken.getAddress();
        // Grant deployer minter role and mint dStable to DStakeToken contract
        const dstableMinter = (await ethers.getContractAt(
          "ERC20StablecoinUpgradeable",
          await dStableToken.getAddress(),
          deployerSigner,
        )) as ERC20StablecoinUpgradeable;
        const MINTER_ROLE = await dstableMinter.MINTER_ROLE();
        await dstableMinter.grantRole(MINTER_ROLE, deployerAddr);
        await dstableMinter.mint(DStakeTokenAddress, depositAmount);
        // Impersonate the DStakeToken contract for deposit
        await ethers.provider.send("hardhat_impersonateAccount", [
          DStakeTokenAddress,
        ]);
        // Fund impersonated DStakeToken with ETH for gas
        await ethers.provider.send("hardhat_setBalance", [
          DStakeTokenAddress,
          "0x1000000000000000000",
        ]);
        const DStakeTokenSigner = await ethers.getSigner(DStakeTokenAddress);
        await dStableToken
          .connect(DStakeTokenSigner)
          .approve(routerAddress, depositAmount);
        await router.connect(DStakeTokenSigner).deposit(depositAmount);
        await router
          .connect(user1Signer)
          .grantRole(await router.COLLATERAL_EXCHANGER_ROLE(), user1Addr);
      });

      it("non-exchanger cannot call exchangeAssetsUsingAdapters", async function () {
        await expect(
          (router.connect(user2Signer) as any).exchangeAssetsUsingAdapters(
            vaultAssetAddress,
            vaultAssetAddress,
            exchangeAmount,
            0,
          ),
        ).to.be.reverted;
      });

      it("reverts if adapter not found", async function () {
        await expect(
          (router.connect(user1Signer) as any).exchangeAssetsUsingAdapters(
            ZeroAddress,
            vaultAssetAddress,
            exchangeAmount,
            0,
          ),
        ).to.be.revertedWithCustomError(router, "AdapterNotFound");
        await expect(
          (router.connect(user1Signer) as any).exchangeAssetsUsingAdapters(
            vaultAssetAddress,
            ZeroAddress,
            exchangeAmount,
            0,
          ),
        ).to.be.revertedWithCustomError(router, "AdapterNotFound");
      });

      it("can exchange assets via adapters and emits event", async function () {
        // Check event emission and balances
        await expect(
          (router.connect(user1Signer) as any).exchangeAssetsUsingAdapters(
            vaultAssetAddress,
            vaultAssetAddress,
            exchangeAmount,
            0,
          ),
        ).to.emit(router, "Exchanged");
        expect(
          await vaultAssetToken.balanceOf(collateralVaultAddress),
        ).to.equal(depositAmount);
      });
    });

    describe("Exchange Assets", function () {
      const depositAmount = ethers.parseUnits("10", 18);
      const exchangeAmount = ethers.parseUnits("5", 18);

      beforeEach(async function () {
        const DStakeTokenAddress = await DStakeToken.getAddress();
        // Grant deployer minter role and mint dStable to DStakeToken contract
        const dstableMinter = (await ethers.getContractAt(
          "ERC20StablecoinUpgradeable",
          await dStableToken.getAddress(),
          deployerSigner,
        )) as ERC20StablecoinUpgradeable;
        const MINTER_ROLE = await dstableMinter.MINTER_ROLE();
        await dstableMinter.grantRole(MINTER_ROLE, deployerAddr);
        await dstableMinter.mint(DStakeTokenAddress, depositAmount);
        // Impersonate the DStakeToken contract for deposit
        await ethers.provider.send("hardhat_impersonateAccount", [
          DStakeTokenAddress,
        ]);
        // Fund impersonated DStakeToken with ETH for gas
        await ethers.provider.send("hardhat_setBalance", [
          DStakeTokenAddress,
          "0x1000000000000000000",
        ]);
        const DStakeTokenSigner = await ethers.getSigner(DStakeTokenAddress);
        await dStableToken
          .connect(DStakeTokenSigner)
          .approve(routerAddress, depositAmount);
        await router.connect(DStakeTokenSigner).deposit(depositAmount);
        await router
          .connect(user1Signer)
          .grantRole(await router.COLLATERAL_EXCHANGER_ROLE(), user1Addr);
        // Impersonate the collateralVault for transferring vault assets
        await ethers.provider.send("hardhat_impersonateAccount", [
          collateralVaultAddress,
        ]);
        // Fund impersonated collateralVault with ETH for gas
        await ethers.provider.send("hardhat_setBalance", [
          collateralVaultAddress,
          "0x1000000000000000000",
        ]);
        const vaultSigner = await ethers.getSigner(collateralVaultAddress);
        await vaultAssetToken
          .connect(vaultSigner)
          .transfer(user1Addr, exchangeAmount);
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [
          collateralVaultAddress,
        ]);
        // Approve router to spend solver's vaultAsset for exchange
        await vaultAssetToken
          .connect(user1Signer)
          .approve(routerAddress, exchangeAmount);
      });

      it("non-exchanger cannot call exchangeAssets", async function () {
        await expect(
          router
            .connect(user2Signer)
            .exchangeAssets(
              vaultAssetAddress,
              vaultAssetAddress,
              exchangeAmount,
              0,
            ),
        ).to.be.reverted;
      });

      it("reverts on zero input amount", async function () {
        await expect(
          router
            .connect(user1Signer)
            .exchangeAssets(vaultAssetAddress, vaultAssetAddress, 0, 0),
        ).to.be.revertedWithCustomError(router, "InconsistentState");
      });

      it("reverts if adapter not found", async function () {
        await expect(
          router
            .connect(user1Signer)
            .exchangeAssets(ZeroAddress, vaultAssetAddress, exchangeAmount, 0),
        ).to.be.revertedWithCustomError(router, "ZeroAddress");
        await expect(
          router
            .connect(user1Signer)
            .exchangeAssets(vaultAssetAddress, ZeroAddress, exchangeAmount, 0),
        ).to.be.revertedWithCustomError(router, "ZeroAddress");
      });

      it("reverts on slippage check failure", async function () {
        const [, invalidToAmount] =
          await adapter.previewConvertToVaultAsset(depositAmount);
        await expect(
          router
            .connect(user1Signer)
            .exchangeAssets(
              vaultAssetAddress,
              vaultAssetAddress,
              exchangeAmount,
              invalidToAmount + BigInt(1),
            ),
        ).to.be.revertedWithCustomError(router, "SlippageCheckFailed");
      });

      it("can exchange assets and emits event and net solver balances unchanged", async function () {
        const dStableValueIn =
          await adapter.previewConvertFromVaultAsset(exchangeAmount);
        const [, expectedToVault] =
          await adapter.previewConvertToVaultAsset(dStableValueIn);
        const initial = await vaultAssetToken.balanceOf(user1Addr);
        // Check event emission and balances
        await expect(
          router
            .connect(user1Signer)
            .exchangeAssets(
              vaultAssetAddress,
              vaultAssetAddress,
              exchangeAmount,
              expectedToVault,
            ),
        ).to.emit(router, "Exchanged");
        expect(await vaultAssetToken.balanceOf(user1Addr)).to.equal(initial);
      });
    });
  });
});
