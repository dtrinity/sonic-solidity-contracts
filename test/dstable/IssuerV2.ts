import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  IssuerV2,
  OracleAggregator,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import {
  createDStableFixture,
  DS_CONFIG,
  DStableFixtureConfig,
  DUSD_CONFIG,
} from "./fixtures";

// Define which assets are yield-bearing vs stable for reference
const yieldBearingAssets = new Set(["sfrxUSD", "sUSDS", "stS", "wOS"]);
const isYieldBearingAsset = (symbol: string): boolean =>
  yieldBearingAssets.has(symbol);

/**
 *
 * @param collateralAmount
 * @param collateralSymbol
 * @param collateralDecimals
 * @param dstableSymbol
 * @param dstableDecimals
 * @param oracleAggregator
 * @param collateralAddress
 * @param dstableAddress
 */
async function calculateExpectedDstableAmount(
  collateralAmount: bigint,
  collateralSymbol: string,
  collateralDecimals: number,
  dstableSymbol: string,
  dstableDecimals: number,
  oracleAggregator: OracleAggregator,
  collateralAddress: string,
  dstableAddress: string,
): Promise<bigint> {
  const collateralPrice =
    await oracleAggregator.getAssetPrice(collateralAddress);
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);
  const collateralBaseValue =
    (collateralAmount * collateralPrice) / 10n ** BigInt(collateralDecimals);
  return (collateralBaseValue * 10n ** BigInt(dstableDecimals)) / dstablePrice;
}

/**
 *
 * @param baseValue
 * @param dstableSymbol
 * @param dstableDecimals
 * @param oracleAggregator
 * @param dstableAddress
 */
