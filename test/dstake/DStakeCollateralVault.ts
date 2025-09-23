import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ZeroAddress } from "ethers"; // Import ZeroAddress
import { ethers, getNamedAccounts } from "hardhat";

import { DStakeCollateralVault, DStakeRouterDLend, DStakeToken, ERC20, IDStableConversionAdapter, IERC20 } from "../../typechain-types";
import { ERC20StablecoinUpgradeable } from "../../typechain-types/contracts/dstable/ERC20StablecoinUpgradeable";
import { createDStakeFixture, DSTAKE_CONFIGS, DStakeFixtureConfig } from "./fixture"; // Use the specific fixture and import DSTAKE_CONFIGS

// Helper function to parse units
const parseUnits = (value: string | number, decimals: number | bigint) => ethers.parseUnits(value.toString(), decimals);

DSTAKE_CONFIGS.forEach((config: DStakeFixtureConfig) => {
  describe(`DStakeCollateralVault for ${config.DStakeTokenSymbol}`, () => {
    // Create fixture function once per suite for snapshot caching
    const fixture = createDStakeFixture(config);

    let deployer: SignerWithAddress;
    let stable: ERC20StablecoinUpgradeable;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
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
      user1 = await ethers.getSigner(namedAccounts.user1);
      user2 = await ethers.getSigner(namedAccounts.user2);

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
      stable = (await ethers.getContractAt("ERC20StablecoinUpgradeable", dStableTokenAddress, deployer)) as ERC20StablecoinUpgradeable;
      // Grant MINTER_ROLE to deployer so tests can mint dStable
      const minterRole = await stable.MINTER_ROLE();
      await stable.grantRole(minterRole, deployer.address);
      collateralVaultAddress = await collateralVault.getAddress();
      routerAddress = await router.getAddress();

      if (vaultAssetAddress !== ZeroAddress && vaultAssetToken) {
        const tempVaultAsset = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", vaultAssetAddress);
        vaultAssetDecimals = await tempVaultAsset.decimals();
      } else {
        vaultAssetDecimals = 18n;
      }

      adminRole = await collateralVault.DEFAULT_ADMIN_ROLE();
      routerRole = await collateralVault.ROUTER_ROLE();

      if ((await collateralVault.router()) !== routerAddress) {
        await collateralVault.connect(user1).setRouter(routerAddress);
      }

      if (!(await collateralVault.hasRole(routerRole, deployer.address))) {
        await collateralVault.connect(user1).grantRole(routerRole, deployer.address);
      }
      routerSigner = deployer;

      expect(await collateralVault.dStakeToken()).to.equal(DStakeTokenAddress);
      expect(await collateralVault.dStable()).to.equal(dStableTokenAddress);
      expect(await collateralVault.hasRole(adminRole, user1.address)).to.be.true;
      expect(await collateralVault.hasRole(adminRole, deployer.address)).to.be.false;

      if (adapter) {
        expect(adapterAddress).to.not.equal(ZeroAddress);
        expect(await adapter.vaultAsset()).to.equal(vaultAssetAddress);
      } else {
        expect(await router.vaultAssetToAdapter(vaultAssetAddress)).to.equal(ZeroAddress);
      }
    });

    describe("Initialization & Deployment State (from fixture)", () => {
      it("Should have deployed the vault correctly", async function () {
        expect(collateralVaultAddress).to.not.equal(ZeroAddress);
      });

      it("Should have set immutable state correctly (DStakeToken, dStable)", async function () {
        expect(await collateralVault.dStakeToken()).to.equal(DStakeTokenAddress);
        expect(await collateralVault.dStable()).to.equal(dStableTokenAddress);
      });

      it("Should grant DEFAULT_ADMIN_ROLE to initialAdmin", async function () {
        expect(await collateralVault.hasRole(adminRole, user1.address)).to.be.true;
        expect(await collateralVault.hasRole(adminRole, deployer.address)).to.be.false;
      });

      it("Router should be set as per beforeEach setup", async function () {
        expect(await collateralVault.router()).to.equal(routerAddress);
        expect(await collateralVault.hasRole(routerRole, routerAddress)).to.be.true;
      });
    });

    describe("Router Management (setRouter)", () => {
      it("Should only allow admin to set router", async function () {
        await expect(collateralVault.connect(user2).setRouter(routerAddress)).to.be.revertedWithCustomError(
          collateralVault,
          "AccessControlUnauthorizedAccount",
        );

        await expect(collateralVault.connect(user1).setRouter(routerAddress)).to.not.be.reverted;
      });

      it("Should revert if setting router to zero address", async function () {
        await expect(collateralVault.connect(user1).setRouter(ZeroAddress)).to.be.revertedWithCustomError(collateralVault, "ZeroAddress");
      });

      it("Should set and replace the router correctly, managing ROUTER_ROLE", async function () {
        const newRouterAddress = user1.address;

        await expect(collateralVault.connect(user1).setRouter(newRouterAddress))
          .to.emit(collateralVault, "RouterSet")
          .withArgs(newRouterAddress);
        expect(await collateralVault.router()).to.equal(newRouterAddress);
        expect(await collateralVault.hasRole(routerRole, newRouterAddress)).to.be.true;
        expect(await collateralVault.hasRole(routerRole, routerAddress)).to.be.false;

        await expect(collateralVault.connect(user1).setRouter(routerAddress)).to.emit(collateralVault, "RouterSet").withArgs(routerAddress);
        expect(await collateralVault.router()).to.equal(routerAddress);
        expect(await collateralVault.hasRole(routerRole, routerAddress)).to.be.true;
        expect(await collateralVault.hasRole(routerRole, newRouterAddress)).to.be.false;
      });
    });

    describe("Asset Transfer (sendAsset)", function () {
      const amountToSend = parseUnits("1", 18);

      beforeEach(async function () {
        if (!adapter) {
          this.skip();
        }

        if ((await router.vaultAssetToAdapter(vaultAssetAddress)) === ZeroAddress) {
          await router.connect(user1).addAdapter(vaultAssetAddress, adapterAddress);
        }

        const currentVaultBalance = await vaultAssetToken.balanceOf(collateralVaultAddress);

        if (currentVaultBalance < amountToSend) {
          const dStableDepositAmount = parseUnits("100", dStableDecimals);
          // Mint dStable for deployer
          await stable.mint(deployer.address, dStableDepositAmount);
          // Approve DStakeToken to spend dStable for deposit
          await dStableToken.connect(deployer).approve(DStakeTokenAddress, dStableDepositAmount);
          // Deposit via DStakeToken to fund collateral vault
          await DStakeToken.connect(deployer).deposit(dStableDepositAmount, deployer.address);
        }

        if ((await vaultAssetToken.balanceOf(collateralVaultAddress)) < amountToSend) {
          console.warn(`Vault has insufficient balance for sendAsset tests. Some tests might fail or be skipped.`);
        }
      });

      it("Should only allow router (via routerSigner) to send assets", async function () {
        if ((await vaultAssetToken.balanceOf(collateralVaultAddress)) < amountToSend) this.skip();

        const recipient = user1.address;
        await expect(collateralVault.connect(user1).sendAsset(vaultAssetAddress, amountToSend, recipient)).to.be.revertedWithCustomError(
          collateralVault,
          "AccessControlUnauthorizedAccount",
        );

        await expect(collateralVault.connect(routerSigner).sendAsset(vaultAssetAddress, amountToSend, recipient)).to.not.be.reverted;
      });

      it("Should transfer asset correctly", async function () {
        if ((await vaultAssetToken.balanceOf(collateralVaultAddress)) < amountToSend) this.skip();

        const recipient = user1.address;
        const initialVaultBalance = await vaultAssetToken.balanceOf(collateralVaultAddress);
        const initialRecipientBalance = await vaultAssetToken.balanceOf(recipient);

        await collateralVault.connect(routerSigner).sendAsset(vaultAssetAddress, amountToSend, recipient);

        const finalVaultBalance = await vaultAssetToken.balanceOf(collateralVaultAddress);
        const finalRecipientBalance = await vaultAssetToken.balanceOf(recipient);

        expect(finalVaultBalance).to.equal(initialVaultBalance - amountToSend);
        expect(finalRecipientBalance).to.equal(initialRecipientBalance + amountToSend);
      });

      it("Should revert on insufficient balance", async function () {
        const recipient = user1.address;
        const vaultBalance = await vaultAssetToken.balanceOf(collateralVaultAddress);
        const attemptToSend = vaultBalance + parseUnits("1", vaultAssetDecimals);

        await expect(collateralVault.connect(routerSigner).sendAsset(vaultAssetAddress, attemptToSend, recipient)).to.be.reverted;
      });

      it("Should revert if asset is not supported", async function () {
        const nonSupportedAsset = dStableTokenAddress;
        const recipient = user1.address;
        await expect(collateralVault.connect(routerSigner).sendAsset(nonSupportedAsset, amountToSend, recipient))
          .to.be.revertedWithCustomError(collateralVault, "AssetNotSupported")
          .withArgs(nonSupportedAsset);
      });
    });

    describe("Value Calculation (totalValueInDStable)", function () {
      beforeEach(async function () {
        const currentAdapter = await router.vaultAssetToAdapter(vaultAssetAddress);

        if (currentAdapter !== ZeroAddress) {
          const balance = await vaultAssetToken.balanceOf(collateralVaultAddress);

          if (balance > 0n) {
            await collateralVault.connect(routerSigner).sendAsset(vaultAssetAddress, balance, deployer.address);
          }
          await router.connect(user1).removeAdapter(vaultAssetAddress);
        }
      });

      it("Should return 0 if no assets are supported", async function () {
        expect(await collateralVault.totalValueInDStable()).to.equal(0);
      });

      it("Should return 0 if supported asset has zero balance", async function () {
        if (!adapter) this.skip();
        await router.connect(user1).addAdapter(vaultAssetAddress, adapterAddress);
        expect(await vaultAssetToken.balanceOf(collateralVaultAddress)).to.equal(0);
        expect(await collateralVault.totalValueInDStable()).to.equal(0);
      });

      it("Should return correct value for a single asset with balance", async function () {
        if (!adapter) this.skip();
        await router.connect(user1).addAdapter(vaultAssetAddress, adapterAddress);

        const dStableDepositAmount = parseUnits("100", dStableDecimals);
        // Mint dStable for deployer
        await stable.mint(deployer.address, dStableDepositAmount);
        // Approve DStakeToken to spend dStable for deposit
        await dStableToken.connect(deployer).approve(DStakeTokenAddress, dStableDepositAmount);
        // Deposit via DStakeToken to fund collateral vault
        await DStakeToken.connect(deployer).deposit(dStableDepositAmount, deployer.address);

        const vaultBalance = await vaultAssetToken.balanceOf(collateralVaultAddress);
        expect(vaultBalance).to.be.gt(0);

        const expectedValue = await adapter!.assetValueInDStable(vaultAssetAddress, vaultBalance);
        const actualValue = await collateralVault.totalValueInDStable();
        expect(actualValue).to.equal(expectedValue);

        await router.connect(user1).removeAdapter(vaultAssetAddress);
      });

      it("Should sum values correctly for multiple supported assets (if possible to set up)", async function () {
        this.skip();
      });

      it("Should return 0 after asset balance is removed and adapter is removed", async function () {
        if (!adapter) this.skip();
        await router.connect(user1).addAdapter(vaultAssetAddress, adapterAddress);

        const dStableDepositAmount = parseUnits("100", dStableDecimals);
        // Mint dStable for deployer
        await stable.mint(deployer.address, dStableDepositAmount);
        // Approve DStakeToken to spend dStable for deposit
        await dStableToken.connect(deployer).approve(DStakeTokenAddress, dStableDepositAmount);
        // Deposit via DStakeToken to fund collateral vault
        await DStakeToken.connect(deployer).deposit(dStableDepositAmount, deployer.address);

        expect(await collateralVault.totalValueInDStable()).to.be.gt(0);

        // Send all vault asset back to deployer
        const vaultBalanceForRemoval = await vaultAssetToken.balanceOf(collateralVaultAddress);
        await collateralVault.connect(routerSigner).sendAsset(vaultAssetAddress, vaultBalanceForRemoval, deployer.address);
        expect(await collateralVault.totalValueInDStable()).to.equal(0);

        await router.connect(user1).removeAdapter(vaultAssetAddress);
        expect(await collateralVault.totalValueInDStable()).to.equal(0);
      });
    });

    describe("Supported Asset Removal without Zero Balance", function () {
      beforeEach(async function () {
        if (!adapter) {
          this.skip();
        }

        // Ensure adapter added
        if ((await router.vaultAssetToAdapter(vaultAssetAddress)) === ZeroAddress) {
          await router.connect(user1).addAdapter(vaultAssetAddress, adapterAddress);
        }
        // Ensure vault holds a positive balance of the asset
        const currentBal = await vaultAssetToken.balanceOf(collateralVaultAddress);

        if (currentBal === 0n) {
          const depositAmount = ethers.parseUnits("100", dStableDecimals);
          await stable.mint(deployer.address, depositAmount);
          await dStableToken.connect(deployer).approve(DStakeTokenAddress, depositAmount);
          await DStakeToken.connect(deployer).deposit(depositAmount, deployer.address);
          expect(await vaultAssetToken.balanceOf(collateralVaultAddress)).to.be.gt(0n);
        }
      });

      it("Should allow removeSupportedAsset even when balance > 0", async function () {
        // Verify balance > 0
        const balBefore = await vaultAssetToken.balanceOf(collateralVaultAddress);
        expect(balBefore).to.be.gt(0n);

        // Remove supported asset via routerSigner
        await expect(collateralVault.connect(routerSigner).removeSupportedAsset(vaultAssetAddress))
          .to.emit(collateralVault, "SupportedAssetRemoved")
          .withArgs(vaultAssetAddress);

        // Asset should no longer be in supported list
        const supported = await collateralVault.getSupportedAssets();
        expect(supported).to.not.include(vaultAssetAddress);
      });

      it("Should revert sendAsset after asset is removed but balance remains", async function () {
        // Remove asset first
        await collateralVault.connect(routerSigner).removeSupportedAsset(vaultAssetAddress);

        // Attempt to send should revert due to AssetNotSupported
        await expect(collateralVault.connect(routerSigner).sendAsset(vaultAssetAddress, 1n, deployer.address))
          .to.be.revertedWithCustomError(collateralVault, "AssetNotSupported")
          .withArgs(vaultAssetAddress);
      });
    });

    describe("Recovery Functions", function () {
      let mockToken: ERC20;
      let mockTokenAddress: string;
      const testAmount = parseUnits("100", 18);

      beforeEach(async function () {
        // Deploy a mock ERC20 token for testing rescue functionality
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = (await MockERC20.deploy("Mock Token", "MOCK", parseUnits("1000000", 18))) as ERC20;
        mockTokenAddress = await mockToken.getAddress();

        // Send some mock tokens to the vault to test rescue
        await mockToken.connect(deployer).transfer(collateralVaultAddress, testAmount);
      });

      describe("rescueToken", function () {
        it("Should successfully rescue non-restricted tokens", async function () {
          const receiverInitialBalance = await mockToken.balanceOf(user1.address);
          const vaultInitialBalance = await mockToken.balanceOf(collateralVaultAddress);

          await expect(collateralVault.connect(user1).rescueToken(mockTokenAddress, user1.address, testAmount))
            .to.emit(collateralVault, "TokenRescued")
            .withArgs(mockTokenAddress, user1.address, testAmount);

          expect(await mockToken.balanceOf(user1.address)).to.equal(receiverInitialBalance + testAmount);
          expect(await mockToken.balanceOf(collateralVaultAddress)).to.equal(vaultInitialBalance - testAmount);
        });

        it("Should rescue partial balance", async function () {
          const partialAmount = testAmount / 2n;

          await expect(collateralVault.connect(user1).rescueToken(mockTokenAddress, user1.address, partialAmount))
            .to.emit(collateralVault, "TokenRescued")
            .withArgs(mockTokenAddress, user1.address, partialAmount);

          expect(await mockToken.balanceOf(collateralVaultAddress)).to.equal(testAmount - partialAmount);
        });

        it("Should revert when trying to rescue supported vault assets", async function () {
          if (!adapter) this.skip();

          // Ensure the vault asset is supported
          if ((await router.vaultAssetToAdapter(vaultAssetAddress)) === ZeroAddress) {
            await router.connect(deployer).addAdapter(vaultAssetAddress, adapterAddress);
          }

          await expect(collateralVault.connect(user1).rescueToken(vaultAssetAddress, user1.address, 1n))
            .to.be.revertedWithCustomError(collateralVault, "CannotRescueRestrictedToken")
            .withArgs(vaultAssetAddress);
        });

        it("Should revert when trying to rescue dStable token", async function () {
          // Send some dStable to the vault
          await stable.mint(collateralVaultAddress, testAmount);

          await expect(collateralVault.connect(user1).rescueToken(dStableTokenAddress, user1.address, testAmount))
            .to.be.revertedWithCustomError(collateralVault, "CannotRescueRestrictedToken")
            .withArgs(dStableTokenAddress);
        });

        it("Should only allow DEFAULT_ADMIN_ROLE to call rescueToken", async function () {
          await expect(
            collateralVault.connect(user2).rescueToken(mockTokenAddress, user1.address, testAmount),
          ).to.be.revertedWithCustomError(collateralVault, "AccessControlUnauthorizedAccount");
        });

        it("Should revert with zero address receiver", async function () {
          await expect(collateralVault.connect(user1).rescueToken(mockTokenAddress, ZeroAddress, testAmount)).to.be.revertedWithCustomError(
            collateralVault,
            "ZeroAddress",
          );
        });

        it("Should handle rescue when token balance is insufficient", async function () {
          const excessiveAmount = testAmount * 2n;
          await expect(collateralVault.connect(user1).rescueToken(mockTokenAddress, user1.address, excessiveAmount)).to.be.reverted;
        });
      });

      describe("rescueETH", function () {
        const ethAmount = parseUnits("1", 18);

        beforeEach(async function () {
          // Send ETH to the vault
          await deployer.sendTransaction({
            to: collateralVaultAddress,
            value: ethAmount,
          });
        });

        it("Should successfully rescue ETH", async function () {
          // Use user2 as receiver to avoid gas cost complications with user1 (admin)
          const receiverInitialBalance = await ethers.provider.getBalance(user2.address);
          const vaultInitialBalance = await ethers.provider.getBalance(collateralVaultAddress);

          await expect(collateralVault.connect(user1).rescueETH(user2.address, ethAmount))
            .to.emit(collateralVault, "ETHRescued")
            .withArgs(user2.address, ethAmount);

          // Check receiver got the exact amount (no gas costs for receiver)
          expect(await ethers.provider.getBalance(user2.address)).to.equal(receiverInitialBalance + ethAmount);
          // Check vault balance decreased by exactly the rescued amount
          expect(await ethers.provider.getBalance(collateralVaultAddress)).to.equal(vaultInitialBalance - ethAmount);
        });

        it("Should only allow DEFAULT_ADMIN_ROLE to call rescueETH", async function () {
          await expect(collateralVault.connect(user2).rescueETH(user2.address, ethAmount)).to.be.revertedWithCustomError(
            collateralVault,
            "AccessControlUnauthorizedAccount",
          );
        });

        it("Should revert with zero address receiver", async function () {
          await expect(collateralVault.connect(user1).rescueETH(ZeroAddress, ethAmount)).to.be.revertedWithCustomError(
            collateralVault,
            "ZeroAddress",
          );
        });

        it("Should revert when contract has insufficient ETH", async function () {
          const excessiveAmount = ethAmount * 2n;
          await expect(collateralVault.connect(user1).rescueETH(user2.address, excessiveAmount))
            .to.be.revertedWithCustomError(collateralVault, "ETHTransferFailed")
            .withArgs(user2.address, excessiveAmount);
        });

        it("Should handle rescue when contract has no ETH", async function () {
          // First rescue all ETH
          await collateralVault.connect(user1).rescueETH(user2.address, ethAmount);

          // Try to rescue again when balance is 0
          await expect(collateralVault.connect(user1).rescueETH(user2.address, 1n))
            .to.be.revertedWithCustomError(collateralVault, "ETHTransferFailed")
            .withArgs(user2.address, 1n);
        });
      });

      describe("getRestrictedRescueTokens", function () {
        it("Should return dStable token when no assets are supported", async function () {
          // Remove all supported assets
          const supportedAssets = await collateralVault.getSupportedAssets();

          for (const asset of supportedAssets) {
            await collateralVault.connect(routerSigner).removeSupportedAsset(asset);
          }

          const restrictedTokens = await collateralVault.getRestrictedRescueTokens();
          expect(restrictedTokens).to.have.lengthOf(1);
          expect(restrictedTokens[0]).to.equal(dStableTokenAddress);
        });

        it("Should return all supported assets plus dStable", async function () {
          if (!adapter) this.skip();

          // Ensure at least one asset is supported
          if ((await router.vaultAssetToAdapter(vaultAssetAddress)) === ZeroAddress) {
            await router.connect(deployer).addAdapter(vaultAssetAddress, adapterAddress);
          }

          const supportedAssets = await collateralVault.getSupportedAssets();
          const restrictedTokens = await collateralVault.getRestrictedRescueTokens();

          expect(restrictedTokens).to.have.lengthOf(supportedAssets.length + 1);

          // Check all supported assets are in restricted list
          for (const asset of supportedAssets) {
            expect(restrictedTokens).to.include(asset);
          }

          // Check dStable is in restricted list
          expect(restrictedTokens).to.include(dStableTokenAddress);
        });

        it("Should update when assets are added/removed", async function () {
          if (!adapter) this.skip();

          // Start with no supported assets
          const supportedAssets = await collateralVault.getSupportedAssets();

          for (const asset of supportedAssets) {
            await collateralVault.connect(routerSigner).removeSupportedAsset(asset);
          }

          let restrictedTokens = await collateralVault.getRestrictedRescueTokens();
          expect(restrictedTokens).to.have.lengthOf(1);

          // Add an asset
          await router.connect(user1).addAdapter(vaultAssetAddress, adapterAddress);

          restrictedTokens = await collateralVault.getRestrictedRescueTokens();
          expect(restrictedTokens).to.have.lengthOf(2);
          expect(restrictedTokens).to.include(vaultAssetAddress);
          expect(restrictedTokens).to.include(dStableTokenAddress);

          // Remove the asset
          await collateralVault.connect(routerSigner).removeSupportedAsset(vaultAssetAddress);

          restrictedTokens = await collateralVault.getRestrictedRescueTokens();
          expect(restrictedTokens).to.have.lengthOf(1);
          expect(restrictedTokens[0]).to.equal(dStableTokenAddress);
        });
      });

      describe("Integration tests", function () {
        it("Should rescue multiple different tokens", async function () {
          // Deploy another mock token
          const MockERC20 = await ethers.getContractFactory("MockERC20");
          const mockToken2 = (await MockERC20.deploy("Mock Token 2", "MOCK2", parseUnits("1000000", 18))) as ERC20;
          const mockToken2Address = await mockToken2.getAddress();

          // Send both tokens to vault
          await mockToken2.connect(deployer).transfer(collateralVaultAddress, testAmount);

          // Rescue first token
          await expect(collateralVault.connect(user1).rescueToken(mockTokenAddress, user1.address, testAmount))
            .to.emit(collateralVault, "TokenRescued")
            .withArgs(mockTokenAddress, user1.address, testAmount);

          // Rescue second token
          await expect(collateralVault.connect(user1).rescueToken(mockToken2Address, user1.address, testAmount))
            .to.emit(collateralVault, "TokenRescued")
            .withArgs(mockToken2Address, user1.address, testAmount);

          expect(await mockToken.balanceOf(user1.address)).to.equal(testAmount);
          expect(await mockToken2.balanceOf(user1.address)).to.equal(testAmount);
        });

        it("Should prevent rescue of newly added supported assets", async function () {
          if (!adapter) this.skip();

          // Initially the vault asset should not be supported if adapter is not set
          if ((await router.vaultAssetToAdapter(vaultAssetAddress)) === ZeroAddress) {
            // Send vault asset to the contract
            const amount = parseUnits("10", vaultAssetDecimals);

            if (vaultAssetAddress !== ZeroAddress && vaultAssetToken) {
              // Mint or transfer vault asset to the vault
              const dStableDepositAmount = parseUnits("100", dStableDecimals);
              await stable.mint(deployer.address, dStableDepositAmount);
              await dStableToken.connect(deployer).approve(DStakeTokenAddress, dStableDepositAmount);
              await DStakeToken.connect(deployer).deposit(dStableDepositAmount, deployer.address);
            }

            // Should be able to rescue before it's supported
            const vaultBalance = await vaultAssetToken.balanceOf(collateralVaultAddress);

            if (vaultBalance > 0n) {
              await expect(collateralVault.connect(user1).rescueToken(vaultAssetAddress, user1.address, 1n)).to.not.be.reverted;
            }

            // Add adapter to make it supported
            await router.connect(deployer).addAdapter(vaultAssetAddress, adapterAddress);

            // Now should not be able to rescue
            await expect(collateralVault.connect(user1).rescueToken(vaultAssetAddress, user1.address, 1n))
              .to.be.revertedWithCustomError(collateralVault, "CannotRescueRestrictedToken")
              .withArgs(vaultAssetAddress);
          }
        });
      });
    });
  });
});
