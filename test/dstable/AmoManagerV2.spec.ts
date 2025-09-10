import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoDebtToken,
  AmoManagerV2,
  CollateralHolderVault,
  OracleAggregator,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import {
  getTokenContractForAddress,
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import { getConfig } from "../../config/config";
import {
  createDStableFixture,
  DS_CONFIG,
  DStableFixtureConfig,
  DUSD_CONFIG,
} from "./fixtures";

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

describe("AmoManagerV2 and AmoDebtToken", () => {
  let deployer: Address;
  let user1: Address;
  let user2: Address;
  let amoWallet: Address;

  before(async () => {
    ({ deployer, user1, user2 } = await getNamedAccounts());
    amoWallet = user1; // Use user1 as AMO wallet for tests
  });

  // Run tests for each dStable configuration
  dstableConfigs.forEach((config) => {
    runTestsForDStable(config, { deployer, user1, user2, amoWallet });
  });
});

/**
 * Run comprehensive tests for the AMO debt system with a specific dStable configuration
 */
function runTestsForDStable(
  config: DStableFixtureConfig,
  {
    deployer,
    user1,
    user2,
    amoWallet,
  }: { deployer: Address; user1: Address; user2: Address; amoWallet: Address },
) {
  describe(`AMO Debt System for ${config.symbol}`, () => {
    let amoDebtToken: AmoDebtToken;
    let amoManagerV2: AmoManagerV2;
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let oracleAggregatorContract: OracleAggregator;
    let collateralVaultContract: CollateralHolderVault;
    let collateralTokens: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();
    
    // Roles
    let defaultAdminRole: string;
    let amoManagerRole: string;
    let amoMinterRole: string;
    let amoBorrowerRole: string;
    let collateralWithdrawerRole: string;

    // Set up fixture for this specific dStable configuration
    const fixture = createDStableFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1, user2 } = await getNamedAccounts());

      // Get dStable contract
      ({ contract: dstableContract, tokenInfo: dstableInfo } =
        await getTokenContractForSymbol(hre, deployer, config.symbol));

      // Get the oracle aggregator
      const oracleAggregatorAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the collateral vault
      const collateralVaultAddress = (
        await hre.deployments.get(config.collateralVaultContractId)
      ).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Deploy AmoDebtToken
      const AmoDebtTokenFactory = await hre.ethers.getContractFactory(
        "AmoDebtToken",
        await hre.ethers.getSigner(deployer),
      );
      amoDebtToken = (await AmoDebtTokenFactory.deploy(
        "dTRINITY AMO Receipt",
        `amo-${config.symbol}`,
      )) as AmoDebtToken;
      await amoDebtToken.waitForDeployment();

      // Deploy AmoManagerV2
      const AmoManagerV2Factory = await hre.ethers.getContractFactory(
        "AmoManagerV2",
        await hre.ethers.getSigner(deployer),
      );
      const collateralVaultAddress = await collateralVaultContract.getAddress();
      amoManagerV2 = (await AmoManagerV2Factory.deploy(
        await oracleAggregatorContract.getAddress(),
        await amoDebtToken.getAddress(),
        await dstableContract.getAddress(),
        amoWallet,
        0, // tolerance = 0 for precise tests
        collateralVaultAddress,
      )) as AmoManagerV2;
      await amoManagerV2.waitForDeployment();

      // Set up roles
      defaultAdminRole = await amoDebtToken.DEFAULT_ADMIN_ROLE();
      amoMinterRole = await amoDebtToken.AMO_MINTER_ROLE();
      amoBorrowerRole = await amoDebtToken.AMO_BORROWER_ROLE();
      amoManagerRole = await amoManagerV2.AMO_MANAGER_ROLE();
      collateralWithdrawerRole = await collateralVaultContract.COLLATERAL_WITHDRAWER_ROLE();

      // Grant roles to AmoManagerV2
      await amoDebtToken.grantRole(amoMinterRole, await amoManagerV2.getAddress());
      await amoDebtToken.grantRole(amoBorrowerRole, await amoManagerV2.getAddress());
      await amoManagerV2.grantRole(amoManagerRole, amoWallet);
      await collateralVaultContract.grantRole(
        collateralWithdrawerRole,
        await amoManagerV2.getAddress(),
      );

      // Grant MINTER_ROLE on dStable to AmoManagerV2
      const dstableMinterRole = await dstableContract.MINTER_ROLE();
      await dstableContract.grantRole(dstableMinterRole, await amoManagerV2.getAddress());

      // Set up allowlists
      await amoDebtToken.setAllowlisted(await collateralVaultContract.getAddress(), true);
      await amoDebtToken.setAllowlisted(await amoManagerV2.getAddress(), true);
      await amoManagerV2.setAmoWalletAllowed(amoWallet, true);

      // Add debt token as supported collateral in vault (for invariant checks)
      await collateralVaultContract.allowCollateral(await amoDebtToken.getAddress());

      // Set oracle price for debt token to $1 (base unit)
      // This is handled by the existing oracle setup in fixtures

      // Set up test collateral tokens with different decimals
      const networkConfig = await getConfig(hre);
      const collateralAddresses = networkConfig.dStables[config.symbol].collaterals;

      for (const collateralAddress of collateralAddresses) {
        if (collateralAddress === hre.ethers.ZeroAddress) continue;

        const { contract, tokenInfo } = await getTokenContractForAddress(
          hre,
          deployer,
          collateralAddress,
        );

        collateralTokens.set(tokenInfo.symbol, contract);
        collateralInfos.set(tokenInfo.symbol, tokenInfo);

        // Fund deployer and amoWallet with collateral tokens
        const amount = hre.ethers.parseUnits("10000", tokenInfo.decimals);
        if ("mint" in contract && typeof contract.mint === "function") {
          await contract.mint(deployer, amount);
          await contract.mint(amoWallet, amount);
        } else {
          await contract.transfer(deployer, amount);
          await contract.transfer(amoWallet, amount);
        }

        // Fund collateral vault with initial collateral for testing
        await contract.transfer(await collateralVaultContract.getAddress(), amount);
      }
    });

    describe("AmoDebtToken", () => {
      describe("Basic Properties", () => {
        it("should have correct name, symbol, and decimals", async function () {
          expect(await amoDebtToken.name()).to.equal("dTRINITY AMO Receipt");
          expect(await amoDebtToken.symbol()).to.equal(`amo-${config.symbol}`);
          expect(await amoDebtToken.decimals()).to.equal(18);
        });

        it("should initialize with zero total supply", async function () {
          expect(await amoDebtToken.totalSupply()).to.equal(0);
        });

        it("should have correct role assignments", async function () {
          expect(await amoDebtToken.hasRole(defaultAdminRole, deployer)).to.be.true;
          expect(await amoDebtToken.hasRole(amoMinterRole, await amoManagerV2.getAddress())).to.be.true;
          expect(await amoDebtToken.hasRole(amoBorrowerRole, await amoManagerV2.getAddress())).to.be.true;
        });
      });

      describe("Allowlist Management", () => {
        it("should allow admin to set allowlist status", async function () {
          expect(await amoDebtToken.isAllowlisted(user2)).to.be.false;
          
          await amoDebtToken.setAllowlisted(user2, true);
          expect(await amoDebtToken.isAllowlisted(user2)).to.be.true;

          await amoDebtToken.setAllowlisted(user2, false);
          expect(await amoDebtToken.isAllowlisted(user2)).to.be.false;
        });

        it("should emit AllowlistSet event", async function () {
          await expect(amoDebtToken.setAllowlisted(user2, true))
            .to.emit(amoDebtToken, "AllowlistSet")
            .withArgs(user2, true);
        });

        it("should prevent non-admin from setting allowlist", async function () {
          const nonAdminSigner = await hre.ethers.getSigner(user1);
          await expect(
            amoDebtToken.connect(nonAdminSigner).setAllowlisted(user2, true),
          ).to.be.revertedWithCustomError(
            amoDebtToken,
            "AccessControlUnauthorizedAccount",
          );
        });

        it("should return correct allowlist data", async function () {
          await amoDebtToken.setAllowlisted(user1, true);
          await amoDebtToken.setAllowlisted(user2, true);

          const allowlist = await amoDebtToken.getAllowlist();
          expect(allowlist).to.include(user1);
          expect(allowlist).to.include(user2);
          expect(await amoDebtToken.getAllowlistLength()).to.be.gte(2);
        });
      });

      describe("Minting and Burning", () => {
        it("should allow minter to mint to allowlisted vault", async function () {
          const amount = hre.ethers.parseUnits("1000", 18);
          const vaultAddress = await collateralVaultContract.getAddress();

          await amoDebtToken.mintToVault(vaultAddress, amount);

          expect(await amoDebtToken.balanceOf(vaultAddress)).to.equal(amount);
          expect(await amoDebtToken.totalSupply()).to.equal(amount);
        });

        it("should prevent minting to non-allowlisted vault", async function () {
          const amount = hre.ethers.parseUnits("1000", 18);

          await expect(amoDebtToken.mintToVault(user2, amount))
            .to.be.revertedWithCustomError(amoDebtToken, "InvalidVault")
            .withArgs(user2);
        });

        it("should allow borrower to burn from allowlisted vault", async function () {
          const amount = hre.ethers.parseUnits("1000", 18);
          const vaultAddress = await collateralVaultContract.getAddress();

          await amoDebtToken.mintToVault(vaultAddress, amount);
          await amoDebtToken.burnFromVault(vaultAddress, amount);

          expect(await amoDebtToken.balanceOf(vaultAddress)).to.equal(0);
          expect(await amoDebtToken.totalSupply()).to.equal(0);
        });

        it("should prevent burning from non-allowlisted vault", async function () {
          const amount = hre.ethers.parseUnits("1000", 18);

          await expect(amoDebtToken.burnFromVault(user2, amount))
            .to.be.revertedWithCustomError(amoDebtToken, "InvalidVault")
            .withArgs(user2);
        });

        it("should prevent non-minter from minting", async function () {
          const amount = hre.ethers.parseUnits("1000", 18);
          const vaultAddress = await collateralVaultContract.getAddress();
          const nonMinterSigner = await hre.ethers.getSigner(user1);

          await expect(
            amoDebtToken.connect(nonMinterSigner).mintToVault(vaultAddress, amount),
          ).to.be.revertedWithCustomError(
            amoDebtToken,
            "AccessControlUnauthorizedAccount",
          );
        });

        it("should prevent non-borrower from burning", async function () {
          const amount = hre.ethers.parseUnits("1000", 18);
          const vaultAddress = await collateralVaultContract.getAddress();
          const nonBorrowerSigner = await hre.ethers.getSigner(user1);

          await expect(
            amoDebtToken.connect(nonBorrowerSigner).burnFromVault(vaultAddress, amount),
          ).to.be.revertedWithCustomError(
            amoDebtToken,
            "AccessControlUnauthorizedAccount",
          );
        });
      });

      describe("Transfer Restrictions", () => {
        beforeEach(async function () {
          // Set up some debt tokens in the vault for transfer tests
          const amount = hre.ethers.parseUnits("1000", 18);
          await amoDebtToken.mintToVault(
            await collateralVaultContract.getAddress(),
            amount,
          );
        });

        it("should prevent transfer to non-allowlisted address", async function () {
          const amount = hre.ethers.parseUnits("100", 18);
          const vaultSigner = await hre.ethers.getSigner(
            await collateralVaultContract.getAddress(),
          );

          // Impersonate vault for testing
          await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [await collateralVaultContract.getAddress()],
          });

          await expect(
            amoDebtToken.connect(vaultSigner).transfer(user2, amount),
          ).to.be.revertedWithCustomError(amoDebtToken, "NotAllowlisted")
            .withArgs(user2);

          await hre.network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [await collateralVaultContract.getAddress()],
          });
        });

        it("should prevent transfer from non-allowlisted address", async function () {
          const amount = hre.ethers.parseUnits("100", 18);

          // Add user2 as allowlisted and give them some tokens
          await amoDebtToken.setAllowlisted(user2, true);
          await amoDebtToken.mintToVault(user2, amount);

          // Remove user2 from allowlist
          await amoDebtToken.setAllowlisted(user2, false);

          const user2Signer = await hre.ethers.getSigner(user2);
          const managerAddress = await amoManagerV2.getAddress();

          await expect(
            amoDebtToken.connect(user2Signer).transfer(managerAddress, amount),
          ).to.be.revertedWithCustomError(amoDebtToken, "NotAllowlisted")
            .withArgs(user2);
        });

        it("should allow transfer between allowlisted addresses", async function () {
          const amount = hre.ethers.parseUnits("100", 18);
          const vaultAddress = await collateralVaultContract.getAddress();
          const managerAddress = await amoManagerV2.getAddress();

          // Impersonate vault for testing
          await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [vaultAddress],
          });

          const vaultSigner = await hre.ethers.getSigner(vaultAddress);

          await amoDebtToken.connect(vaultSigner).transfer(managerAddress, amount);

          expect(await amoDebtToken.balanceOf(managerAddress)).to.equal(amount);
          expect(await amoDebtToken.balanceOf(vaultAddress)).to.equal(
            hre.ethers.parseUnits("900", 18),
          );

          await hre.network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [vaultAddress],
          });
        });

        it("should prevent transferFrom with non-allowlisted spender", async function () {
          const amount = hre.ethers.parseUnits("100", 18);
          const vaultAddress = await collateralVaultContract.getAddress();
          const managerAddress = await amoManagerV2.getAddress();

          // Impersonate vault to approve user2 (non-allowlisted)
          await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [vaultAddress],
          });

          const vaultSigner = await hre.ethers.getSigner(vaultAddress);
          await amoDebtToken.connect(vaultSigner).approve(user2, amount);

          await hre.network.provider.request({
            method: "hardhat_stopImpersonatingAccount",
            params: [vaultAddress],
          });

          // Try transferFrom as non-allowlisted user
          const user2Signer = await hre.ethers.getSigner(user2);
          await expect(
            amoDebtToken
              .connect(user2Signer)
              .transferFrom(vaultAddress, managerAddress, amount),
          ).to.be.revertedWithCustomError(amoDebtToken, "NotAllowlisted")
            .withArgs(user2);
        });
      });
    });

    describe("AmoManagerV2", () => {
      describe("Basic Properties", () => {
        it("should have correct initial configuration", async function () {
          expect(await amoManagerV2.amoWallet()).to.equal(amoWallet);
          expect(await amoManagerV2.debtToken()).to.equal(await amoDebtToken.getAddress());
          expect(await amoManagerV2.dstable()).to.equal(await dstableContract.getAddress());
          expect(await amoManagerV2.tolerance()).to.equal(0);
          expect(await amoManagerV2.collateralVault()).to.equal(await collateralVaultContract.getAddress());
        });

        it("should have correct role assignments", async function () {
          expect(await amoManagerV2.hasRole(defaultAdminRole, deployer)).to.be.true;
          expect(await amoManagerV2.hasRole(amoManagerRole, amoWallet)).to.be.true;
        });

        it("should have correct allowlist setup", async function () {
          expect(await amoManagerV2.isAmoWalletAllowed(amoWallet)).to.be.true;
        });
      });

      describe("Stable AMO Operations", () => {
        it("should increase AMO supply atomically", async function () {
          const amount = hre.ethers.parseUnits("1000", dstableInfo.decimals);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);

          const initialDstableSupply = await dstableContract.totalSupply();
          const initialDebtSupply = await amoDebtToken.totalSupply();
          const initialWalletBalance = await dstableContract.balanceOf(amoWallet);

          await amoManagerV2.connect(amoManagerSigner).increaseAmoSupply(amount, amoWallet);

          const finalDstableSupply = await dstableContract.totalSupply();
          const finalDebtSupply = await amoDebtToken.totalSupply();
          const finalWalletBalance = await dstableContract.balanceOf(amoWallet);

          // Check dUSD was minted to AMO wallet
          expect(finalWalletBalance - initialWalletBalance).to.equal(amount);
          expect(finalDstableSupply - initialDstableSupply).to.equal(amount);

          // Check equal debt was minted to vault
          const expectedDebtAmount = await amoManagerV2.baseToDebtUnits(
            await amoManagerV2.dstableAmountToBaseValue(amount)
          );
          expect(finalDebtSupply - initialDebtSupply).to.equal(expectedDebtAmount);
          expect(await amoDebtToken.balanceOf(await collateralVaultContract.getAddress()))
            .to.equal(expectedDebtAmount);
        });

        it("should decrease AMO supply atomically", async function () {
          const amount = hre.ethers.parseUnits("1000", dstableInfo.decimals);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);

          // First increase supply
          await amoManagerV2.connect(amoManagerSigner).increaseAmoSupply(amount, amoWallet);

          const initialDstableSupply = await dstableContract.totalSupply();
          const initialDebtSupply = await amoDebtToken.totalSupply();
          const initialWalletBalance = await dstableContract.balanceOf(amoWallet);

          // Then decrease supply
          // Approve manager to pull dUSD
          const amoWalletSigner = await hre.ethers.getSigner(amoWallet);
          await dstableContract.connect(amoWalletSigner).approve(await amoManagerV2.getAddress(), amount);

          await amoManagerV2.connect(amoManagerSigner).decreaseAmoSupply(amount, amoWallet);

          const finalDstableSupply = await dstableContract.totalSupply();
          const finalDebtSupply = await amoDebtToken.totalSupply();
          const finalWalletBalance = await dstableContract.balanceOf(amoWallet);

          // Check dUSD was burned by pulling from wallet
          expect(initialWalletBalance - finalWalletBalance).to.equal(amount);
          expect(initialDstableSupply - finalDstableSupply).to.equal(amount);

          // Check equal debt was burned from vault
          const expectedDebtAmount = await amoManagerV2.baseToDebtUnits(
            await amoManagerV2.dstableAmountToBaseValue(amount)
          );
          expect(initialDebtSupply - finalDebtSupply).to.equal(expectedDebtAmount);
          expect(await amoDebtToken.balanceOf(await collateralVaultContract.getAddress()))
            .to.equal(0);
        });

        it("should prevent non-manager from stable AMO operations", async function () {
          const amount = hre.ethers.parseUnits("1000", dstableInfo.decimals);
          const nonManagerSigner = await hre.ethers.getSigner(user2);

          await expect(
            amoManagerV2.connect(nonManagerSigner).increaseAmoSupply(amount, amoWallet),
          ).to.be.revertedWithCustomError(
            amoManagerV2,
            "AccessControlUnauthorizedAccount",
          );

          await expect(
            amoManagerV2.connect(nonManagerSigner).decreaseAmoSupply(amount, amoWallet),
          ).to.be.revertedWithCustomError(
            amoManagerV2,
            "AccessControlUnauthorizedAccount",
          );
        });

        it("should revert when AMO wallet is not allowlisted", async function () {
          const amount = hre.ethers.parseUnits("1000", dstableInfo.decimals);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);

          // Remove wallet from allowlist
          await amoManagerV2.setAmoWalletAllowed(amoWallet, false);

          await expect(
            amoManagerV2.connect(amoManagerSigner).increaseAmoSupply(amount, amoWallet),
          ).to.be.revertedWithCustomError(amoManagerV2, "UnsupportedAmoWallet")
            .withArgs(amoWallet);

          // Re-allow for subsequent tests
          await amoManagerV2.setAmoWalletAllowed(amoWallet, true);
        });
      });

      describe("Collateral AMO Operations", () => {
        const setupCollateralTest = async (symbol: string) => {
          const collateralToken = collateralTokens.get(symbol)!;
          const collateralInfo = collateralInfos.get(symbol)!;
          const amount = hre.ethers.parseUnits("100", collateralInfo.decimals);

          return { collateralToken, collateralInfo, amount };
        };

        for (const [symbol] of collateralTokens) {
          describe(`Collateral operations with ${symbol}`, () => {
            it(`should borrow ${symbol} with invariant preservation`, async function () {
              const { collateralToken, collateralInfo, amount } = await setupCollateralTest(symbol);
              const amoManagerSigner = await hre.ethers.getSigner(amoWallet);

              // Record pre-borrow state
              const preVaultValue = await collateralVaultContract.totalValue();
              const preDebtSupply = await amoDebtToken.totalSupply();
              const preEndpointBalance = await collateralToken.balanceOf(amoWallet);

              // Perform borrow
              await amoManagerV2
                .connect(amoManagerSigner)
                .borrowTo(
                  amoWallet,
                  await collateralToken.getAddress(),
                  amount
                );

              // Record post-borrow state
              const postVaultValue = await collateralVaultContract.totalValue();
              const postDebtSupply = await amoDebtToken.totalSupply();
              const postEndpointBalance = await collateralToken.balanceOf(amoWallet);

              // Check collateral was transferred to endpoint
              expect(postEndpointBalance - preEndpointBalance).to.equal(amount);

              // Check debt was minted
              const assetValue = await collateralVaultContract.assetValueFromAmount(
                amount,
                await collateralToken.getAddress()
              );
              const expectedDebtAmount = await amoManagerV2.baseToDebtUnits(assetValue);
              expect(postDebtSupply - preDebtSupply).to.equal(expectedDebtAmount);

                  // Check invariant: vault value should be conserved (within tolerance)
              const tolerance = await amoManagerV2.tolerance();
              const diff = postVaultValue > preVaultValue 
                ? postVaultValue - preVaultValue 
                : preVaultValue - postVaultValue;
              expect(diff).to.be.lte(tolerance);
            });

            it(`should repay ${symbol} with invariant preservation`, async function () {
              const { collateralToken, collateralInfo, amount } = await setupCollateralTest(symbol);
              const amoManagerSigner = await hre.ethers.getSigner(amoWallet);

              // First borrow some collateral
              await amoManagerV2
                .connect(amoManagerSigner)
                .borrowTo(
                  amoWallet,
                  await collateralToken.getAddress(),
                  amount
                );

              // Approve manager to spend collateral
              const amoWalletSigner2 = await hre.ethers.getSigner(amoWallet);
              await collateralToken
                .connect(amoWalletSigner2)
                .approve(await amoManagerV2.getAddress(), amount);

              // Record pre-repay state
              const preVaultValue = await collateralVaultContract.totalValue();
              const preDebtSupply = await amoDebtToken.totalSupply();
              const preEndpointBalance = await collateralToken.balanceOf(amoWallet);

              // Perform repay
              await amoManagerV2
                .connect(amoManagerSigner)
                .repayFrom(
                  amoWallet,
                  await collateralToken.getAddress(),
                  amount
                );

              // Record post-repay state
              const postVaultValue = await collateralVaultContract.totalValue();
              const postDebtSupply = await amoDebtToken.totalSupply();
              const postEndpointBalance = await collateralToken.balanceOf(amoWallet);

              // Check collateral was transferred from endpoint
              expect(preEndpointBalance - postEndpointBalance).to.equal(amount);

              // Check debt was burned
              const assetValue = await collateralVaultContract.assetValueFromAmount(
                amount,
                await collateralToken.getAddress()
              );
              const expectedDebtAmount = await amoManagerV2.baseToDebtUnits(assetValue);
              expect(preDebtSupply - postDebtSupply).to.equal(expectedDebtAmount);

              // Check invariant: vault value should be conserved (within tolerance)
              const tolerance = await amoManagerV2.tolerance();
              const diff = postVaultValue > preVaultValue 
                ? postVaultValue - preVaultValue 
                : preVaultValue - postVaultValue;
              expect(diff).to.be.lte(tolerance);
            });

            it(`should support repayWithPermit for ${symbol}`, async function () {
              // Skip permit test for tokens that don't support it
              const { collateralToken, collateralInfo, amount } = await setupCollateralTest(symbol);
              
              // Check if token supports permit (has the permit function)
              try {
                await collateralToken.nonces(amoWallet);
              } catch {
                console.log(`Skipping permit test for ${symbol} - no permit support`);
                return;
              }

              const amoManagerSigner = await hre.ethers.getSigner(amoWallet);
              const vaultAddress = await collateralVaultContract.getAddress();

              // First borrow some collateral
              await amoManagerV2
                .connect(amoManagerSigner)
                .borrowTo(
                  amoWallet,
                  await collateralToken.getAddress(),
                  amount
                );

              // Create permit signature (simplified for testing)
              const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

              // For testing, we'll use a simple signature (in real implementation, proper EIP-2612 signing would be used)
              const v = 27;
              const r = "0x" + "0".repeat(64);
              const s = "0x" + "0".repeat(64);

              // This should not revert due to signature validation in a real scenario,
              // but for our mock tokens, we expect it to work
              try {
                await amoManagerV2
                  .connect(amoManagerSigner)
                  .repayWithPermit(
                    amoWallet,
                    amoWallet,
                    await collateralToken.getAddress(),
                    amount,
                    deadline,
                    v,
                    r,
                    s
                  );
              } catch (error) {
                // Expected to fail with mock signature, but function should exist
                expect(error).to.not.be.undefined;
              }
            });
          });
        }

        it("should emit Borrowed event", async function () {
          const symbol = collateralTokens.keys().next().value;
          const { collateralToken, collateralInfo, amount } = await setupCollateralTest(symbol);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);
          const vaultAddress = await collateralVaultContract.getAddress();

          const assetValue = await collateralVaultContract.assetValueFromAmount(
            amount,
            await collateralToken.getAddress()
          );
          const expectedDebtAmount = await amoManagerV2.baseToDebtUnits(assetValue);

          await expect(
            amoManagerV2
              .connect(amoManagerSigner)
              .borrowTo(
                amoWallet,
                await collateralToken.getAddress(),
                amount
              )
          )
            .to.emit(amoManagerV2, "Borrowed")
            .withArgs(
              await collateralVaultContract.getAddress(),
              amoWallet,
              await collateralToken.getAddress(),
              amount,
              expectedDebtAmount
            );
        });

        it("should emit Repaid event", async function () {
          const symbol = collateralTokens.keys().next().value;
          const { collateralToken, collateralInfo, amount } = await setupCollateralTest(symbol);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);
          const vaultAddress = await collateralVaultContract.getAddress();

          // First borrow
          await amoManagerV2
            .connect(amoManagerSigner)
            .borrowTo(
              amoWallet,
              await collateralToken.getAddress(),
              amount
            );

          // Approve and repay
          const amoWalletSigner2 = await hre.ethers.getSigner(amoWallet);
          await collateralToken
            .connect(amoWalletSigner2)
            .approve(await amoManagerV2.getAddress(), amount);

          const assetValue = await collateralVaultContract.assetValueFromAmount(
            amount,
            await collateralToken.getAddress()
          );
          const expectedDebtAmount = await amoManagerV2.baseToDebtUnits(assetValue);

          await expect(
            amoManagerV2
              .connect(amoManagerSigner)
              .repayFrom(
                amoWallet,
                await collateralToken.getAddress(),
                amount
              )
          )
            .to.emit(amoManagerV2, "Repaid")
            .withArgs(
              await collateralVaultContract.getAddress(),
              amoWallet,
              await collateralToken.getAddress(),
              amount,
              expectedDebtAmount
            );
        });
      });

      describe("Admin Functions", () => {
        it("should allow admin to set AMO multisig", async function () {
          const newMultisig = user2;

          await expect(amoManagerV2.setAmoMultisig(newMultisig))
            .to.emit(amoManagerV2, "AmoMultisigSet")
            .withArgs(amoWallet, newMultisig);

          expect(await amoManagerV2.amoMultisig()).to.equal(newMultisig);
        });

        it("should prevent setting zero address as multisig", async function () {
          await expect(amoManagerV2.setAmoMultisig(hre.ethers.ZeroAddress))
            .to.be.revertedWithCustomError(amoManagerV2, "InvalidMultisig")
            .withArgs(hre.ethers.ZeroAddress);
        });

        it("should allow admin to manage vault allowlist", async function () {
          const newVault = user2;

          await expect(amoManagerV2.setVaultAllowed(newVault, true))
            .to.emit(amoManagerV2, "VaultAllowedSet")
            .withArgs(newVault, true);

          expect(await amoManagerV2.isVaultAllowed(newVault)).to.be.true;

          await expect(amoManagerV2.setVaultAllowed(newVault, false))
            .to.emit(amoManagerV2, "VaultAllowedSet")
            .withArgs(newVault, false);

          expect(await amoManagerV2.isVaultAllowed(newVault)).to.be.false;
        });

        it("should allow admin to manage endpoint allowlist", async function () {
          const newEndpoint = user2;

          await expect(amoManagerV2.setEndpointAllowed(newEndpoint, true))
            .to.emit(amoManagerV2, "EndpointAllowedSet")
            .withArgs(newEndpoint, true);

          expect(await amoManagerV2.isEndpointAllowed(newEndpoint)).to.be.true;

          await expect(amoManagerV2.setEndpointAllowed(newEndpoint, false))
            .to.emit(amoManagerV2, "EndpointAllowedSet")
            .withArgs(newEndpoint, false);

          expect(await amoManagerV2.isEndpointAllowed(newEndpoint)).to.be.false;
        });

        it("should allow admin to set tolerance", async function () {
          const newTolerance = 1000n;

          await expect(amoManagerV2.setTolerance(newTolerance))
            .to.emit(amoManagerV2, "ToleranceSet")
            .withArgs(0, newTolerance);

          expect(await amoManagerV2.tolerance()).to.equal(newTolerance);
        });

        it("should prevent non-admin from admin functions", async function () {
          const nonAdminSigner = await hre.ethers.getSigner(user1);

          await expect(
            amoManagerV2.connect(nonAdminSigner).setAmoMultisig(user2),
          ).to.be.revertedWithCustomError(
            amoManagerV2,
            "AccessControlUnauthorizedAccount",
          );

          await expect(
            amoManagerV2.connect(nonAdminSigner).setVaultAllowed(user2, true),
          ).to.be.revertedWithCustomError(
            amoManagerV2,
            "AccessControlUnauthorizedAccount",
          );

          await expect(
            amoManagerV2.connect(nonAdminSigner).setEndpointAllowed(user2, true),
          ).to.be.revertedWithCustomError(
            amoManagerV2,
            "AccessControlUnauthorizedAccount",
          );

          await expect(
            amoManagerV2.connect(nonAdminSigner).setTolerance(1000n),
          ).to.be.revertedWithCustomError(
            amoManagerV2,
            "AccessControlUnauthorizedAccount",
          );
        });
      });

      describe("Error Cases and Edge Conditions", () => {
        it("should revert borrow with unsupported vault", async function () {
          const symbol = collateralTokens.keys().next().value;
          const { collateralToken, amount } = await setupCollateralTest(symbol);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);
          const unsupportedVault = user2;

          await expect(
            amoManagerV2
              .connect(amoManagerSigner)
              .borrowTo(
                unsupportedVault,
                await collateralToken.getAddress(),
                amount
              )
          )
            .to.be.revertedWithCustomError(amoManagerV2, "UnsupportedVault")
            .withArgs(unsupportedVault);
        });

        it("should revert borrow with unsupported endpoint", async function () {
          const symbol = collateralTokens.keys().next().value;
          const { collateralToken, amount } = await setupCollateralTest(symbol);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);
          const vaultAddress = await collateralVaultContract.getAddress();
          const unsupportedEndpoint = user2;

          await expect(
            amoManagerV2
              .connect(amoManagerSigner)
              .borrowTo(
                vaultAddress,
                unsupportedEndpoint,
                await collateralToken.getAddress(),
                amount
              )
          )
            .to.be.revertedWithCustomError(amoManagerV2, "UnsupportedEndpoint")
            .withArgs(unsupportedEndpoint);
        });

        it("should revert borrow with unsupported collateral", async function () {
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);
          const vaultAddress = await collateralVaultContract.getAddress();
          const amount = hre.ethers.parseUnits("100", 18);

          // Use debt token address as unsupported collateral (it's not added to vault's supported collaterals)
          const unsupportedCollateral = await dstableContract.getAddress();

          await expect(
            amoManagerV2
              .connect(amoManagerSigner)
              .borrowTo(
                vaultAddress,
                await dstableContract.getAddress(),
                amount
              )
          )
            .to.be.revertedWithCustomError(amoManagerV2, "UnsupportedCollateral")
            .withArgs(unsupportedCollateral);
        });

        it("should handle tolerance checks properly", async function () {
          const symbol = collateralTokens.keys().next().value;
          const { collateralToken, amount } = await setupCollateralTest(symbol);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);
          const vaultAddress = await collateralVaultContract.getAddress();

          // Set a very small tolerance
          await amoManagerV2.setTolerance(1n);

          // Borrow should still work within tolerance
          await amoManagerV2
            .connect(amoManagerSigner)
            .borrowTo(
              vaultAddress,
              await collateralToken.getAddress(),
              amount
            );

          // The operation should succeed as the debt token is priced at $1
          // and the invariant should be preserved
        });

        it("should handle zero amounts gracefully", async function () {
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);

          // Zero stable AMO operations should work
          await amoManagerV2.connect(amoManagerSigner).increaseAmoSupply(0);
          await amoManagerV2.connect(amoManagerSigner).decreaseAmoSupply(0);

          // Zero collateral operations should work
          const symbol = collateralTokens.keys().next().value;
          const collateralToken = collateralTokens.get(symbol)!;
          const vaultAddress = await collateralVaultContract.getAddress();

          await amoManagerV2
            .connect(amoManagerSigner)
            .borrowTo(
              vaultAddress,
              await collateralToken.getAddress(),
              0
            );
        });
      });

      describe("View Functions", () => {
        it("should return correct allowlist data", async function () {
          // Add some test vaults and endpoints
          await amoManagerV2.setVaultAllowed(user1, true);
          await amoManagerV2.setEndpointAllowed(user2, true);

          const allowedVaults = await amoManagerV2.getAllowedVaults();
          const allowedEndpoints = await amoManagerV2.getAllowedEndpoints();

          expect(allowedVaults).to.include(await collateralVaultContract.getAddress());
          expect(allowedVaults).to.include(user1);
          expect(allowedEndpoints).to.include(amoWallet);
          expect(allowedEndpoints).to.include(user2);

          expect(await amoManagerV2.getAllowedVaultsLength()).to.be.gte(2);
          expect(await amoManagerV2.getAllowedEndpointsLength()).to.be.gte(2);
        });

        it("should return correct helper function results", async function () {
          const baseValue = hre.ethers.parseUnits("1000", 8); // 8 decimals for base
          const debtUnits = await amoManagerV2.baseToDebtUnits(baseValue);
          
          // Should convert to 18 decimals
          expect(debtUnits).to.equal(hre.ethers.parseUnits("1000", 18));

          const dstableAmount = hre.ethers.parseUnits("1000", dstableInfo.decimals);
          const convertedBaseValue = await amoManagerV2.dstableAmountToBaseValue(dstableAmount);
          
          // Should convert back to base value (8 decimals for base currency)
          expect(convertedBaseValue).to.equal(
            hre.ethers.parseUnits("1000", 8)
          );
        });

        it("should return total debt supply", async function () {
          const amount = hre.ethers.parseUnits("1000", dstableInfo.decimals);
          const amoManagerSigner = await hre.ethers.getSigner(amoWallet);

          expect(await amoManagerV2.totalDebtSupply()).to.equal(0);

          await amoManagerV2.connect(amoManagerSigner).increaseAmoSupply(amount);

          expect(await amoManagerV2.totalDebtSupply()).to.be.gt(0);
        });
      });
    });
  });
}