async function calculateExpectedDstableFromBase(
  baseValue: bigint,
  dstableSymbol: string,
  dstableDecimals: number,
  oracleAggregator: OracleAggregator,
  dstableAddress: string,
): Promise<bigint> {
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);
  return (baseValue * 10n ** BigInt(dstableDecimals)) / dstablePrice;
}

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`IssuerV2 for ${config.symbol}`, () => {
    let issuerV2: IssuerV2;
    let collateralVaultContract: CollateralHolderVault;
    let amoManagerContract: AmoManager;
    let oracleAggregatorContract: OracleAggregator;
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

      const collateralVaultAddress = (
        await hre.deployments.get(config.collateralVaultContractId)
      ).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      const amoManagerAddress = (await hre.deployments.get(config.amoManagerId))
        .address;
      amoManagerContract = await hre.ethers.getContractAt(
        "AmoManager",
        amoManagerAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the oracle aggregator based on the dStable configuration
      const oracleAggregatorAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get dStable token
      const dstableResult = await getTokenContractForSymbol(
        hre,
        deployer,
        config.symbol,
      );
      dstableContract = dstableResult.contract as TestMintableERC20;
      dstableInfo = dstableResult.tokenInfo;

      // Get collateral tokens
      for (const symbol of config.peggedCollaterals) {
        const result = await getTokenContractForSymbol(hre, deployer, symbol);
        collateralContracts.set(symbol, result.contract);
        collateralInfos.set(symbol, result.tokenInfo);

        // Allow this collateral in the vault
        try {
          await collateralVaultContract.allowCollateral(
            result.tokenInfo.address,
          );
        } catch (e) {
          // Ignore if already allowed
        }

        // Transfer tokens to test users
        const amount = hre.ethers.parseUnits(
          "10000",
          result.tokenInfo.decimals,
        );
        await result.contract.transfer(user1, amount);
        await result.contract.transfer(user2, amount);
      }

      // Deploy IssuerV2 pointing at existing ecosystem contracts
      const IssuerV2Factory = await hre.ethers.getContractFactory(
        "IssuerV2",
        await hre.ethers.getSigner(deployer),
      );
      issuerV2 = (await IssuerV2Factory.deploy(
        collateralVaultAddress,
        dstableInfo.address,
        oracleAggregatorAddress,
        amoManagerAddress,
      )) as unknown as IssuerV2;
      await issuerV2.waitForDeployment();

      // Grant MINTER_ROLE to IssuerV2 on the real stablecoin (upgradeable impl)
      const stableWithRoles = await hre.ethers.getContractAt(
        "ERC20StablecoinUpgradeable",
        dstableInfo.address,
        await hre.ethers.getSigner(deployer),
      );
      const MINTER_ROLE = await (stableWithRoles as any).MINTER_ROLE();
      await (stableWithRoles as any).grantRole(
        MINTER_ROLE,
        await issuerV2.getAddress(),
      );
    });

    describe("Permissionless issuance", () => {
      // Test for each collateral type
      config.peggedCollaterals.forEach((collateralSymbol) => {
        it(`issues ${config.symbol} in exchange for ${collateralSymbol} collateral`, async function () {
          const collateralContract = collateralContracts.get(
            collateralSymbol,
          ) as TestERC20;
          const collateralInfo = collateralInfos.get(
            collateralSymbol,
          ) as TokenInfo;

          const collateralAmount = hre.ethers.parseUnits(
            "1000",
            collateralInfo.decimals,
          );

          const expectedDstableAmount = await calculateExpectedDstableAmount(
            collateralAmount,
            collateralSymbol,
            collateralInfo.decimals,
            config.symbol,
            dstableInfo.decimals,
            oracleAggregatorContract,
            collateralInfo.address,
            dstableInfo.address,
          );

          const minDStable = expectedDstableAmount;

          const vaultBalanceBefore = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress(),
          );
          const userDstableBalanceBefore =
            await dstableContract.balanceOf(user1);

          await collateralContract
            .connect(await hre.ethers.getSigner(user1))
            .approve(await issuerV2.getAddress(), collateralAmount);

          await issuerV2
            .connect(await hre.ethers.getSigner(user1))
            .issue(collateralAmount, collateralInfo.address, minDStable);

          const vaultBalanceAfter = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress(),
          );
          const userDstableBalanceAfter =
            await dstableContract.balanceOf(user1);

          assert.equal(
            vaultBalanceAfter - vaultBalanceBefore,
            collateralAmount,
            "Collateral vault balance did not increase by the expected amount",
          );

          const dstableReceived =
            userDstableBalanceAfter - userDstableBalanceBefore;

          assert.equal(
            dstableReceived,
            expectedDstableAmount,
            `User did not receive the expected amount of dStable. Expected ${expectedDstableAmount}, received ${dstableReceived}`,
          );
        });

        it(`cannot issue ${config.symbol} when asset minting is paused for ${collateralSymbol}`, async function () {
          const collateralInfo = collateralInfos.get(
            collateralSymbol,
          ) as TokenInfo;

          // Pause asset for minting
          await issuerV2.setAssetMintingPause(collateralInfo.address, true);

          const collateralAmount = hre.ethers.parseUnits(
            "100",
            collateralInfo.decimals,
          );

          await expect(
            issuerV2
              .connect(await hre.ethers.getSigner(user1))
              .issue(collateralAmount, collateralInfo.address, 0),
          )
            .to.be.revertedWithCustomError(issuerV2, "AssetMintingPaused")
            .withArgs(collateralInfo.address);

          // Re-enable and verify succeeds
          await issuerV2.setAssetMintingPause(collateralInfo.address, false);
        });
      });

      it(`circulatingDstable calculates correctly for ${config.symbol}`, async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol,
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol,
        ) as TokenInfo;

        const collateralAmount = hre.ethers.parseUnits(
          "1000",
          collateralInfo.decimals,
        );

        const expectedDstableAmount = await calculateExpectedDstableAmount(
          collateralAmount,
          collateralSymbol,
          collateralInfo.decimals,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          collateralInfo.address,
          dstableInfo.address,
        );

        await collateralContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerV2.getAddress(), collateralAmount);

        await issuerV2
          .connect(await hre.ethers.getSigner(user1))
          .issue(
            collateralAmount,
            collateralInfo.address,
            expectedDstableAmount,
          );

        const amoSupply = hre.ethers.parseUnits("500", dstableInfo.decimals);
        await issuerV2.increaseAmoSupply(amoSupply);

        const totalSupply = await dstableContract.totalSupply();
        const actualAmoSupply = await amoManagerContract.totalAmoSupply();
        const expectedCirculating = totalSupply - actualAmoSupply;

        const actualCirculating = await issuerV2.circulatingDstable();

        assert.equal(
          actualCirculating,
          expectedCirculating,
          "Circulating dStable calculation is incorrect",
        );
        assert.notEqual(
          actualCirculating,
          totalSupply,
          "Circulating dStable should be less than total supply",
        );
        assert.notEqual(actualAmoSupply, 0n, "AMO supply should not be zero");
      });

      it(`baseValueToDstableAmount converts correctly for ${config.symbol}`, async function () {
        const baseValue = hre.ethers.parseUnits(
          "100",
          ORACLE_AGGREGATOR_PRICE_DECIMALS,
        );

        const expectedDstableAmount = await calculateExpectedDstableFromBase(
          baseValue,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          dstableInfo.address,
        );

        const actualDstableAmount =
          await issuerV2.baseValueToDstableAmount(baseValue);

        assert.equal(
          actualDstableAmount,
          expectedDstableAmount,
          `Base value to ${config.symbol} conversion is incorrect`,
        );
      });

      it("reverts when issuing with unsupported collateral", async function () {
        const TestERC20Factory = await hre.ethers.getContractFactory(
          "TestERC20",
          await hre.ethers.getSigner(deployer),
        );
        const unsupportedCollateralContract = await TestERC20Factory.deploy(
          "RogueToken",
          "RGT",
          18,
        );
        await unsupportedCollateralContract.waitForDeployment();

        const unsupportedCollateralInfo = {
          address: await unsupportedCollateralContract.getAddress(),
          symbol: "RGT",
          name: "RogueToken",
          decimals: 18,
        } as const;

        const unsupportedAmount = hre.ethers.parseUnits("1000", 18);
        await unsupportedCollateralContract.transfer(user1, unsupportedAmount);

        await unsupportedCollateralContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerV2.getAddress(), unsupportedAmount);

        await expect(
          issuerV2
            .connect(await hre.ethers.getSigner(user1))
            .issue(unsupportedAmount, unsupportedCollateralInfo.address, 0),
        )
          .to.be.revertedWithCustomError(issuerV2, "UnsupportedCollateral")
          .withArgs(unsupportedCollateralInfo.address);
      });
    });

    describe("Permissioned and control behaviors", () => {
      it("only PAUSER_ROLE can set asset minting pause", async function () {
        const [collateralSymbol] = config.peggedCollaterals;
        const collateralInfo = collateralInfos.get(
          collateralSymbol,
        ) as TokenInfo;

        // user1 should not have permission
        await expect(
          issuerV2
            .connect(await hre.ethers.getSigner(user1))
            .setAssetMintingPause(collateralInfo.address, true),
        )
          .to.be.revertedWithCustomError(
            issuerV2,
            "AccessControlUnauthorizedAccount",
          )
          .withArgs(user1, await issuerV2.PAUSER_ROLE());

        // deployer can set
        await issuerV2.setAssetMintingPause(collateralInfo.address, true);
        expect(await issuerV2.isAssetMintingEnabled(collateralInfo.address)).to
          .be.false;
        await issuerV2.setAssetMintingPause(collateralInfo.address, false);
        expect(await issuerV2.isAssetMintingEnabled(collateralInfo.address)).to
          .be.true;
      });

      it("pause prevents minting functions and unpause restores", async function () {
        const [collateralSymbol] = config.peggedCollaterals;
        const collateralContract = collateralContracts.get(
          collateralSymbol,
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol,
        ) as TokenInfo;

        const collateralAmount = hre.ethers.parseUnits(
          "10",
          collateralInfo.decimals,
        );
        await collateralContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerV2.getAddress(), collateralAmount);

        // Pause by deployer (has PAUSER_ROLE)
        await issuerV2.pauseMinting();

        await expect(
          issuerV2
            .connect(await hre.ethers.getSigner(user1))
            .issue(collateralAmount, collateralInfo.address, 0),
        ).to.be.revertedWithCustomError(issuerV2, "EnforcedPause");

        await expect(
          issuerV2.issueUsingExcessCollateral(user2, 1n),
        ).to.be.revertedWithCustomError(issuerV2, "EnforcedPause");

        await expect(
          issuerV2.increaseAmoSupply(1n),
        ).to.be.revertedWithCustomError(issuerV2, "EnforcedPause");

        // Only PAUSER_ROLE can unpause; user1 should fail
        await expect(
          issuerV2.connect(await hre.ethers.getSigner(user1)).unpauseMinting(),
        )
          .to.be.revertedWithCustomError(
            issuerV2,
            "AccessControlUnauthorizedAccount",
          )
          .withArgs(user1, await issuerV2.PAUSER_ROLE());

        // Unpause by deployer
        await issuerV2.unpauseMinting();

        // Should succeed now
        await issuerV2
          .connect(await hre.ethers.getSigner(user1))
          .issue(collateralAmount, collateralInfo.address, 0);
      });

      it(`increaseAmoSupply mints ${config.symbol} to AMO Manager`, async function () {
        const amoSupply = hre.ethers.parseUnits("1000", dstableInfo.decimals);

        const initialAmoBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress(),
        );
        const initialAmoSupply = await amoManagerContract.totalAmoSupply();

        await issuerV2.increaseAmoSupply(amoSupply);

        const finalAmoBalance = await dstableContract.balanceOf(
          await amoManagerContract.getAddress(),
        );
        const finalAmoSupply = await amoManagerContract.totalAmoSupply();

        assert.equal(
          finalAmoBalance - initialAmoBalance,
          amoSupply,
          "AMO Manager balance did not increase by the expected amount",
        );
        assert.equal(
          finalAmoSupply - initialAmoSupply,
          amoSupply,
          "AMO supply did not increase by the expected amount",
        );
      });

      it(`issueUsingExcessCollateral respects collateral limits for ${config.symbol}`, async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralContract = collateralContracts.get(
          collateralSymbol,
        ) as TestERC20;
        const collateralInfo = collateralInfos.get(
          collateralSymbol,
        ) as TokenInfo;

        // Ensure there's excess collateral
        const collateralAmount = hre.ethers.parseUnits(
          "2000",
          collateralInfo.decimals,
        );
        await collateralContract.approve(
          await collateralVaultContract.getAddress(),
          collateralAmount,
        );
        await collateralVaultContract.deposit(
          collateralAmount,
          collateralInfo.address,
        );

        const collateralValueInDstable = await calculateExpectedDstableAmount(
          collateralAmount,
          collateralSymbol,
          collateralInfo.decimals,
          config.symbol,
          dstableInfo.decimals,
          oracleAggregatorContract,
          collateralInfo.address,
          dstableInfo.address,
        );

        const initialCirculatingDstable = await issuerV2.circulatingDstable();

        const amountToMint = collateralValueInDstable / 2n;
        const receiver = user2;
        const initialReceiverBalance =
          await dstableContract.balanceOf(receiver);

        await issuerV2.issueUsingExcessCollateral(receiver, amountToMint);

        const finalCirculatingDstable = await issuerV2.circulatingDstable();
        const finalReceiverBalance = await dstableContract.balanceOf(receiver);

        assert.equal(
          finalCirculatingDstable - initialCirculatingDstable,
          amountToMint,
          "Circulating dStable was not increased correctly",
        );
        assert.equal(
          finalReceiverBalance - initialReceiverBalance,
          amountToMint,
          "Receiver balance was not increased correctly",
        );
      });
    });
  });
});
