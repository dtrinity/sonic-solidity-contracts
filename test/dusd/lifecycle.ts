import { assert } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  Issuer,
  TestERC20,
  MockAmoVault,
  MockOracleAggregator,
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
} from "../../typescript/deploy-ids";

describe("dUSD Ecosystem Lifecycle", () => {
  let amoManagerContract: AmoManager;
  let mockAmoVaultContract: MockAmoVault;
  let collateralHolderVaultContract: CollateralHolderVault;
  let oracleAggregatorContract: OracleAggregator;
  let mockOracleAggregatorContract: MockOracleAggregator;
  let issuerContract: Issuer;
  let dusdContract: TestERC20;
  let dusdInfo: TokenInfo;
  let frxUSDContract: TestERC20;
  let frxUSDInfo: TokenInfo;
  let usdcContract: TestERC20;
  let usdcInfo: TokenInfo;
  let deployer: Address;
  let user1: Address;
  let user2: Address;

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
      await hre.deployments.get("OracleAggregator")
    ).address;
    oracleAggregatorContract = await hre.ethers.getContractAt(
      "OracleAggregator",
      oracleAggregatorAddress,
      await hre.ethers.getSigner(deployer)
    );

    const mockOracleAggregatorAddress = (
      await hre.deployments.get("MockOracleAggregator")
    ).address;
    mockOracleAggregatorContract = await hre.ethers.getContractAt(
      "MockOracleAggregator",
      mockOracleAggregatorAddress,
      await hre.ethers.getSigner(deployer)
    );

    const issuerAddress = (await hre.deployments.get(DUSD_ISSUER_CONTRACT_ID))
      .address;
    issuerContract = await hre.ethers.getContractAt(
      "Issuer",
      issuerAddress,
      await hre.ethers.getSigner(deployer)
    );

    /* Set up tokens */

    ({ contract: dusdContract, tokenInfo: dusdInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));
    ({ contract: frxUSDContract, tokenInfo: frxUSDInfo } =
      await getTokenContractForSymbol(hre, deployer, "frxUSD"));
    ({ contract: usdcContract, tokenInfo: usdcInfo } =
      await getTokenContractForSymbol(hre, deployer, "USDC"));

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
  });

  /**
   * Check the invariants of the dUSD ecosystem
   *
   * @returns void
   */
  async function checkInvariants(): Promise<void> {
    const circulatingSupply = await issuerContract.circulatingDusd();
    const totalCollateralValueInDusd = await issuerContract.collateralInDusd();
    const totalSupply = await dusdContract.totalSupply();
    const amoSupply = await amoManagerContract.totalAmoSupply();

    assert.isTrue(
      circulatingSupply <= totalCollateralValueInDusd,
      `Circulating supply should not exceed total collateral value: ${circulatingSupply} <= ${totalCollateralValueInDusd}`
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
    const fraxValue = await tokenAmountToUsdValue(
      await frxUSDContract.balanceOf(wallet),
      frxUSDInfo.address
    );
    const usdcValue = await tokenAmountToUsdValue(
      await usdcContract.balanceOf(wallet),
      usdcInfo.address
    );
    const dusdValue = await tokenAmountToUsdValue(
      await dusdContract.balanceOf(wallet),
      dusdInfo.address
    );

    return fraxValue + usdcValue + dusdValue;
  }

  /**
   * Converts an amount of one token to an equivalent value in another token
   *
   * @param inputAmount - The amount of input token to convert
   * @param inputToken - The address of the input token
   * @param outputToken - The address of the output token
   * @returns The equivalent amount in the output token
   */
  async function convertToEquivalentValueInOutputToken(
    inputAmount: bigint,
    inputToken: Address,
    outputToken: Address
  ): Promise<bigint> {
    const inputPrice = await oracleAggregatorContract.getAssetPrice(inputToken);
    const outputPrice =
      await oracleAggregatorContract.getAssetPrice(outputToken);
    const inputDecimals = await (
      await hre.ethers.getContractAt("TestERC20", inputToken)
    ).decimals();
    const outputDecimals = await (
      await hre.ethers.getContractAt("TestERC20", outputToken)
    ).decimals();

    const inputAmountInUsd = (inputAmount * inputPrice) / 10n ** inputDecimals;
    const outputAmountInToken =
      (inputAmountInUsd * 10n ** outputDecimals) / outputPrice;
    return outputAmountInToken;
  }

  /**
   * Converts a token amount to its USD value using the oracle price
   *
   * @param amount - The amount of tokens to convert
   * @param token - The address of the token to convert
   * @returns The USD value of the token amount
   */
  async function tokenAmountToUsdValue(
    amount: bigint,
    token: Address
  ): Promise<bigint> {
    const price = await oracleAggregatorContract.getAssetPrice(token);
    const decimals = await (
      await hre.ethers.getContractAt("TestERC20", token)
    ).decimals();
    return (amount * price) / 10n ** decimals;
  }

  it("two users swap against an AMO vault in a healthy market", async () => {
    // 1. User 1 starts with 1000 FRAX and User 2 starts with 1000 USDC
    const initialFraxAmount = hre.ethers.parseUnits(
      "1000",
      frxUSDInfo.decimals
    );
    await frxUSDContract.transfer(user1, initialFraxAmount);
    const initialUsdcAmount = hre.ethers.parseUnits("1000", usdcInfo.decimals);
    await usdcContract.transfer(user2, initialUsdcAmount);

    const user1InitialValue = await calculateWalletValue(user1);
    const user2InitialValue = await calculateWalletValue(user2);

    await checkInvariants();

    // 2. User 1 deposits 1000 FRAX to mint 1000 dUSD
    const minInitialDusdForFrax = await convertToEquivalentValueInOutputToken(
      initialFraxAmount,
      frxUSDInfo.address,
      dusdInfo.address
    );
    await frxUSDContract
      .connect(await hre.ethers.getSigner(user1))
      .approve(await issuerContract.getAddress(), initialFraxAmount);
    await issuerContract
      .connect(await hre.ethers.getSigner(user1))
      .issue(initialFraxAmount, frxUSDInfo.address, minInitialDusdForFrax);

    await checkInvariants();

    // 3. Deployer calls Issuer to allocate 2000 AMO dUSD to the AmoManager
    const amoAllocation = hre.ethers.parseUnits("2000", dusdInfo.decimals);
    await issuerContract.increaseAmoSupply(amoAllocation);

    await checkInvariants();

    // 4. AmoManager gives 1500 AMO dUSD allocation to MockAmoVault
    const vaultAllocation = hre.ethers.parseUnits("1500", dusdInfo.decimals);
    await amoManagerContract.allocateAmo(
      await mockAmoVaultContract.getAddress(),
      vaultAllocation
    );

    await checkInvariants();

    // 5. User 2 sends 500 USDC to MockAmoVault to simulate swapping on a DEX
    const swapAmount = hre.ethers.parseUnits("500", usdcInfo.decimals);
    await usdcContract
      .connect(await hre.ethers.getSigner(user2))
      .transfer(await mockAmoVaultContract.getAddress(), swapAmount);

    const swapFeeInUsdc = (swapAmount * 1n) / 1000n; // 0.1% fee
    const afterFeeSwapAmount = swapAmount - swapFeeInUsdc;
    const afterFeeSwapAmountInDusd =
      await convertToEquivalentValueInOutputToken(
        afterFeeSwapAmount,
        usdcInfo.address,
        dusdInfo.address
      );
    await mockAmoVaultContract
      .connect(await hre.ethers.getSigner(deployer))
      .withdrawTo(user2, afterFeeSwapAmountInDusd, dusdInfo.address);

    await checkInvariants();

    // 6. User 1 transfers 500 dUSD to User 2, User 2 sends User 1 500 USDC. Simulates a swap
    const transferAmountInDusd = hre.ethers.parseUnits(
      "500",
      dusdInfo.decimals
    );
    const transferAmountInUsdc = await convertToEquivalentValueInOutputToken(
      transferAmountInDusd,
      dusdInfo.address,
      usdcInfo.address
    );
    await dusdContract
      .connect(await hre.ethers.getSigner(user1))
      .transfer(user2, transferAmountInDusd);
    await usdcContract
      .connect(await hre.ethers.getSigner(user2))
      .transfer(user1, transferAmountInUsdc);

    await checkInvariants();

    // 7. AmoManager transfers 1000 FRAX to MockAMOVault to simulate SMO
    const fraxTransferAmount = hre.ethers.parseUnits(
      "1000",
      frxUSDInfo.decimals
    );
    await amoManagerContract.transferFromHoldingVaultToAmoVault(
      await mockAmoVaultContract.getAddress(),
      frxUSDInfo.address,
      fraxTransferAmount
    );

    await checkInvariants();

    // 8. User 1 sends 500 dUSD to MockAMO Vault and gets back corresponding USDC minus 2%
    const user1RedeemAmountInDusd = hre.ethers.parseUnits(
      "500",
      dusdInfo.decimals
    );
    await dusdContract
      .connect(await hre.ethers.getSigner(user1))
      .transfer(
        await mockAmoVaultContract.getAddress(),
        user1RedeemAmountInDusd
      );

    const user1RedeemFeesInDusd = (user1RedeemAmountInDusd * 2n) / 100n;
    const user1RedeemAmountInDusdAfterFees =
      user1RedeemAmountInDusd - user1RedeemFeesInDusd;
    const user1RedeemUsdc = await convertToEquivalentValueInOutputToken(
      user1RedeemAmountInDusdAfterFees,
      dusdInfo.address,
      usdcInfo.address
    );
    await mockAmoVaultContract
      .connect(await hre.ethers.getSigner(deployer))
      .withdrawTo(user1, user1RedeemUsdc, usdcInfo.address);

    await checkInvariants();

    // 9. User 2 sends 1000 dUSD to MockAMO Vault and gets back corresponding FRAX minus 2%

    // Note that User 2 has lost some dUSD to fees at this point
    const user2DusdBalanceBeforeRedeem = await dusdContract.balanceOf(user2);

    await dusdContract
      .connect(await hre.ethers.getSigner(user2))
      .transfer(
        await mockAmoVaultContract.getAddress(),
        user2DusdBalanceBeforeRedeem
      );

    const user2RedeemFeesInDusd = (user2DusdBalanceBeforeRedeem * 2n) / 100n;
    const user2RedeemAmountInDusdAfterFees =
      user2DusdBalanceBeforeRedeem - user2RedeemFeesInDusd;
    const user2RedeemFrax = await convertToEquivalentValueInOutputToken(
      user2RedeemAmountInDusdAfterFees,
      dusdInfo.address,
      frxUSDInfo.address
    );
    await mockAmoVaultContract
      .connect(await hre.ethers.getSigner(deployer))
      .withdrawTo(user2, user2RedeemFrax, frxUSDInfo.address);

    await checkInvariants();

    // 10. Calculate the AmoManager availableProfitInUsd
    const availableProfitInUsd =
      await amoManagerContract.availableProfitInUsd();

    // 11. Check User 1 and User 2 value
    const user1FinalValue = await calculateWalletValue(user1);
    const user2FinalValue = await calculateWalletValue(user2);

    assert.equal(
      user1FinalValue,
      hre.ethers.parseUnits("990", ORACLE_AGGREGATOR_PRICE_DECIMALS),
      "User 1 should have lost 10 dUSD to fees"
    );
    assert.equal(
      user2FinalValue,
      hre.ethers.parseUnits("979.51", ORACLE_AGGREGATOR_PRICE_DECIMALS),
      "User 2 should have lost 20.49 dUSD to fees"
    );

    const user1LossValue = user1InitialValue - user1FinalValue;
    const user2LossValue = user2InitialValue - user2FinalValue;

    const swapFeeValue = await tokenAmountToUsdValue(
      swapFeeInUsdc,
      usdcInfo.address
    );
    const user1RedeemFeesValue = await tokenAmountToUsdValue(
      user1RedeemFeesInDusd,
      dusdInfo.address
    );
    const user2RedeemFeesValue = await tokenAmountToUsdValue(
      user2RedeemFeesInDusd,
      dusdInfo.address
    );
    const totalFees =
      swapFeeValue + user1RedeemFeesValue + user2RedeemFeesValue;

    assert.equal(
      user1LossValue + user2LossValue,
      totalFees,
      "Total fees should equal the sum of User 1 and User 2 losses"
    );
    assert.equal(
      availableProfitInUsd,
      totalFees,
      "Available profit in USD should equal total fees collected"
    );

    // 12. Check final ecosystem values

    await checkInvariants();

    const endingDusdAmoSupply = await amoManagerContract.totalAmoSupply();
    const endingDusdCirculatingSupply = await issuerContract.circulatingDusd();
    const endingDusdSupply = await dusdContract.totalSupply();

    assert.equal(
      endingDusdAmoSupply,
      hre.ethers.parseUnits("3000", dusdInfo.decimals),
      "We allocated 2000 AMO dUSD and then transferred 1000 FRAX to MockAmoVault"
    );
    assert.equal(
      endingDusdCirculatingSupply,
      hre.ethers.parseUnits("0", dusdInfo.decimals),
      "We should have redeemed all circulating dUSD"
    );
    assert.equal(
      endingDusdSupply,
      endingDusdAmoSupply,
      "The only remaining dUSD should be the AMO dUSD"
    );
  });

  it("two users swap in a USDC depeg market", async () => {
    // 1. Initial setup
    const initialAmountFRAX = hre.ethers.parseUnits(
      "1000",
      frxUSDInfo.decimals
    );
    const initialAmountUSDC = hre.ethers.parseUnits("1000", usdcInfo.decimals);
    await frxUSDContract.transfer(user1, initialAmountFRAX);
    await usdcContract.transfer(user2, initialAmountUSDC);

    const user1InitialValue = await calculateWalletValue(user1);
    const user2InitialValue = await calculateWalletValue(user2);

    await checkInvariants();

    // 2. User 1 mints 500 dUSD with FRAX
    const depositAmountFRAX = hre.ethers.parseUnits("500", frxUSDInfo.decimals);
    const minDusdForFrax = await convertToEquivalentValueInOutputToken(
      depositAmountFRAX,
      frxUSDInfo.address,
      dusdInfo.address
    );
    await frxUSDContract
      .connect(await hre.ethers.getSigner(user1))
      .approve(await issuerContract.getAddress(), depositAmountFRAX);
    await issuerContract
      .connect(await hre.ethers.getSigner(user1))
      .issue(depositAmountFRAX, frxUSDInfo.address, minDusdForFrax);

    await checkInvariants();

    // 3. User 2 mints 500 dUSD with USDC
    const depositAmountUSDC = hre.ethers.parseUnits("500", usdcInfo.decimals);
    const minDusdForUsdc = await convertToEquivalentValueInOutputToken(
      depositAmountUSDC,
      usdcInfo.address,
      dusdInfo.address
    );
    await usdcContract
      .connect(await hre.ethers.getSigner(user2))
      .approve(await issuerContract.getAddress(), depositAmountUSDC);
    await issuerContract
      .connect(await hre.ethers.getSigner(user2))
      .issue(depositAmountUSDC, usdcInfo.address, minDusdForUsdc);

    await checkInvariants();

    // 4. USDC depegs to $0.90
    const depegPrice = hre.ethers.parseUnits(
      "0.90",
      ORACLE_AGGREGATOR_PRICE_DECIMALS
    );
    await mockOracleAggregatorContract.setAssetPrice(
      usdcInfo.address,
      depegPrice
    );

    // We are now undercollateralized by $50
    const circulatingSupplyAt4 = await issuerContract.circulatingDusd();
    const totalCollateralValueInDusdAt4 =
      await issuerContract.collateralInDusd();
    const underCollateralizedAmountInDusdAt4 =
      circulatingSupplyAt4 - totalCollateralValueInDusdAt4;
    assert.equal(
      underCollateralizedAmountInDusdAt4,
      hre.ethers.parseUnits("50", 6),
      "System should be undercollateralized by $50 after USDC depeg"
    );

    // 5. User 2 mints more dUSD with depegged USDC
    const depeggedMinDusdForUsdc = await convertToEquivalentValueInOutputToken(
      depositAmountUSDC,
      usdcInfo.address,
      dusdInfo.address
    );
    await usdcContract
      .connect(await hre.ethers.getSigner(user2))
      .approve(await issuerContract.getAddress(), depositAmountUSDC);
    await issuerContract
      .connect(await hre.ethers.getSigner(user2))
      .issue(depositAmountUSDC, usdcInfo.address, depeggedMinDusdForUsdc);

    // 6. Simulate dUSD trading at $0.90 - User 2 swaps 500 dUSD for 450 FRAX
    const swapDusdAmount = hre.ethers.parseUnits("500", dusdInfo.decimals);
    const swapFraxAmount = hre.ethers.parseUnits("450", frxUSDInfo.decimals);
    await dusdContract
      .connect(await hre.ethers.getSigner(user2))
      .transfer(user1, swapDusdAmount);
    await frxUSDContract
      .connect(await hre.ethers.getSigner(user1))
      .transfer(user2, swapFraxAmount);

    // 7. USDC repegs to $1.00
    const repegPrice = hre.ethers.parseUnits(
      "1.00",
      ORACLE_AGGREGATOR_PRICE_DECIMALS
    );
    await mockOracleAggregatorContract.setAssetPrice(
      usdcInfo.address,
      repegPrice
    );

    // All invariants should hold now
    await checkInvariants();

    // We should be overcollateralized by $50 now
    const circulatingSupplyAt7 = await issuerContract.circulatingDusd();
    const totalCollateralValueInDusdAt7 =
      await issuerContract.collateralInDusd();
    const overCollateralizedAmountInDusdAt7 =
      totalCollateralValueInDusdAt7 - circulatingSupplyAt7;
    assert.equal(
      overCollateralizedAmountInDusdAt7,
      hre.ethers.parseUnits("50", 6),
      "System should be overcollateralized by $50 after USDC repeg"
    );

    // 8. Check final values
    const user1FinalValue = await calculateWalletValue(user1);
    const user2FinalValue = await calculateWalletValue(user2);

    // User 1 should have profited by ~$50 (they got 500 dUSD for 450 FRAX)
    const user1Profit = user1FinalValue - user1InitialValue;
    assert.equal(
      user1Profit,
      hre.ethers.parseUnits("50", ORACLE_AGGREGATOR_PRICE_DECIMALS),
      "User 1 should have profited by $50"
    );
    // User 2 should have lost ~$100 (they gave 500 dUSD for 450 FRAX, and they minted 450 dUSD for 500 USDC)
    const user2Loss = user2FinalValue - user2InitialValue;
    assert.equal(
      user2Loss,
      hre.ethers.parseUnits("-100", ORACLE_AGGREGATOR_PRICE_DECIMALS),
      "User 2 should have lost $100"
    );

    // Sanity check totals
    const totalCollateralValue =
      await collateralHolderVaultContract.totalValue();
    const circulatingSupply = await issuerContract.circulatingDusd();
    assert.equal(
      totalCollateralValue,
      hre.ethers.parseUnits("1500", ORACLE_AGGREGATOR_PRICE_DECIMALS),
      "System should have 500 FRAX + 1000 USDC in collateral"
    );
    assert.equal(
      circulatingSupply,
      hre.ethers.parseUnits("1450", 6),
      "System should have minted 1450 dUSD in total"
    );
  });
});
