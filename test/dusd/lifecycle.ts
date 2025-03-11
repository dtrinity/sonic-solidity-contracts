import { assert } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  CollateralHolderVault,
  Issuer,
  TestERC20,
  MockAmoVault,
  MockAPI3OracleAlwaysAlive,
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
} from "../../typescript/deploy-ids";

describe("dUSD Ecosystem Lifecycle", () => {
  let amoManagerContract: AmoManager;
  let mockAmoVaultContract: MockAmoVault;
  let collateralHolderVaultContract: CollateralHolderVault;
  let oracleAggregatorContract: OracleAggregator;
  let mockFrxUSDOracleContract: MockAPI3OracleAlwaysAlive;
  let mockUSDCOracleContract: MockAPI3OracleAlwaysAlive;
  let mockSfrxUSDOracleContract: MockAPI3OracleAlwaysAlive;
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
      await hre.deployments.get("OracleAggregator")
    ).address;
    oracleAggregatorContract = await hre.ethers.getContractAt(
      "OracleAggregator",
      oracleAggregatorAddress,
      await hre.ethers.getSigner(deployer)
    );

    /* Set up tokens */

    ({ contract: dusdContract, tokenInfo: dusdInfo } =
      await getTokenContractForSymbol(hre, deployer, "dUSD"));
    ({ contract: frxUSDContract, tokenInfo: frxUSDInfo } =
      await getTokenContractForSymbol(hre, deployer, "frxUSD"));
    ({ contract: usdcContract, tokenInfo: usdcInfo } =
      await getTokenContractForSymbol(hre, deployer, "USDC"));

    /* Get the mock oracles for each token */
    const mockFrxUSDOracleAddress = (
      await hre.deployments.get("MockAPI3Oracle_frxUSD")
    ).address;
    mockFrxUSDOracleContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      mockFrxUSDOracleAddress,
      await hre.ethers.getSigner(deployer)
    );

    const mockUSDCOracleAddress = (
      await hre.deployments.get("MockAPI3Oracle_USDC")
    ).address;
    mockUSDCOracleContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      mockUSDCOracleAddress,
      await hre.ethers.getSigner(deployer)
    );

    const mockSfrxUSDOracleAddress = (
      await hre.deployments.get("MockAPI3Oracle_sfrxUSD")
    ).address;
    mockSfrxUSDOracleContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      mockSfrxUSDOracleAddress,
      await hre.ethers.getSigner(deployer)
    );

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

  /**
   * Updates the price of a token in the mock oracle
   *
   * @param tokenAddress - The address of the token to update
   * @param price - The new price in USD with 18 decimals
   */
  async function updateTokenPrice(
    tokenAddress: Address,
    price: bigint
  ): Promise<void> {
    // Find which mock oracle to use
    let mockOracle: MockAPI3OracleAlwaysAlive;
    if (tokenAddress === frxUSDInfo.address) {
      mockOracle = mockFrxUSDOracleContract;
    } else if (tokenAddress === usdcInfo.address) {
      mockOracle = mockUSDCOracleContract;
    } else {
      throw new Error(`No mock oracle found for token ${tokenAddress}`);
    }

    // Update the price
    await mockOracle.setMock(price);
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

    // 2. User 1 deposits 500 FRAX to mint 500 dUSD (leaving 500 FRAX for later)
    const depositFraxAmount = hre.ethers.parseUnits("500", frxUSDInfo.decimals);
    const minInitialDusdForFrax = await convertToEquivalentValueInOutputToken(
      depositFraxAmount,
      frxUSDInfo.address,
      dusdInfo.address
    );
    await frxUSDContract
      .connect(await hre.ethers.getSigner(user1))
      .approve(await issuerContract.getAddress(), depositFraxAmount);
    await issuerContract
      .connect(await hre.ethers.getSigner(user1))
      .issue(depositFraxAmount, frxUSDInfo.address, minInitialDusdForFrax);

    // 3. User 2 deposits 500 USDC to mint 500 dUSD
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

    // Verify balances after minting
    const user1DusdBalance = await dusdContract.balanceOf(user1);
    const user2DusdBalance = await dusdContract.balanceOf(user2);
    const user1FraxBalance = await frxUSDContract.balanceOf(user1);

    // Ensure both users have the expected dUSD balances
    assert.isTrue(
      user1DusdBalance >= minInitialDusdForFrax,
      `User1 should have at least ${hre.ethers.formatUnits(minInitialDusdForFrax, dusdInfo.decimals)} dUSD`
    );
    assert.isTrue(
      user2DusdBalance >= minDusdForUsdc,
      `User2 should have at least ${hre.ethers.formatUnits(minDusdForUsdc, dusdInfo.decimals)} dUSD`
    );

    await checkInvariants();

    // 4. USDC depegs to $0.90
    const depegPrice = hre.ethers.parseUnits(
      "0.90",
      18 // API3 uses 18 decimals
    );
    await updateTokenPrice(usdcInfo.address, depegPrice);

    // We are now undercollateralized by $50
    const circulatingSupplyAt4 = await issuerContract.circulatingDusd();
    const totalCollateralValueInDusdAt4 =
      await issuerContract.collateralInDusd();
    const underCollateralizedAmountInDusdAt4 =
      circulatingSupplyAt4 - totalCollateralValueInDusdAt4;

    // 5. First, mint AMO dUSD via the Issuer contract
    const amoAllocationAmount = hre.ethers.parseUnits("100", dusdInfo.decimals);
    await issuerContract.increaseAmoSupply(amoAllocationAmount);

    // 6. Now allocate the AMO dUSD to the AMO vault
    await amoManagerContract.allocateAmo(
      await mockAmoVaultContract.getAddress(),
      amoAllocationAmount
    );

    // 7. Users swap tokens manually (direct transfer between users)
    const swapDusdAmount = hre.ethers.parseUnits("100", dusdInfo.decimals);
    const swapFraxAmount = hre.ethers.parseUnits("100", frxUSDInfo.decimals);

    // Verify users have enough tokens for the swap
    assert.isTrue(
      (await dusdContract.balanceOf(user2)) >= swapDusdAmount,
      `User2 should have at least ${hre.ethers.formatUnits(swapDusdAmount, dusdInfo.decimals)} dUSD for the swap`
    );
    assert.isTrue(
      (await frxUSDContract.balanceOf(user1)) >= swapFraxAmount,
      `User1 should have at least ${hre.ethers.formatUnits(swapFraxAmount, frxUSDInfo.decimals)} FRAX for the swap`
    );

    await dusdContract
      .connect(await hre.ethers.getSigner(user2))
      .transfer(user1, swapDusdAmount);
    await frxUSDContract
      .connect(await hre.ethers.getSigner(user1))
      .transfer(user2, swapFraxAmount);

    // Check balances after swap
    const user1DusdBalanceAfterSwap = await dusdContract.balanceOf(user1);
    const user2DusdBalanceAfterSwap = await dusdContract.balanceOf(user2);

    // 8. USDC repegs to $1.00
    const repegPrice = hre.ethers.parseUnits(
      "1.00",
      18 // API3 uses 18 decimals
    );
    await updateTokenPrice(usdcInfo.address, repegPrice);

    // All invariants should hold now
    await checkInvariants();

    // We should be overcollateralized by $50 now
    const circulatingSupplyAt8 = await issuerContract.circulatingDusd();
    const totalCollateralValueInDusdAt8 =
      await issuerContract.collateralInDusd();
    const overCollateralizedAmountInDusdAt8 =
      totalCollateralValueInDusdAt8 - circulatingSupplyAt8;

    // 9. AMO manager deallocates 100 dUSD from the AMO vault
    await amoManagerContract.deallocateAmo(
      await mockAmoVaultContract.getAddress(),
      amoAllocationAmount
    );

    // 10. AMO manager decreases AMO supply by 100 dUSD
    await amoManagerContract.decreaseAmoSupply(amoAllocationAmount);

    // All invariants should still hold
    await checkInvariants();

    // 11. User 1 redeems 400 dUSD for FRAX (user1 has 600 dUSD after the swap)
    const redeemDusdAmountUser1 = hre.ethers.parseUnits(
      "400",
      dusdInfo.decimals
    );
    const minFraxForDusd = await convertToEquivalentValueInOutputToken(
      redeemDusdAmountUser1,
      dusdInfo.address,
      frxUSDInfo.address
    );
    await dusdContract
      .connect(await hre.ethers.getSigner(user1))
      .approve(await redeemerContract.getAddress(), redeemDusdAmountUser1);
    await redeemerContract
      .connect(await hre.ethers.getSigner(user1))
      .redeem(redeemDusdAmountUser1, frxUSDInfo.address, minFraxForDusd);

    // 12. User 2 redeems 400 dUSD for USDC (user2 has 400 dUSD after the swap)
    const redeemDusdAmountUser2 = hre.ethers.parseUnits(
      "400",
      dusdInfo.decimals
    );
    const minUsdcForDusd = await convertToEquivalentValueInOutputToken(
      redeemDusdAmountUser2,
      dusdInfo.address,
      usdcInfo.address
    );
    await dusdContract
      .connect(await hre.ethers.getSigner(user2))
      .approve(await redeemerContract.getAddress(), redeemDusdAmountUser2);
    await redeemerContract
      .connect(await hre.ethers.getSigner(user2))
      .redeem(redeemDusdAmountUser2, usdcInfo.address, minUsdcForDusd);

    // All invariants should still hold
    await checkInvariants();

    // Check that users have more value than they started with
    const user1FinalValue = await calculateWalletValue(user1);
    const user2FinalValue = await calculateWalletValue(user2);

    assert.isTrue(
      user1FinalValue >= user1InitialValue,
      `User 1 should have at least as much value as they started with: ${user1FinalValue} >= ${user1InitialValue}`
    );
    assert.isTrue(
      user2FinalValue >= user2InitialValue,
      `User 2 should have at least as much value as they started with: ${user2FinalValue} >= ${user2InitialValue}`
    );
  });
});
