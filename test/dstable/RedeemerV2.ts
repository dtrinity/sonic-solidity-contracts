import { assert, expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  CollateralHolderVault,
  IssuerV2,
  OracleAggregator,
  RedeemerV2,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import { ONE_HUNDRED_PERCENT_BPS } from "../../typescript/common/bps_constants";
import {
  DS_REDEEMER_CONTRACT_ID,
  DS_REDEEMER_WITH_FEES_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_REDEEMER_WITH_FEES_CONTRACT_ID,
} from "../../typescript/deploy-ids";
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

/**
 *
 * @param dstableAmount
 * @param dstableDecimals
 * @param collateralDecimals
 * @param oracleAggregator
 * @param dstableAddress
 * @param collateralAddress
 */
async function calculateExpectedCollateralAmount(
  dstableAmount: bigint,
  dstableDecimals: number,
  collateralDecimals: number,
  oracleAggregator: OracleAggregator,
  dstableAddress: string,
  collateralAddress: string,
): Promise<bigint> {
  const dstablePrice = await oracleAggregator.getAssetPrice(dstableAddress);
  const collateralPrice =
    await oracleAggregator.getAssetPrice(collateralAddress);
  const dstableBaseValue =
    (dstableAmount * dstablePrice) / 10n ** BigInt(dstableDecimals);
  return (
    (dstableBaseValue * 10n ** BigInt(collateralDecimals)) / collateralPrice
  );
}

const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  describe(`RedeemerV2 for ${config.symbol}`, () => {
    let redeemer: RedeemerV2;
    let issuer: IssuerV2;
    let collateralVault: CollateralHolderVault;
    let oracle: OracleAggregator;
    let collateralContracts: Map<string, TestERC20> = new Map();
    let collateralInfos: Map<string, TokenInfo> = new Map();
    let dstable: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let deployer: Address;
    let user1: Address;

    const fixture = createDStableFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1 } = await getNamedAccounts());

      const vaultAddress = (
        await hre.deployments.get(config.collateralVaultContractId)
      ).address;
      collateralVault = await hre.ethers.getContractAt(
        "CollateralHolderVault",
        vaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      const oracleAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracle = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAddress,
        await hre.ethers.getSigner(deployer),
      );

      // IssuerV2 from deployments
      const issuerAddress = (await hre.deployments.get(config.issuerContractId))
        .address;
      issuer = (await hre.ethers.getContractAt(
        "IssuerV2",
        issuerAddress,
        await hre.ethers.getSigner(deployer),
      )) as unknown as IssuerV2;

      // Token
      const { contract, tokenInfo } = await getTokenContractForSymbol(
        hre,
        deployer,
        config.symbol,
      );
      dstable = contract as TestMintableERC20;
      dstableInfo = tokenInfo;

      // Collaterals
      for (const symbol of config.peggedCollaterals) {
        const result = await getTokenContractForSymbol(hre, deployer, symbol);
        collateralContracts.set(symbol, result.contract);
        collateralInfos.set(symbol, result.tokenInfo);

        // Fund user and mint dstable by going through IssuerV2 fixture's deployments
        const amount = hre.ethers.parseUnits("1000", result.tokenInfo.decimals);
        await result.contract.transfer(user1, amount);
      }

      // Deploy RedeemerV2
      const RedeemerV2Factory = await hre.ethers.getContractFactory(
        "RedeemerV2",
        await hre.ethers.getSigner(deployer),
      );
      redeemer = (await RedeemerV2Factory.deploy(
        vaultAddress,
        dstableInfo.address,
        oracleAddress,
        deployer,
        0, // start with 0 bps for test default
      )) as unknown as RedeemerV2;
      await redeemer.waitForDeployment();

      // Allow redeemer to withdraw from vault
      await collateralVault.grantRole(
        await collateralVault.COLLATERAL_WITHDRAWER_ROLE(),
        await redeemer.getAddress(),
      );

      // Mint user1 some dStable by issuing through IssuerV2 with first collateral
      const [firstSymbol] = config.peggedCollaterals;
      const firstInfo = collateralInfos.get(firstSymbol)!;
      const firstToken = collateralContracts.get(firstSymbol)!;
      const depositAmount = hre.ethers.parseUnits("500", firstInfo.decimals);
      await firstToken
        .connect(await hre.ethers.getSigner(user1))
        .approve(await issuer.getAddress(), depositAmount);
      await issuer
        .connect(await hre.ethers.getSigner(user1))
        .issue(depositAmount, firstInfo.address, 0);

      // Give user1 redemption permission
      await redeemer.grantRole(await redeemer.REDEMPTION_MANAGER_ROLE(), user1);
    });

    describe("Deployment and Configuration", () => {
      it("has zero default fee and feeReceiver set to deployer by default", async function () {
        const feeReceiver = await redeemer.feeReceiver();
        const defaultFee = await redeemer.defaultRedemptionFeeBps();
        assert.equal(
          feeReceiver,
          deployer,
          "feeReceiver should default to deployer",
        );
        assert.equal(
          defaultFee,
          0n,
          "default fee bps should be zero by default",
        );
      });

      it("revokes withdrawer role from legacy Redeemer and RedeemerWithFees", async function () {
        const withRole = await collateralVault.COLLATERAL_WITHDRAWER_ROLE();
        const legacyIds = [
          config.symbol === "dUSD"
            ? DUSD_REDEEMER_CONTRACT_ID
            : DS_REDEEMER_CONTRACT_ID,
          config.symbol === "dUSD"
            ? DUSD_REDEEMER_WITH_FEES_CONTRACT_ID
            : DS_REDEEMER_WITH_FEES_CONTRACT_ID,
        ];

        for (const id of legacyIds) {
          const dep = await hre.deployments.getOrNull(id);
          if (!dep) continue;
          const has = await collateralVault.hasRole(withRole, dep.address);
          expect(has).to.equal(
            false,
            `${id} should not retain withdrawer role`,
          );
        }
      });
    });

    it("per-asset pause prevents redemption", async function () {
      const [symbol] = config.peggedCollaterals;
      const info = collateralInfos.get(symbol)!;

      await redeemer.setAssetRedemptionPause(info.address, true);

      const amount = hre.ethers.parseUnits("10", dstableInfo.decimals);
      await dstable
        .connect(await hre.ethers.getSigner(user1))
        .approve(await redeemer.getAddress(), amount);

      await expect(
        redeemer
          .connect(await hre.ethers.getSigner(user1))
          .redeem(amount, info.address, 0),
      )
        .to.be.revertedWithCustomError(redeemer, "AssetRedemptionPaused")
        .withArgs(info.address);
    });

    it("global pause prevents redemption and unpause restores", async function () {
      const [symbol] = config.peggedCollaterals;
      const info = collateralInfos.get(symbol)!;

      const amount = hre.ethers.parseUnits("5", dstableInfo.decimals);
      await dstable
        .connect(await hre.ethers.getSigner(user1))
        .approve(await redeemer.getAddress(), amount);

      await redeemer.pauseRedemption();
      await expect(
        redeemer
          .connect(await hre.ethers.getSigner(user1))
          .redeem(amount, info.address, 0),
      ).to.be.revertedWithCustomError(redeemer, "EnforcedPause");

      await redeemer.unpauseRedemption();

      // Slippage min 0 for smoke success
      await redeemer
        .connect(await hre.ethers.getSigner(user1))
        .redeem(amount, info.address, 0);
    });

    it("only PAUSER_ROLE can set asset pause/unpause", async function () {
      const [symbol] = config.peggedCollaterals;
      const info = collateralInfos.get(symbol)!;

      await expect(
        redeemer
          .connect(await hre.ethers.getSigner(user1))
          .setAssetRedemptionPause(info.address, true),
      )
        .to.be.revertedWithCustomError(
          redeemer,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(user1, await redeemer.PAUSER_ROLE());
    });

    it("isAssetRedemptionEnabled reflects pause state", async function () {
      const [symbol] = config.peggedCollaterals;
      const info = collateralInfos.get(symbol)!;
      expect(await redeemer.isAssetRedemptionEnabled(info.address)).to.be.true;
      await redeemer.setAssetRedemptionPause(info.address, true);
      expect(await redeemer.isAssetRedemptionEnabled(info.address)).to.be.false;
      await redeemer.setAssetRedemptionPause(info.address, false);
      expect(await redeemer.isAssetRedemptionEnabled(info.address)).to.be.true;
    });

    it("redemption computes amounts correctly within slippage bounds", async function () {
      const [symbol] = config.peggedCollaterals;
      const info = collateralInfos.get(symbol)!;
      const amount = hre.ethers.parseUnits("20", dstableInfo.decimals);
      await dstable
        .connect(await hre.ethers.getSigner(user1))
        .approve(await redeemer.getAddress(), amount);

      const expected = await calculateExpectedCollateralAmount(
        amount,
        dstableInfo.decimals,
        info.decimals,
        oracle,
        dstableInfo.address,
        info.address,
      );
      const minOut = (expected * 95n) / 100n;

      const userBalBefore = await (
        await hre.ethers.getContractAt(
          "TestERC20",
          info.address,
          await hre.ethers.getSigner(deployer),
        )
      )
        .connect(await hre.ethers.getSigner(user1))
        .balanceOf(user1);

      await redeemer
        .connect(await hre.ethers.getSigner(user1))
        .redeem(amount, info.address, minOut);

      const userBalAfter = await (
        await hre.ethers.getContractAt(
          "TestERC20",
          info.address,
          await hre.ethers.getSigner(deployer),
        )
      )
        .connect(await hre.ethers.getSigner(user1))
        .balanceOf(user1);

      expect(userBalAfter - userBalBefore).to.be.gte(minOut);
    });

    describe("Public Redemption with Fees", () => {
      it("applies default fee on public redemption and emits Redemption", async function () {
        const [symbol] = config.peggedCollaterals;
        const collateralToken = collateralContracts.get(symbol)!;
        const collateralInfo = collateralInfos.get(symbol)!;

        // Set default fee to 1%
        const newFee = 100n; // 1%
        await redeemer.setDefaultRedemptionFee(newFee);

        const userSigner = await hre.ethers.getSigner(user1);
        const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
        await dstable
          .connect(userSigner)
          .approve(await redeemer.getAddress(), redeemAmount);

        const dstableValue =
          await redeemer.dstableAmountToBaseValue(redeemAmount);
        const totalCollateral = await collateralVault.assetAmountFromValue(
          dstableValue,
          collateralInfo.address,
        );
        const expectedFee =
          (totalCollateral * newFee) / BigInt(ONE_HUNDRED_PERCENT_BPS);
        const expectedNet = totalCollateral - expectedFee;

        const userBefore = await collateralToken.balanceOf(user1);
        const feeReceiver = await redeemer.feeReceiver();
        const feeBefore = await collateralToken.balanceOf(feeReceiver);
        const vaultBefore = await collateralToken.balanceOf(
          await collateralVault.getAddress(),
        );

        const tx = await redeemer
          .connect(userSigner)
          .redeem(redeemAmount, collateralInfo.address, 0);

        await expect(tx)
          .to.emit(redeemer, "Redemption")
          .withArgs(
            user1,
            collateralInfo.address,
            redeemAmount,
            expectedNet,
            expectedFee,
          );

        const userAfter = await collateralToken.balanceOf(user1);
        const feeAfter = await collateralToken.balanceOf(feeReceiver);
        const vaultAfter = await collateralToken.balanceOf(
          await collateralVault.getAddress(),
        );

        assert.equal(
          userAfter - userBefore,
          expectedNet,
          "User should receive net amount after fee",
        );
        assert.equal(
          feeAfter - feeBefore,
          expectedFee,
          "Fee receiver should receive fee amount",
        );
        assert.equal(
          vaultBefore - vaultAfter,
          totalCollateral,
          "Vault decreases by total collateral redeemed",
        );
      });
    });

    describe("Protocol Redemption (No Fees)", () => {
      it("allows manager to redeem without fees", async function () {
        const [symbol] = config.peggedCollaterals;
        const collateralToken = collateralContracts.get(symbol)!;
        const collateralInfo = collateralInfos.get(symbol)!;
        const managerSigner = await hre.ethers.getSigner(user1);
        const redeemAmount = hre.ethers.parseUnits("50", dstableInfo.decimals);

        await dstable
          .connect(managerSigner)
          .approve(await redeemer.getAddress(), redeemAmount);
        const before = await collateralToken.balanceOf(user1);
        await expect(
          redeemer
            .connect(managerSigner)
            .redeemAsProtocol(redeemAmount, collateralInfo.address, 0),
        ).to.emit(redeemer, "Redemption");
        const after = await collateralToken.balanceOf(user1);
        assert.isTrue(
          after > before,
          "Manager should receive full collateral amount without fee",
        );
      });

      it("reverts if non-manager calls redeemAsProtocol", async function () {
        const [symbol] = config.peggedCollaterals;
        const collateralInfo = collateralInfos.get(symbol)!;
        const other = await hre.ethers.getSigner(deployer);
        const redeemAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        await expect(
          redeemer
            .connect(other)
            .redeemAsProtocol(redeemAmount, collateralInfo.address, 0),
        ).to.be.reverted;
      });
    });

    describe("Administrative functions", () => {
      it("allows admin to set fee receiver", async function () {
        await redeemer.setFeeReceiver(user1);
        assert.equal(
          await redeemer.feeReceiver(),
          user1,
          "Fee receiver should be updated",
        );
      });

      it("reverts when non-admin tries to set fee receiver", async function () {
        await expect(
          redeemer
            .connect(await hre.ethers.getSigner(user1))
            .setFeeReceiver(await redeemer.getAddress()),
        ).to.be.reverted;
      });

      it("allows admin to set default redemption fee and enforces max", async function () {
        await redeemer.setDefaultRedemptionFee(200); // 2%
        assert.equal(
          (await redeemer.defaultRedemptionFeeBps()).toString(),
          "200",
        );

        const maxPlusOne = (await redeemer.MAX_FEE_BPS()) + 1n;
        await expect(
          redeemer.setDefaultRedemptionFee(maxPlusOne),
        ).to.be.revertedWithCustomError(redeemer, "FeeTooHigh");
      });

      it("allows admin to set collateral-specific fee and enforces max", async function () {
        const [symbol] = config.peggedCollaterals;
        const collateralInfo = collateralInfos.get(symbol)!;
        await redeemer.setCollateralRedemptionFee(collateralInfo.address, 300); // 3%
        assert.equal(
          (
            await redeemer.collateralRedemptionFeeBps(collateralInfo.address)
          ).toString(),
          "300",
        );
        const maxPlusOne = (await redeemer.MAX_FEE_BPS()) + 1n;
        await expect(
          redeemer.setCollateralRedemptionFee(
            collateralInfo.address,
            maxPlusOne,
          ),
        ).to.be.revertedWithCustomError(redeemer, "FeeTooHigh");
      });

      it("supports clearing per-asset override (0 bps override -> clear -> fallback to default)", async function () {
        const [symbol] = config.peggedCollaterals;
        const collateralInfo = collateralInfos.get(symbol)!;
        const collateralToken = collateralContracts.get(symbol)!;

        // Set default to 1%
        const defaultFee = 100n;
        await redeemer.setDefaultRedemptionFee(defaultFee);

        // Set per-asset override to 0
        await redeemer.setCollateralRedemptionFee(collateralInfo.address, 0);
        assert.equal(
          await redeemer.isCollateralFeeOverridden(collateralInfo.address),
          true,
        );

        // Redeem and expect zero fee
        const userSigner = await hre.ethers.getSigner(user1);
        const redeemAmount = hre.ethers.parseUnits("25", dstableInfo.decimals);
        await dstable
          .connect(userSigner)
          .approve(await redeemer.getAddress(), redeemAmount);

        const dstableValue0 =
          await redeemer.dstableAmountToBaseValue(redeemAmount);
        const totalCollateral0 = await collateralVault.assetAmountFromValue(
          dstableValue0,
          collateralInfo.address,
        );
        const expectedFee0 = 0n;
        const expectedNet0 = totalCollateral0 - expectedFee0;

        const userBefore0 = await collateralToken.balanceOf(user1);
        const feeReceiver = await redeemer.feeReceiver();
        const feeBefore0 = await collateralToken.balanceOf(feeReceiver);

        await redeemer
          .connect(userSigner)
          .redeem(redeemAmount, collateralInfo.address, 0);

        const userAfter0 = await collateralToken.balanceOf(user1);
        const feeAfter0 = await collateralToken.balanceOf(feeReceiver);

        assert.equal(
          userAfter0 - userBefore0,
          expectedNet0,
          "user should receive full collateral under 0 bps override",
        );
        assert.equal(
          feeAfter0 - feeBefore0,
          expectedFee0,
          "fee receiver should not receive fee under 0 bps override",
        );

        // Clear override -> should fallback to default
        await redeemer.clearCollateralRedemptionFee(collateralInfo.address);
        assert.equal(
          await redeemer.isCollateralFeeOverridden(collateralInfo.address),
          false,
        );

        // Redeem again, expect default fee applied
        const redeemAmount2 = hre.ethers.parseUnits("20", dstableInfo.decimals);
        await dstable
          .connect(userSigner)
          .approve(await redeemer.getAddress(), redeemAmount2);
        const dstableValue2 =
          await redeemer.dstableAmountToBaseValue(redeemAmount2);
        const totalCollateral2 = await collateralVault.assetAmountFromValue(
          dstableValue2,
          collateralInfo.address,
        );
        const expectedFee2 =
          (totalCollateral2 * defaultFee) / BigInt(ONE_HUNDRED_PERCENT_BPS);
        const expectedNet2 = totalCollateral2 - expectedFee2;

        const userBefore2 = await collateralToken.balanceOf(user1);
        const feeBefore2 = await collateralToken.balanceOf(feeReceiver);

        await redeemer
          .connect(userSigner)
          .redeem(redeemAmount2, collateralInfo.address, 0);

        const userAfter2 = await collateralToken.balanceOf(user1);
        const feeAfter2 = await collateralToken.balanceOf(feeReceiver);

        assert.equal(
          userAfter2 - userBefore2,
          expectedNet2,
          "user should receive net amount after default fee once override cleared",
        );
        assert.equal(
          feeAfter2 - feeBefore2,
          expectedFee2,
          "fee receiver should receive default fee once override cleared",
        );
      });
    });
  });
});
