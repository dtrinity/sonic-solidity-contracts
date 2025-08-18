import { assert, expect } from "chai";
import { ZeroAddress } from "ethers";
import hre, { deployments, getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { getConfig } from "../../config/config"; // To access deployment config for verification
import {
  CollateralVault,
  Issuer,
  OracleAggregator,
  RedeemerWithFees,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";
import { ONE_HUNDRED_PERCENT_BPS } from "../../typescript/common/bps_constants";
import {
  DS_REDEEMER_WITH_FEES_CONTRACT_ID,
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
} from "./fixtures"; // Assuming fixtures.ts is in the same directory

// Helper to calculate expected collateral amount based on oracle prices
/**
 *
 * @param dstableAmount
 * @param dstableSymbol
 * @param dstableDecimals
 * @param collateralSymbol
 * @param collateralDecimals
 * @param oracleAggregator
 * @param dstableAddress
 * @param collateralAddress
 */
async function calculateExpectedCollateralAmount(
  dstableAmount: bigint,
  dstableSymbol: string,
  dstableDecimals: number,
  collateralSymbol: string,
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

// Create a new fixture factory for dstable with RedeemerWithFees
export const createDStableWithRedeemerWithFeesFixture = (
  config: DStableFixtureConfig,
) => {
  return deployments.createFixture(async ({ deployments }) => {
    // First, run the base dStable fixture
    const baseFixture = createDStableFixture(config);
    await baseFixture();

    // Then, deploy the RedeemerWithFees contracts
    // The deployment script '01_deploy_redeemer_with_fees.ts' uses the tag 'redeemerWithFees'
    await deployments.fixture(["redeemerWithFees"]);
  });
};

// Run tests for each dStable configuration
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

dstableConfigs.forEach((config) => {
  // Deprecated: skip legacy RedeemerWithFees tests after migrating to RedeemerV2
  describe.skip(`RedeemerWithFees for ${config.symbol}`, () => {
    let redeemerWithFeesContract: RedeemerWithFees;
    let dstableContract: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let collateralVaultContract: CollateralVault;
    let oracleAggregatorContract: OracleAggregator;
    let deployer: Address;
    let user1: Address;
    let feeReceiverSigner: any; // To hold the signer for the configured fee receiver
    let issuerContract: Issuer;
    let collateralContracts: Map<string, TestERC20>;
    let collateralInfos: Map<string, TokenInfo>;

    // Set up fixture for this specific dStable configuration with RedeemerWithFees
    const fixture = createDStableWithRedeemerWithFeesFixture(config);

    beforeEach(async function () {
      await fixture();

      ({ deployer, user1 } = await getNamedAccounts());

      const appConfig = await getConfig(hre);
      let redeemerWithFeesContractId: string;
      let configuredFeeReceiver: string;
      let configuredDefaultFeeBps: number;

      if (config.symbol === "dUSD") {
        if (
          appConfig.dStables.dUSD?.initialFeeReceiver === undefined ||
          appConfig.dStables.dUSD?.initialRedemptionFeeBps === undefined
        ) {
          throw new Error(
            "dUSD initialFeeReceiver or initialRedemptionFeeBps is undefined in config",
          );
        }
        redeemerWithFeesContractId = DUSD_REDEEMER_WITH_FEES_CONTRACT_ID;
        configuredFeeReceiver = appConfig.dStables.dUSD.initialFeeReceiver;
        configuredDefaultFeeBps =
          appConfig.dStables.dUSD.initialRedemptionFeeBps;
      } else if (config.symbol === "dS") {
        if (
          appConfig.dStables.dS?.initialFeeReceiver === undefined ||
          appConfig.dStables.dS?.initialRedemptionFeeBps === undefined
        ) {
          throw new Error(
            "dS initialFeeReceiver or initialRedemptionFeeBps is undefined in config",
          );
        }
        redeemerWithFeesContractId = DS_REDEEMER_WITH_FEES_CONTRACT_ID;
        configuredFeeReceiver = appConfig.dStables.dS.initialFeeReceiver;
        configuredDefaultFeeBps = appConfig.dStables.dS.initialRedemptionFeeBps;
      } else {
        throw new Error(
          `Unsupported dStable symbol for RedeemerWithFees tests: ${config.symbol}`,
        );
      }

      const redeemerWithFeesAddress = (
        await hre.deployments.get(redeemerWithFeesContractId)
      ).address;
      redeemerWithFeesContract = await hre.ethers.getContractAt(
        "RedeemerWithFees",
        redeemerWithFeesAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get dStable token
      const { contract: dstableTokenContract, tokenInfo: dstableTokenInfo } =
        await getTokenContractForSymbol(hre, deployer, config.symbol);
      dstableContract = dstableTokenContract as TestMintableERC20;
      dstableInfo = dstableTokenInfo;

      // Get CollateralVault (needed for context, though direct interactions might be less in unit tests)
      const collateralVaultAddress = (
        await hre.deployments.get(config.collateralVaultContractId)
      ).address;
      collateralVaultContract = await hre.ethers.getContractAt(
        "CollateralVault",
        collateralVaultAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get OracleAggregator (needed for value calculations)
      const oracleAggregatorAddress = (
        await hre.deployments.get(config.oracleAggregatorId)
      ).address;
      oracleAggregatorContract = await hre.ethers.getContractAt(
        "OracleAggregator",
        oracleAggregatorAddress,
        await hre.ethers.getSigner(deployer),
      );

      // Get the configured fee receiver
      if (configuredFeeReceiver) {
        feeReceiverSigner = await hre.ethers.getSigner(configuredFeeReceiver);
      }

      // Prepare issuer and issue dStable tokens to user1
      const issuerAddress = (await hre.deployments.get(config.issuerContractId))
        .address;
      issuerContract = await hre.ethers.getContractAt(
        "Issuer",
        issuerAddress,
        await hre.ethers.getSigner(deployer),
      );
      collateralContracts = new Map();
      collateralInfos = new Map();

      for (const collateralSymbol of config.peggedCollaterals) {
        const result = await getTokenContractForSymbol(
          hre,
          deployer,
          collateralSymbol,
        );
        const collateralContract = result.contract as TestERC20;
        const collateralInfo = result.tokenInfo;
        collateralContracts.set(collateralSymbol, collateralContract);
        collateralInfos.set(collateralSymbol, collateralInfo);
        // Transfer and approve collateral for user1
        const depositAmount = hre.ethers.parseUnits(
          "1000",
          collateralInfo.decimals,
        );
        await collateralContract.transfer(user1, depositAmount);
        const userAmount = hre.ethers.parseUnits(
          "500",
          collateralInfo.decimals,
        );
        await collateralContract
          .connect(await hre.ethers.getSigner(user1))
          .approve(await issuerContract.getAddress(), userAmount);
        // Issue dStable with 5% slippage protection
        const baseValue = await collateralVaultContract.assetValueFromAmount(
          userAmount,
          collateralInfo.address,
        );
        const expectedDstable =
          await issuerContract.baseValueToDstableAmount(baseValue);
        const minDstable = (expectedDstable * 95n) / 100n;
        await issuerContract
          .connect(await hre.ethers.getSigner(user1))
          .issue(userAmount, collateralInfo.address, minDstable);
      }
      // Grant REDEMPTION_MANAGER_ROLE to user1
      const REDEMPTION_MANAGER_ROLE =
        await redeemerWithFeesContract.REDEMPTION_MANAGER_ROLE();
      await redeemerWithFeesContract.grantRole(REDEMPTION_MANAGER_ROLE, user1);
    });

    describe("Deployment and Configuration", () => {
      it("should have the correct fee receiver and default redemption fee", async function () {
        const appConfig = await getConfig(hre);
        let expectedFeeReceiver: string;
        let expectedDefaultFeeBps: bigint;

        if (config.symbol === "dUSD") {
          if (
            appConfig.dStables.dUSD?.initialFeeReceiver === undefined ||
            appConfig.dStables.dUSD?.initialRedemptionFeeBps === undefined
          ) {
            throw new Error(
              "dUSD initialFeeReceiver or initialRedemptionFeeBps is undefined in config for assertion",
            );
          }
          expectedFeeReceiver = appConfig.dStables.dUSD.initialFeeReceiver;
          expectedDefaultFeeBps = BigInt(
            appConfig.dStables.dUSD.initialRedemptionFeeBps,
          );
        } else if (config.symbol === "dS") {
          // This part will be used when DS_CONFIG is added to dstableConfigs
          if (
            appConfig.dStables.dS?.initialFeeReceiver === undefined ||
            appConfig.dStables.dS?.initialRedemptionFeeBps === undefined
          ) {
            throw new Error(
              "dS initialFeeReceiver or initialRedemptionFeeBps is undefined in config for assertion",
            );
          }
          expectedFeeReceiver = appConfig.dStables.dS.initialFeeReceiver;
          expectedDefaultFeeBps = BigInt(
            appConfig.dStables.dS.initialRedemptionFeeBps,
          );
        } else {
          throw new Error(`Unsupported dStable symbol: ${config.symbol}`);
        }

        const actualFeeReceiver = await redeemerWithFeesContract.feeReceiver();
        const actualDefaultFeeBps =
          await redeemerWithFeesContract.defaultRedemptionFeeBps();

        assert.equal(
          actualFeeReceiver,
          expectedFeeReceiver,
          "Fee receiver is not correctly set",
        );
        assert.equal(
          actualDefaultFeeBps,
          expectedDefaultFeeBps,
          "Default redemption fee BPS is not correctly set",
        );
      });
    });

    describe("Public Redemption with Fees", () => {
      config.peggedCollaterals.forEach((collateralSymbol) => {
        it(`redeems ${config.symbol} for ${collateralSymbol} with default fee`, async function () {
          const collateralContract = collateralContracts.get(collateralSymbol)!;
          const collateralInfo = collateralInfos.get(collateralSymbol)!;
          const userSigner = await hre.ethers.getSigner(user1);
          const redeemerAddress = await redeemerWithFeesContract.getAddress();
          const feeReceiverAddress =
            await redeemerWithFeesContract.feeReceiver();
          // Redeem amount
          const redeemAmount = hre.ethers.parseUnits(
            "100",
            dstableInfo.decimals,
          );
          // Approve redeemer
          await dstableContract
            .connect(userSigner)
            .approve(redeemerAddress, redeemAmount);
          // Calculate expected total collateral using contract logic
          const dstableValue =
            await redeemerWithFeesContract.dstableAmountToBaseValue(
              redeemAmount,
            );
          const totalCollateral =
            await collateralVaultContract.assetAmountFromValue(
              dstableValue,
              collateralInfo.address,
            );
          const defaultFeeBp = BigInt(
            (
              await redeemerWithFeesContract.defaultRedemptionFeeBps()
            ).toString(),
          );
          const expectedFee =
            (totalCollateral * defaultFeeBp) / BigInt(ONE_HUNDRED_PERCENT_BPS);
          const expectedNet = totalCollateral - expectedFee;
          // Balances before
          const userCollateralBefore =
            await collateralContract.balanceOf(user1);
          const feeBefore =
            await collateralContract.balanceOf(feeReceiverAddress);
          const vaultBefore = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress(),
          );

          // Redeem
          const tx = await redeemerWithFeesContract
            .connect(userSigner)
            .redeem(redeemAmount, collateralInfo.address, 0);
          // Check event
          await expect(tx)
            .to.emit(redeemerWithFeesContract, "Redemption")
            .withArgs(
              user1,
              collateralInfo.address,
              redeemAmount,
              expectedNet,
              expectedFee,
            );
          // Balances after
          const userCollateralAfter = await collateralContract.balanceOf(user1);
          const feeAfter =
            await collateralContract.balanceOf(feeReceiverAddress);
          const vaultAfter = await collateralContract.balanceOf(
            await collateralVaultContract.getAddress(),
          );

          assert.equal(
            (userCollateralAfter - userCollateralBefore).toString(),
            expectedNet.toString(),
            "User receives net collateral after fee",
          );
          assert.equal(
            (feeAfter - feeBefore).toString(),
            expectedFee.toString(),
            "Fee receiver gets correct fee amount",
          );
          assert.equal(
            (vaultBefore - vaultAfter).toString(),
            totalCollateral.toString(),
            "Vault balance decreases by total collateral",
          );
        });

        it(`reverts if slippage is too high for ${config.symbol}`, async function () {
          const collateralInfo = collateralInfos.get(collateralSymbol)!;
          const userSigner = await hre.ethers.getSigner(user1);
          const redeemAmount = hre.ethers.parseUnits(
            "100",
            dstableInfo.decimals,
          );
          await dstableContract
            .connect(userSigner)
            .approve(await redeemerWithFeesContract.getAddress(), redeemAmount);
          const highMin = hre.ethers.parseUnits(
            "1000000",
            collateralInfo.decimals,
          );
          await expect(
            redeemerWithFeesContract
              .connect(userSigner)
              .redeem(redeemAmount, collateralInfo.address, highMin),
          ).to.be.revertedWithCustomError(
            redeemerWithFeesContract,
            "SlippageTooHigh",
          );
        });

        it("reverts when redeeming an unsupported collateral asset", async function () {
          const TestERC20Factory = await hre.ethers.getContractFactory(
            "TestERC20",
            await hre.ethers.getSigner(deployer),
          );
          const unsupportedCollateralContract = await TestERC20Factory.deploy(
            "Unsupported Token",
            "UNSUP",
            18,
          );
          await unsupportedCollateralContract.waitForDeployment();

          const userSigner = await hre.ethers.getSigner(user1);

          // Give the user some allowance of dStable for redemption
          const redeemAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
          await dstableContract
            .connect(userSigner)
            .approve(await redeemerWithFeesContract.getAddress(), redeemAmount);

          // Expect revert due to unsupported collateral
          await expect(
            redeemerWithFeesContract
              .connect(userSigner)
              .redeem(
                redeemAmount,
                await unsupportedCollateralContract.getAddress(),
                0,
              ),
          )
            .to.be.revertedWithCustomError(
              collateralVaultContract,
              "UnsupportedCollateral",
            )
            .withArgs(await unsupportedCollateralContract.getAddress());
        });
      });
    });

    describe("Protocol Redemption (No Fees)", () => {
      it("allows manager to redeem without fees", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralContract = collateralContracts.get(collateralSymbol)!;
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const managerSigner = await hre.ethers.getSigner(user1);
        const redeemAmount = hre.ethers.parseUnits("100", dstableInfo.decimals);
        await dstableContract
          .connect(managerSigner)
          .approve(await redeemerWithFeesContract.getAddress(), redeemAmount);
        const userCollateralBefore = await collateralContract.balanceOf(user1);
        // Redeem as protocol
        await expect(
          redeemerWithFeesContract
            .connect(managerSigner)
            .redeemAsProtocol(redeemAmount, collateralInfo.address, 0),
        ).to.emit(redeemerWithFeesContract, "Redemption");
        const userCollateralAfter = await collateralContract.balanceOf(user1);
        assert.isTrue(
          userCollateralAfter > userCollateralBefore,
          "Manager should receive collateral",
        );
      });

      it("reverts if non-manager calls redeemAsProtocol", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const otherSigner = await hre.ethers.getSigner(deployer);
        const redeemAmount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        await expect(
          redeemerWithFeesContract
            .connect(otherSigner)
            .redeemAsProtocol(redeemAmount, collateralInfo.address, 0),
        ).to.be.reverted;
      });
    });

    describe("Administrative functions", () => {
      it("allows admin to set fee receiver", async function () {
        const newReceiver = user1;
        await redeemerWithFeesContract.setFeeReceiver(newReceiver);
        assert.equal(
          await redeemerWithFeesContract.feeReceiver(),
          newReceiver,
          "Fee receiver should be updated",
        );
      });

      it("reverts when non-admin tries to set fee receiver", async function () {
        const nonAdmin = await hre.ethers.getSigner(user1);
        await expect(
          redeemerWithFeesContract
            .connect(nonAdmin)
            .setFeeReceiver(ZeroAddress),
        ).to.be.reverted;
      });

      it("allows admin to set default redemption fee", async function () {
        const newFee = 100; // 1%
        await redeemerWithFeesContract.setDefaultRedemptionFee(newFee);
        assert.equal(
          (await redeemerWithFeesContract.defaultRedemptionFeeBps()).toString(),
          newFee.toString(),
          "Default fee should be updated",
        );
      });

      it("reverts if admin sets default fee above max", async function () {
        const maxFee = (await redeemerWithFeesContract.MAX_FEE_BPS()) + 1n;
        await expect(
          redeemerWithFeesContract.setDefaultRedemptionFee(maxFee),
        ).to.be.revertedWithCustomError(redeemerWithFeesContract, "FeeTooHigh");
      });

      it("allows admin to set collateral-specific fee", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const newFee = 200; // 2%
        await redeemerWithFeesContract.setCollateralRedemptionFee(
          collateralInfo.address,
          newFee,
        );
        assert.equal(
          (
            await redeemerWithFeesContract.collateralRedemptionFeeBps(
              collateralInfo.address,
            )
          ).toString(),
          newFee.toString(),
          "Collateral fee should be updated",
        );
      });

      it("reverts if admin sets collateral fee above max", async function () {
        const collateralSymbol = config.peggedCollaterals[0];
        const collateralInfo = collateralInfos.get(collateralSymbol)!;
        const maxFee = (await redeemerWithFeesContract.MAX_FEE_BPS()) + 1n;
        await expect(
          redeemerWithFeesContract.setCollateralRedemptionFee(
            collateralInfo.address,
            maxFee,
          ),
        ).to.be.revertedWithCustomError(redeemerWithFeesContract, "FeeTooHigh");
      });
    });

    describe("Utility functions", () => {
      it("dstableAmountToBaseValue returns correct base value", async function () {
        const amount = hre.ethers.parseUnits("1", dstableInfo.decimals);
        const baseUnit = await redeemerWithFeesContract.baseCurrencyUnit();
        const expected =
          (amount * baseUnit) / 10n ** BigInt(dstableInfo.decimals);
        assert.equal(
          (
            await redeemerWithFeesContract.dstableAmountToBaseValue(amount)
          ).toString(),
          expected.toString(),
          "Base value calculation should match",
        );
      });
    });
  });
});
