import { assert } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  Issuer,
  TestERC20,
  MockAmoVault,
  OracleAggregator,
} from "../../typechain-types";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { TokenInfo } from "../../typescript/token/utils";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { standaloneAmoFixture } from "./fixtures";
import {
  DUSD_AMO_MANAGER_ID,
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

describe("dStable Ecosystem Lifecycle", () => {
  let amoManagerContract: AmoManager;
  let mockAmoVaultContract: MockAmoVault;
  let collateralHolderVaultContract: CollateralHolderVault;
  let oracleAggregatorContract: OracleAggregator;
  let issuerContract: Issuer;
  let dstableContract: TestERC20;
  let dstableInfo: TokenInfo;
  let frxUSDContract: TestERC20;
  let frxUSDInfo: TokenInfo;
  let usdcContract: TestERC20;
  let usdcInfo: TokenInfo;
  let deployer: Address;
  let user1: Address;
  let user2: Address;
  let redeemerContract: any; // Using any type for now

  beforeEach(async function () {
    await standaloneAmoFixture();

    /* Set up accounts */

    ({ deployer, user1, user2 } = await getNamedAccounts());

    /* Set up contracts */

    const amoManagerAddress = (await hre.deployments.get(DUSD_AMO_MANAGER_ID))
      .address;
    amoManagerContract = await hre.ethers.getContractAt(
      "AmoManager",
      amoManagerAddress,
      await hre.ethers.getSigner(deployer)
    );

    const mockAmoVaultAddress = (await hre.deployments.get("MockAmoVault"))
      .address;
    mockAmoVaultContract = await hre.ethers.getContractAt(
      "MockAmoVault",
      mockAmoVaultAddress,
      await hre.ethers.getSigner(deployer)
    );

    const collateralHolderVaultAddress = (
      await hre.deployments.get(DUSD_COLLATERAL_VAULT_CONTRACT_ID)
    ).address;
    collateralHolderVaultContract = await hre.ethers.getContractAt(
      "CollateralHolderVault",
      collateralHolderVaultAddress,
      await hre.ethers.getSigner(deployer)
    );

    const oracleAggregatorAddress = (
      await hre.deployments.get(ORACLE_AGGREGATOR_ID)
    ).address;
    oracleAggregatorContract = await hre.ethers.getContractAt(
      "OracleAggregator",
      oracleAggregatorAddress,
      await hre.ethers.getSigner(deployer)
    );

    /* Set up tokens */

    ({ contract: dstableContract, tokenInfo: dstableInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));
    ({ contract: frxUSDContract, tokenInfo: frxUSDInfo } =
      await getTokenContractForSymbol(hre, deployer, "frxUSD"));
    ({ contract: usdcContract, tokenInfo: usdcInfo } =
      await getTokenContractForSymbol(hre, deployer, "USDC"));

    const issuerAddress = (await hre.deployments.get(DUSD_ISSUER_CONTRACT_ID))
      .address;
    issuerContract = await hre.ethers.getContractAt(
      "Issuer",
      issuerAddress,
      await hre.ethers.getSigner(deployer)
    );

    // Get the Redeemer contract
    const redeemerAddress = (
      await hre.deployments.get(DUSD_REDEEMER_CONTRACT_ID)
    ).address;
    redeemerContract = await hre.ethers.getContractAt(
      "Redeemer",
      redeemerAddress,
      await hre.ethers.getSigner(deployer)
    );

    /* Enable the MockAmoVault */

    await amoManagerContract.enableAmoVault(
      await mockAmoVaultContract.getAddress()
    );

    /* Allow tokens as collateral */

    await collateralHolderVaultContract.allowCollateral(frxUSDInfo.address);
    await collateralHolderVaultContract.allowCollateral(usdcInfo.address);
    await mockAmoVaultContract.allowCollateral(frxUSDInfo.address);
    await mockAmoVaultContract.allowCollateral(usdcInfo.address);

    /* Assign the COLLATERAL_WITHDRAWER_ROLE to the AMO manager */

    await mockAmoVaultContract.grantRole(
      await mockAmoVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
      await amoManagerContract.getAddress()
    );
    await collateralHolderVaultContract.grantRole(
      await collateralHolderVaultContract.COLLATERAL_WITHDRAWER_ROLE(),
      await amoManagerContract.getAddress()
    );

    /* Grant REDEMPTION_MANAGER_ROLE to test users */
    const REDEMPTION_MANAGER_ROLE =
      await redeemerContract.REDEMPTION_MANAGER_ROLE();
    await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user1);
    await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user2);
  });

  /**
   * Check the invariants of the dStable ecosystem
   *
   * @returns void
   */
  async function checkInvariants(): Promise<void> {
    const circulatingSupply = await issuerContract.circulatingDstable();
    const totalCollateralValueInDstable =
      await issuerContract.collateralInDstable();
    const totalSupply = await dstableContract.totalSupply();
    const amoSupply = await amoManagerContract.totalAmoSupply();

    assert.isTrue(
      circulatingSupply <= totalCollateralValueInDstable,
      `Circulating supply should not exceed total collateral value: ${circulatingSupply} <= ${totalCollateralValueInDstable}`
    );
    assert.isTrue(
      totalSupply <= circulatingSupply + amoSupply,
      `Total supply should not exceed circulating supply + AMO supply: ${totalSupply} <= ${circulatingSupply} + ${amoSupply}`
    );
  }

  /**
   * Calculates the total value of tokens in a wallet converted to USD
   *
   * @param wallet - The address of the wallet to calculate value for
   * @returns The total value of all tokens in the wallet in USD
   */
  async function calculateWalletValue(wallet: Address): Promise<bigint> {
    const frxUSDBalance = await frxUSDContract.balanceOf(wallet);
    const usdcBalance = await usdcContract.balanceOf(wallet);
    const dstableBalance = await dstableContract.balanceOf(wallet);

    const frxUSDValue = await tokenAmountToBaseValue(
      frxUSDBalance,
      frxUSDInfo.address
    );
    const usdcValue = await tokenAmountToBaseValue(
      usdcBalance,
      usdcInfo.address
    );
    const dstableValue = await tokenAmountToBaseValue(
      dstableBalance,
      dstableInfo.address
    );

    return frxUSDValue + usdcValue + dstableValue;
  }

  /**
   * Converts a token amount to its equivalent value in another token
   *
   * @param inputAmount - The amount of the input token
   * @param inputToken - The address of the input token
   * @param outputToken - The address of the output token
   * @returns The equivalent amount of the output token
   */
  async function convertToEquivalentValueInOutputToken(
    inputAmount: bigint,
    inputToken: Address,
    outputToken: Address
  ): Promise<bigint> {
    // First convert to base value
    const baseValue = await tokenAmountToBaseValue(inputAmount, inputToken);

    // Then convert from base value to output token
    const outputTokenPrice =
      await oracleAggregatorContract.getAssetPrice(outputToken);
    const outputTokenDecimals = await (
      await hre.ethers.getContractAt("TestERC20", outputToken)
    ).decimals();

    return (baseValue * 10n ** BigInt(outputTokenDecimals)) / outputTokenPrice;
  }

  /**
   * Converts a token amount to its base value
   *
   * @param amount - The amount of the token
   * @param token - The address of the token
   * @returns The base value of the token amount
   */
  async function tokenAmountToBaseValue(
    amount: bigint,
    token: Address
  ): Promise<bigint> {
    const price = await oracleAggregatorContract.getAssetPrice(token);
    const decimals = await (
      await hre.ethers.getContractAt("TestERC20", token)
    ).decimals();
    return (amount * price) / 10n ** decimals;
  }

  it("should maintain invariants throughout the lifecycle", async function () {
    // Initial state check
    await checkInvariants();

    // 1. Transfer tokens to users for testing
    await frxUSDContract.transfer(
      user1,
      hre.ethers.parseUnits("1000", frxUSDInfo.decimals)
    );
    await usdcContract.transfer(
      user2,
      hre.ethers.parseUnits("1000", usdcInfo.decimals)
    );

    // 2. User 1 deposits 500 FRAX to mint 500 dStable (leaving 500 FRAX for later)
    const fraxToDeposit = hre.ethers.parseUnits("500", frxUSDInfo.decimals);
    const minDstableForFrax = hre.ethers.parseUnits(
      "500",
      dstableInfo.decimals
    );

    await frxUSDContract
      .connect(await hre.ethers.getSigner(user1))
      .approve(await issuerContract.getAddress(), fraxToDeposit);

    await issuerContract
      .connect(await hre.ethers.getSigner(user1))
      .issue(fraxToDeposit, frxUSDInfo.address, minDstableForFrax);

    await checkInvariants();

    // 3. User 2 deposits 500 USDC to mint 500 dStable
    const usdcToDeposit = hre.ethers.parseUnits("500", usdcInfo.decimals);
    const minDstableForUsdc = hre.ethers.parseUnits(
      "500",
      dstableInfo.decimals
    );

    await usdcContract
      .connect(await hre.ethers.getSigner(user2))
      .approve(await issuerContract.getAddress(), usdcToDeposit);

    await issuerContract
      .connect(await hre.ethers.getSigner(user2))
      .issue(usdcToDeposit, usdcInfo.address, minDstableForUsdc);

    await checkInvariants();

    // Ensure both users have the expected dStable balances
    const user1DstableBalance = await dstableContract.balanceOf(user1);
    assert.isTrue(
      user1DstableBalance >= minDstableForFrax,
      `User1 should have at least ${hre.ethers.formatUnits(minDstableForFrax, dstableInfo.decimals)} dStable`
    );

    const user2DstableBalance = await dstableContract.balanceOf(user2);
    assert.isTrue(
      user2DstableBalance >= minDstableForUsdc,
      `User2 should have at least ${hre.ethers.formatUnits(minDstableForUsdc, dstableInfo.decimals)} dStable`
    );

    // 4. Allocate 200 dStable to the AMO vault
    const dstableToAllocate = hre.ethers.parseUnits(
      "200",
      dstableInfo.decimals
    );
    await issuerContract.increaseAmoSupply(dstableToAllocate);
    await amoManagerContract.allocateAmo(
      await mockAmoVaultContract.getAddress(),
      dstableToAllocate
    );

    await checkInvariants();

    // 5. AMO vault uses the dStable to acquire more collateral
    // Simulate this by directly transferring collateral to the AMO vault
    await frxUSDContract.transfer(
      await mockAmoVaultContract.getAddress(),
      hre.ethers.parseUnits("100", frxUSDInfo.decimals)
    );

    await checkInvariants();

    // 6. User 1 redeems 100 dStable for FRAX
    const dstableToRedeem = hre.ethers.parseUnits("100", dstableInfo.decimals);
    const minFraxToReceive = hre.ethers.parseUnits("99", frxUSDInfo.decimals); // 1% slippage

    await dstableContract
      .connect(await hre.ethers.getSigner(user1))
      .approve(await redeemerContract.getAddress(), dstableToRedeem);

    await redeemerContract
      .connect(await hre.ethers.getSigner(user1))
      .redeem(dstableToRedeem, frxUSDInfo.address, minFraxToReceive);

    await checkInvariants();

    // 7. Transfer collateral from AMO vault to holding vault
    await amoManagerContract.transferFromAmoVaultToHoldingVault(
      await mockAmoVaultContract.getAddress(),
      frxUSDInfo.address,
      hre.ethers.parseUnits("50", frxUSDInfo.decimals)
    );

    await checkInvariants();

    // 8. Deallocate 50 dStable from AMO vault
    const dstableToDeallocate = hre.ethers.parseUnits(
      "50",
      dstableInfo.decimals
    );
    await mockAmoVaultContract.approveAmoManager();
    await amoManagerContract.deallocateAmo(
      await mockAmoVaultContract.getAddress(),
      dstableToDeallocate
    );

    await checkInvariants();

    // 9. Decrease AMO supply by burning 50 dStable
    await amoManagerContract.decreaseAmoSupply(dstableToDeallocate);

    await checkInvariants();

    // 10. User 2 redeems 100 dStable for USDC
    const dstableToRedeemForUsdc = hre.ethers.parseUnits(
      "100",
      dstableInfo.decimals
    );
    const minUsdcToReceive = hre.ethers.parseUnits("99", usdcInfo.decimals); // 1% slippage

    await dstableContract
      .connect(await hre.ethers.getSigner(user2))
      .approve(await redeemerContract.getAddress(), dstableToRedeemForUsdc);

    await redeemerContract
      .connect(await hre.ethers.getSigner(user2))
      .redeem(dstableToRedeemForUsdc, usdcInfo.address, minUsdcToReceive);

    await checkInvariants();

    // Final check of user balances
    const finalUser1DstableBalance = await dstableContract.balanceOf(user1);
    const finalUser2DstableBalance = await dstableContract.balanceOf(user2);
    const finalUser1FraxBalance = await frxUSDContract.balanceOf(user1);
    const finalUser2UsdcBalance = await usdcContract.balanceOf(user2);

    assert.isTrue(
      finalUser1DstableBalance < user1DstableBalance,
      "User1 dStable balance should have decreased"
    );
    assert.isTrue(
      finalUser2DstableBalance < user2DstableBalance,
      "User2 dStable balance should have decreased"
    );
    assert.isTrue(
      finalUser1FraxBalance > hre.ethers.parseUnits("500", frxUSDInfo.decimals),
      "User1 should have received FRAX from redemption"
    );
    assert.isTrue(
      finalUser2UsdcBalance > hre.ethers.parseUnits("0", usdcInfo.decimals),
      "User2 should have received USDC from redemption"
    );
  });
});
