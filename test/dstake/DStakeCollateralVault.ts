import { ethers, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import {
  DStakeCollateralVault,
  DStakeToken,
  DStakeRouterDLend,
  IDStableConversionAdapter,
  ERC20,
  IERC20,
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  createDStakeFixture,
  DSTAKE_CONFIGS,
  DStakeFixtureConfig,
} from "./fixture"; // Use the specific fixture and import DSTAKE_CONFIGS
import { ZeroAddress } from "ethers"; // Import ZeroAddress
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";

// Helper function to parse units
const parseUnits = (value: string | number, decimals: number | bigint) =>
  ethers.parseUnits(value.toString(), decimals);

DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
  describe(`DStakeCollateralVault for ${config.DStakeTokenSymbol}`, () => {
    // Create fixture function once per suite for snapshot caching
    const fixture = createDStakeFixture(config);

    let deployer: SignerWithAddress;
    let stable: ERC20StablecoinUpgradeable;
    let user1: SignerWithAddress;
    let adminRole: string;
    let routerRole: string;

    // Fixture types
    let DStakeToken: DStakeToken;
    let collateralVault: DStakeCollateralVault;
    let router: DStakeRouterDLend;
    let dStableToken: ERC20;
    let dStableDecimals: bigint;
    let vaultAssetToken: IERC20;
    let vaultAssetAddress: string;
    let vaultAssetDecimals: bigint;
    let adapter: IDStableConversionAdapter | null; // Adapter can be null
    let adapterAddress: string;

    let DStakeTokenAddress: string;
    let dStableTokenAddress: string;
    let collateralVaultAddress: string;
    let routerAddress: string;
    // routerSigner will be an EOA (likely deployer) with ROUTER_ROLE
    let routerSigner: SignerWithAddress;

    // Load fixture before each test
    beforeEach(async function () {
      const namedAccounts = await getNamedAccounts();
      deployer = await ethers.getSigner(namedAccounts.deployer);
      user1 = await ethers.getSigner(
        namedAccounts.user1 || namedAccounts.deployer
      );

      // Revert to snapshot instead of redeploying
      const out = await fixture();

      DStakeToken = out.DStakeToken as unknown as DStakeToken;
      collateralVault = out.collateralVault as unknown as DStakeCollateralVault;
      router = out.router as unknown as DStakeRouterDLend;
      dStableToken = out.dStableToken;
      dStableDecimals = await dStableToken.decimals();
      vaultAssetToken = out.vaultAssetToken;
      vaultAssetAddress = out.vaultAssetAddress;
      adapter = out.adapter as unknown as IDStableConversionAdapter | null;
      adapterAddress = out.adapterAddress;

      DStakeTokenAddress = await DStakeToken.getAddress();
      dStableTokenAddress = await dStableToken.getAddress();
      // Get the native stablecoin contract to grant mint role
      stable = (await ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dStableTokenAddress,
        deployer
      )) as ERC20StablecoinUpgradeable;
      // Grant MINTER_ROLE to deployer so tests can mint dStable
      const minterRole = await stable.MINTER_ROLE();
      await stable.grantRole(minterRole, deployer.address);
      collateralVaultAddress = await collateralVault.getAddress();
      routerAddress = await router.getAddress();

      if (vaultAssetAddress !== ZeroAddress && vaultAssetToken) {
        const tempVaultAsset = await ethers.getContractAt(
          "@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20",
          vaultAssetAddress
        );
        vaultAssetDecimals = await tempVaultAsset.decimals();
      } else {
        vaultAssetDecimals = 18n;
      }

      adminRole = await collateralVault.DEFAULT_ADMIN_ROLE();
      routerRole = await collateralVault.ROUTER_ROLE();

      if ((await collateralVault.router()) !== routerAddress) {
        await collateralVault.connect(deployer).setRouter(routerAddress);
      }

      if (!(await collateralVault.hasRole(routerRole, deployer.address))) {
        await collateralVault
          .connect(deployer)
          .grantRole(routerRole, deployer.address);
      }
      routerSigner = deployer;

      expect(await collateralVault.dStakeToken()).to.equal(DStakeTokenAddress);
      expect(await collateralVault.dStable()).to.equal(dStableTokenAddress);
      expect(await collateralVault.hasRole(adminRole, deployer.address)).to.be
        .true;

      if (adapter) {
        expect(adapterAddress).to.not.equal(ZeroAddress);
        expect(await adapter.vaultAsset()).to.equal(vaultAssetAddress);
      } else {
        expect(
          await collateralVault.adapterForAsset(vaultAssetAddress)
        ).to.equal(ZeroAddress);
      }
    });

    describe("Initialization & Deployment State (from fixture)", () => {
      it("Should have deployed the vault correctly", async function () {
        expect(collateralVaultAddress).to.not.equal(ZeroAddress);
      });

      it("Should have set immutable state correctly (DStakeToken, dStable)", async function () {
        expect(await collateralVault.dStakeToken()).to.equal(
          DStakeTokenAddress
        );
        expect(await collateralVault.dStable()).to.equal(dStableTokenAddress);
      });

      it("Should grant DEFAULT_ADMIN_ROLE to deployer", async function () {
        expect(await collateralVault.hasRole(adminRole, deployer.address)).to.be
          .true;
      });

      it("Router should be set as per beforeEach setup", async function () {
        expect(await collateralVault.router()).to.equal(routerAddress);
        expect(await collateralVault.hasRole(routerRole, routerAddress)).to.be
          .true;
      });
    });

    describe("Router Management (setRouter)", () => {
      it("Should only allow admin to set router", async function () {
        if (await collateralVault.hasRole(adminRole, user1.address)) {
          await collateralVault
            .connect(deployer)
            .revokeRole(adminRole, user1.address);
        }
        await expect(
          collateralVault.connect(user1).setRouter(routerAddress)
        ).to.be.revertedWithCustomError(
          collateralVault,
          "AccessControlUnauthorizedAccount"
        );

        await expect(collateralVault.connect(deployer).setRouter(routerAddress))
          .to.not.be.reverted;
      });

      it("Should revert if setting router to zero address", async function () {
        await expect(
          collateralVault.connect(deployer).setRouter(ZeroAddress)
        ).to.be.revertedWithCustomError(collateralVault, "ZeroAddress");
      });

      it("Should set and replace the router correctly, managing ROUTER_ROLE", async function () {
        const newRouterAddress = user1.address;

        await expect(
          collateralVault.connect(deployer).setRouter(newRouterAddress)
        )
          .to.emit(collateralVault, "RouterSet")
          .withArgs(newRouterAddress);
        expect(await collateralVault.router()).to.equal(newRouterAddress);
        expect(await collateralVault.hasRole(routerRole, newRouterAddress)).to
          .be.true;
        expect(await collateralVault.hasRole(routerRole, routerAddress)).to.be
          .false;

        await expect(collateralVault.connect(deployer).setRouter(routerAddress))
          .to.emit(collateralVault, "RouterSet")
          .withArgs(routerAddress);
        expect(await collateralVault.router()).to.equal(routerAddress);
        expect(await collateralVault.hasRole(routerRole, routerAddress)).to.be
          .true;
        expect(await collateralVault.hasRole(routerRole, newRouterAddress)).to
          .be.false;
      });
    });

    describe("Adapter Management", function () {
      let testAdapterAddress: string;
      let testVaultAssetAddress: string;

      beforeEach(async function () {
        testVaultAssetAddress = vaultAssetAddress;
        testAdapterAddress = adapterAddress;

        if (
          (await collateralVault.adapterForAsset(testVaultAssetAddress)) !==
          ZeroAddress
        ) {
          const balance = await vaultAssetToken.balanceOf(
            collateralVaultAddress
          );
          if (balance > 0n) {
            await collateralVault
              .connect(routerSigner)
              .sendAsset(testVaultAssetAddress, balance, deployer.address);
          }
          await collateralVault
            .connect(deployer)
            .removeAdapter(testVaultAssetAddress);
        }
        expect(
          await collateralVault.adapterForAsset(testVaultAssetAddress)
        ).to.equal(ZeroAddress);
      });

      it("Should only allow admin to add/remove adapter", async function () {
        if (!adapter) this.skip();

        if (await collateralVault.hasRole(adminRole, user1.address)) {
          await collateralVault
            .connect(deployer)
            .revokeRole(adminRole, user1.address);
        }

        await expect(
          collateralVault
            .connect(user1)
            .addAdapter(testVaultAssetAddress, testAdapterAddress)
        ).to.be.revertedWithCustomError(
          collateralVault,
          "AccessControlUnauthorizedAccount"
        );

        await collateralVault
          .connect(deployer)
          .addAdapter(testVaultAssetAddress, testAdapterAddress);

        await expect(
          collateralVault.connect(user1).removeAdapter(testVaultAssetAddress)
        ).to.be.revertedWithCustomError(
          collateralVault,
          "AccessControlUnauthorizedAccount"
        );

        await expect(
          collateralVault.connect(deployer).removeAdapter(testVaultAssetAddress)
        ).to.not.be.reverted;
      });

      it("addAdapter: Should revert for zero addresses", async function () {
        if (!adapter) this.skip();
        await expect(
          collateralVault
            .connect(deployer)
            .addAdapter(testVaultAssetAddress, ZeroAddress)
        ).to.be.revertedWithCustomError(collateralVault, "ZeroAddress");
        await expect(
          collateralVault
            .connect(deployer)
            .addAdapter(ZeroAddress, testAdapterAddress)
        ).to.be.revertedWithCustomError(collateralVault, "ZeroAddress");
      });

      it("addAdapter: Should revert for invalid adapter (EOA)", async function () {
        const eoaAddress = user1.address;
        await expect(
          collateralVault
            .connect(deployer)
            .addAdapter(testVaultAssetAddress, eoaAddress)
        ).to.be.reverted;
      });

      it("addAdapter: Should revert on adapter asset mismatch", async function () {
        if (!adapter) this.skip();
        const differentAssetAddress = dStableTokenAddress;

        await expect(
          collateralVault
            .connect(deployer)
            .addAdapter(differentAssetAddress, testAdapterAddress)
        )
          .to.be.revertedWithCustomError(collateralVault, "AdapterMismatch")
          .withArgs(differentAssetAddress, testVaultAssetAddress);
      });

      it("addAdapter: Should add a valid adapter correctly", async function () {
        if (!adapter) this.skip();

        await expect(
          collateralVault
            .connect(deployer)
            .addAdapter(testVaultAssetAddress, testAdapterAddress)
        )
          .to.emit(collateralVault, "AdapterAdded")
          .withArgs(testVaultAssetAddress, testAdapterAddress);

        expect(
          await collateralVault.adapterForAsset(testVaultAssetAddress)
        ).to.equal(testAdapterAddress);

        let found = false;
        let idx = 0;
        try {
          while (true) {
            const asset = await collateralVault.supportedAssets(idx);
            if (asset === testVaultAssetAddress) {
              found = true;
              break;
            }
            idx++;
          }
        } catch (e) {
          // Reached end of array
        }
        expect(found).to.be.true;
      });

      it("addAdapter: Should revert when adding a duplicate asset", async function () {
        if (!adapter) this.skip();
        await collateralVault
          .connect(deployer)
          .addAdapter(testVaultAssetAddress, testAdapterAddress);
        await expect(
          collateralVault
            .connect(deployer)
            .addAdapter(testVaultAssetAddress, testAdapterAddress)
        )
          .to.be.revertedWithCustomError(
            collateralVault,
            "AssetAlreadySupported"
          )
          .withArgs(testVaultAssetAddress);
      });

      it("removeAdapter: Should revert if asset not supported", async function () {
        const nonSupportedAsset = user1.address;
        await expect(
          collateralVault.connect(deployer).removeAdapter(nonSupportedAsset)
        )
          .to.be.revertedWithCustomError(collateralVault, "AssetNotSupported")
          .withArgs(nonSupportedAsset);
      });

      it("removeAdapter: Should revert if vault has non-zero balance of asset", async function () {
        if (!adapter) this.skip();
        await collateralVault
          .connect(deployer)
          .addAdapter(testVaultAssetAddress, testAdapterAddress);

        const dStableAmountToDeposit = parseUnits("100", dStableDecimals);
        // Mint dStable for deployer
        await stable.mint(deployer.address, dStableAmountToDeposit);
        // Approve DStakeToken to spend dStable for deposit
        await dStableToken
          .connect(deployer)
          .approve(DStakeTokenAddress, dStableAmountToDeposit);
        // Deposit via DStakeToken to fund collateral vault
        await DStakeToken.connect(deployer).deposit(
          dStableAmountToDeposit,
          deployer.address
        );
        const amount = await vaultAssetToken.balanceOf(collateralVaultAddress);

        expect(amount).to.be.gt(0);

        // Should revert removal when vault has non-zero balance
        await expect(
          collateralVault.connect(deployer).removeAdapter(testVaultAssetAddress)
        )
          .to.be.revertedWithCustomError(collateralVault, "NonZeroBalance")
          .withArgs(testVaultAssetAddress);

        // Cleanup: send asset back to deployer
        await collateralVault
          .connect(routerSigner)
          .sendAsset(testVaultAssetAddress, amount, deployer.address);
      });

      it("removeAdapter: Should remove adapter correctly when balance is zero", async function () {
        if (!adapter) this.skip();
        await collateralVault
          .connect(deployer)
          .addAdapter(testVaultAssetAddress, testAdapterAddress);
        expect(
          await vaultAssetToken.balanceOf(collateralVaultAddress)
        ).to.equal(0);

        await expect(
          collateralVault.connect(deployer).removeAdapter(testVaultAssetAddress)
        )
          .to.emit(collateralVault, "AdapterRemoved")
          .withArgs(testVaultAssetAddress);

        expect(
          await collateralVault.adapterForAsset(testVaultAssetAddress)
        ).to.equal(ZeroAddress);

        let found = false;
        let idx = 0;
        try {
          while (true) {
            const asset = await collateralVault.supportedAssets(idx);
            if (asset === testVaultAssetAddress) {
              found = true;
              break;
            }
            idx++;
          }
        } catch (e) {
          // Reached end of array
        }
        expect(found).to.be.false;
      });
    });

    describe("Asset Transfer (sendAsset)", function () {
      const amountToSend = parseUnits("1", 18);

      beforeEach(async function () {
        if (!adapter) {
          this.skip();
        }

        if (
          (await collateralVault.adapterForAsset(vaultAssetAddress)) ===
          ZeroAddress
        ) {
          await collateralVault
            .connect(deployer)
            .addAdapter(vaultAssetAddress, adapterAddress);
        }

        const currentVaultBalance = await vaultAssetToken.balanceOf(
          collateralVaultAddress
        );
        if (currentVaultBalance < amountToSend) {
          const dStableDepositAmount = parseUnits("100", dStableDecimals);
          // Mint dStable for deployer
          await stable.mint(deployer.address, dStableDepositAmount);
          // Approve DStakeToken to spend dStable for deposit
          await dStableToken
            .connect(deployer)
            .approve(DStakeTokenAddress, dStableDepositAmount);
          // Deposit via DStakeToken to fund collateral vault
          await DStakeToken.connect(deployer).deposit(
            dStableDepositAmount,
            deployer.address
          );
        }
        if (
          (await vaultAssetToken.balanceOf(collateralVaultAddress)) <
          amountToSend
        ) {
          console.warn(
            `Vault has insufficient balance for sendAsset tests. Some tests might fail or be skipped.`
          );
        }
      });

      it("Should only allow router (via routerSigner) to send assets", async function () {
        if (
          (await vaultAssetToken.balanceOf(collateralVaultAddress)) <
          amountToSend
        )
          this.skip();

        const recipient = user1.address;
        await expect(
          collateralVault
            .connect(user1)
            .sendAsset(vaultAssetAddress, amountToSend, recipient)
        ).to.be.revertedWithCustomError(
          collateralVault,
          "AccessControlUnauthorizedAccount"
        );

        await expect(
          collateralVault
            .connect(routerSigner)
            .sendAsset(vaultAssetAddress, amountToSend, recipient)
        ).to.not.be.reverted;
      });

      it("Should transfer asset correctly", async function () {
        if (
          (await vaultAssetToken.balanceOf(collateralVaultAddress)) <
          amountToSend
        )
          this.skip();

        const recipient = user1.address;
        const initialVaultBalance = await vaultAssetToken.balanceOf(
          collateralVaultAddress
        );
        const initialRecipientBalance =
          await vaultAssetToken.balanceOf(recipient);

        await collateralVault
          .connect(routerSigner)
          .sendAsset(vaultAssetAddress, amountToSend, recipient);

        const finalVaultBalance = await vaultAssetToken.balanceOf(
          collateralVaultAddress
        );
        const finalRecipientBalance =
          await vaultAssetToken.balanceOf(recipient);

        expect(finalVaultBalance).to.equal(initialVaultBalance - amountToSend);
        expect(finalRecipientBalance).to.equal(
          initialRecipientBalance + amountToSend
        );
      });

      it("Should revert on insufficient balance", async function () {
        const recipient = user1.address;
        const vaultBalance = await vaultAssetToken.balanceOf(
          collateralVaultAddress
        );
        const attemptToSend =
          vaultBalance + parseUnits("1", vaultAssetDecimals);

        await expect(
          collateralVault
            .connect(routerSigner)
            .sendAsset(vaultAssetAddress, attemptToSend, recipient)
        ).to.be.reverted;
      });

      it("Should revert if asset is not supported", async function () {
        const nonSupportedAsset = dStableTokenAddress;
        const recipient = user1.address;
        await expect(
          collateralVault
            .connect(routerSigner)
            .sendAsset(nonSupportedAsset, amountToSend, recipient)
        )
          .to.be.revertedWithCustomError(collateralVault, "AssetNotSupported")
          .withArgs(nonSupportedAsset);
      });
    });

    describe("Value Calculation (totalValueInDStable)", function () {
      beforeEach(async function () {
        if (
          (await collateralVault.adapterForAsset(vaultAssetAddress)) !==
          ZeroAddress
        ) {
          const balance = await vaultAssetToken.balanceOf(
            collateralVaultAddress
          );
          if (balance > 0n) {
            await collateralVault
              .connect(routerSigner)
              .sendAsset(vaultAssetAddress, balance, deployer.address);
          }
          await collateralVault
            .connect(deployer)
            .removeAdapter(vaultAssetAddress);
        }
      });

      it("Should return 0 if no assets are supported", async function () {
        expect(await collateralVault.totalValueInDStable()).to.equal(0);
      });

      it("Should return 0 if supported asset has zero balance", async function () {
        if (!adapter) this.skip();
        await collateralVault
          .connect(deployer)
          .addAdapter(vaultAssetAddress, adapterAddress);
        expect(
          await vaultAssetToken.balanceOf(collateralVaultAddress)
        ).to.equal(0);
        expect(await collateralVault.totalValueInDStable()).to.equal(0);
      });

      it("Should return correct value for a single asset with balance", async function () {
        if (!adapter) this.skip();
        await collateralVault
          .connect(deployer)
          .addAdapter(vaultAssetAddress, adapterAddress);

        const dStableDepositAmount = parseUnits("100", dStableDecimals);
        // Mint dStable for deployer
        await stable.mint(deployer.address, dStableDepositAmount);
        // Approve DStakeToken to spend dStable for deposit
        await dStableToken
          .connect(deployer)
          .approve(DStakeTokenAddress, dStableDepositAmount);
        // Deposit via DStakeToken to fund collateral vault
        await DStakeToken.connect(deployer).deposit(
          dStableDepositAmount,
          deployer.address
        );

        const vaultBalance = await vaultAssetToken.balanceOf(
          collateralVaultAddress
        );
        expect(vaultBalance).to.be.gt(0);

        const expectedValue = await adapter!.assetValueInDStable(
          vaultAssetAddress,
          vaultBalance
        );
        const actualValue = await collateralVault.totalValueInDStable();
        expect(actualValue).to.equal(expectedValue);

        await collateralVault
          .connect(routerSigner)
          .sendAsset(vaultAssetAddress, vaultBalance, deployer.address);
      });

      it("Should sum values correctly for multiple supported assets (if possible to set up)", async function () {
        this.skip();
      });

      it("Should return 0 after asset balance is removed and adapter is removed", async function () {
        if (!adapter) this.skip();
        await collateralVault
          .connect(deployer)
          .addAdapter(vaultAssetAddress, adapterAddress);

        const dStableDepositAmount = parseUnits("100", dStableDecimals);
        // Mint dStable for deployer
        await stable.mint(deployer.address, dStableDepositAmount);
        // Approve DStakeToken to spend dStable for deposit
        await dStableToken
          .connect(deployer)
          .approve(DStakeTokenAddress, dStableDepositAmount);
        // Deposit via DStakeToken to fund collateral vault
        await DStakeToken.connect(deployer).deposit(
          dStableDepositAmount,
          deployer.address
        );

        expect(await collateralVault.totalValueInDStable()).to.be.gt(0);

        // Send all vault asset back to deployer
        const vaultBalanceForRemoval = await vaultAssetToken.balanceOf(
          collateralVaultAddress
        );
        await collateralVault
          .connect(routerSigner)
          .sendAsset(
            vaultAssetAddress,
            vaultBalanceForRemoval,
            deployer.address
          );
        expect(await collateralVault.totalValueInDStable()).to.equal(0);

        await collateralVault
          .connect(deployer)
          .removeAdapter(vaultAssetAddress);
        expect(await collateralVault.totalValueInDStable()).to.equal(0);
      });
    });
  });
});
