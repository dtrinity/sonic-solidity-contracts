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
import { TokenInfo } from "../../typescript/token/utils";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { standaloneAmoFixture } from "./fixtures";
import {
  DS_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_ISSUER_CONTRACT_ID,
  DS_REDEEMER_CONTRACT_ID,
} from "../../typescript/deploy-ids";

describe("dS Ecosystem Lifecycle", () => {
  let amoManagerContract: AmoManager;
  let mockAmoVaultContract: MockAmoVault;
  let collateralHolderVaultContract: CollateralHolderVault;
  let oracleAggregatorContract: OracleAggregator;
  let mockOracleAggregatorContract: MockOracleAggregator;
  let issuerContract: Issuer;
  let dsContract: TestERC20;
  let dsInfo: TokenInfo;
  let wOSTokenContract: TestERC20;
  let wOSTokenInfo: TokenInfo;
  let stSTokenContract: TestERC20;
  let stSTokenInfo: TokenInfo;
  let deployer: Address;
  let user1: Address;
  let user2: Address;

  beforeEach(async function () {
    await standaloneAmoFixture();

    /* Set up accounts */
    ({ deployer, user1, user2 } = await getNamedAccounts());

    /* Set up contracts */
    const amoManagerAddress = (await hre.deployments.get(DS_AMO_MANAGER_ID))
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
      await hre.deployments.get(DS_COLLATERAL_VAULT_CONTRACT_ID)
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

    const issuerAddress = (await hre.deployments.get(DS_ISSUER_CONTRACT_ID))
      .address;
    issuerContract = await hre.ethers.getContractAt(
      "Issuer",
      issuerAddress,
      await hre.ethers.getSigner(deployer)
    );

    /* Set up tokens */
    ({ contract: dsContract, tokenInfo: dsInfo } =
      await getTokenContractForSymbol(hre, deployer, "dS"));
    ({ contract: wOSTokenContract, tokenInfo: wOSTokenInfo } =
      await getTokenContractForSymbol(hre, deployer, "wOS"));
    ({ contract: stSTokenContract, tokenInfo: stSTokenInfo } =
      await getTokenContractForSymbol(hre, deployer, "stS"));

    /* Enable the MockAmoVault */
    await amoManagerContract.enableAmoVault(
      await mockAmoVaultContract.getAddress()
    );

    /* Allow tokens as collateral */
    await collateralHolderVaultContract.allowCollateral(wOSTokenInfo.address);
    await collateralHolderVaultContract.allowCollateral(stSTokenInfo.address);
    await mockAmoVaultContract.allowCollateral(wOSTokenInfo.address);
    await mockAmoVaultContract.allowCollateral(stSTokenInfo.address);

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
   * Check the invariants of the dS ecosystem
   *
   * @returns void
   */
  async function checkInvariants(): Promise<void> {
    const circulatingSupply = await issuerContract.circulatingDusd();
    const totalCollateralValueInDs = await issuerContract.collateralInDusd();
    const totalSupply = await dsContract.totalSupply();
    const amoSupply = await amoManagerContract.totalAmoSupply();

    assert.isTrue(
      circulatingSupply <= totalCollateralValueInDs,
      `Circulating supply should not exceed total collateral value: ${circulatingSupply} <= ${totalCollateralValueInDs}`
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
    const wOSTokenValue = await tokenAmountToUsdValue(
      await wOSTokenContract.balanceOf(wallet),
      wOSTokenInfo.address
    );
    const stSTokenValue = await tokenAmountToUsdValue(
      await stSTokenContract.balanceOf(wallet),
      stSTokenInfo.address
    );
    const dsValue = await tokenAmountToUsdValue(
      await dsContract.balanceOf(wallet),
      dsInfo.address
    );

    return wOSTokenValue + stSTokenValue + dsValue;
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
   * Converts a token amount to its USD value
   *
   * @param amount - The amount of token
   * @param tokenAddress - The address of the token
   * @returns The USD value of the token amount
   */
  async function tokenAmountToUsdValue(
    amount: bigint,
    tokenAddress: Address
  ): Promise<bigint> {
    const price = await oracleAggregatorContract.getAssetPrice(tokenAddress);
    const decimals = await (
      await hre.ethers.getContractAt("TestERC20", tokenAddress)
    ).decimals();
    return (amount * price) / 10n ** BigInt(decimals);
  }

  it("should allow issuing dS with stS token as collateral", async function () {
    // Transfer some stS tokens to user1
    const transferAmount = 100000n * 10n ** 18n; // 100k tokens
    await stSTokenContract.transfer(user1, transferAmount);

    // Connect to contracts as user1
    const user1Signer = await hre.ethers.getSigner(user1);
    const stSTokenUser1 = stSTokenContract.connect(user1Signer);
    const issuerUser1 = issuerContract.connect(user1Signer);
    const dsUser1 = dsContract.connect(user1Signer);

    // Approve tokens for the issuer
    await stSTokenUser1.approve(issuerContract.getAddress(), transferAmount);

    // Issue dS with stS token
    const issueAmount = 110000n * 10n ** 6n; // 110k dS (6 decimals)
    const minDsAmount = issueAmount; // No slippage for testing

    // Get initial balances
    const initialStSBalance = await stSTokenUser1.balanceOf(user1);
    const initialDsBalance = await dsUser1.balanceOf(user1);

    // Issue with stS token
    await issuerUser1.issue(transferAmount, stSTokenInfo.address, minDsAmount);

    // Check final balances
    const finalStSBalance = await stSTokenUser1.balanceOf(user1);
    const finalDsBalance = await dsUser1.balanceOf(user1);

    // Verify balances changed correctly
    assert.equal(
      initialStSBalance - finalStSBalance,
      transferAmount,
      "stS token balance should have decreased by the mint amount"
    );
    assert.equal(
      finalDsBalance - initialDsBalance,
      issueAmount,
      "dS balance should have increased by the issue amount"
    );

    // Check invariants
    await checkInvariants();
  });

  it("should allow issuing dS with multiple collateral types (wOS, stS)", async function () {
    // Mint some tokens to user1
    const mintAmount = 100000n * 10n ** 18n; // 100k tokens

    // Transfer tokens to user1
    await wOSTokenContract.transfer(user1, mintAmount);
    await stSTokenContract.transfer(user1, mintAmount);

    // Connect to contracts as user1
    const user1Signer = await hre.ethers.getSigner(user1);
    const wOSTokenUser1 = wOSTokenContract.connect(user1Signer);
    const stSTokenUser1 = stSTokenContract.connect(user1Signer);
    const issuerUser1 = issuerContract.connect(user1Signer);
    const dsUser1 = dsContract.connect(user1Signer);

    // Approve tokens for the issuer
    await wOSTokenUser1.approve(issuerContract.getAddress(), mintAmount);
    await stSTokenUser1.approve(issuerContract.getAddress(), mintAmount);

    // Issue dS with each token type
    const issueAmount = 110000n * 10n ** 6n; // 110k dS (6 decimals)
    const minDsAmount = issueAmount; // No slippage for testing

    // Issue with wOS token
    await issuerUser1.issue(mintAmount, wOSTokenInfo.address, minDsAmount);

    // Issue with stS token
    await issuerUser1.issue(mintAmount, stSTokenInfo.address, minDsAmount);

    // Check user1's dS balance
    const expectedDsBalance = issueAmount * 2n;
    const actualDsBalance = await dsUser1.balanceOf(user1);
    assert.equal(
      actualDsBalance,
      expectedDsBalance,
      "User should have received the correct amount of dS"
    );

    // Check invariants
    await checkInvariants();
  });

  it("should allow redeeming dS for stS token", async function () {
    // Mint some tokens to user1
    const mintAmount = 1000000n * 10n ** 18n; // 1 million tokens

    // Transfer tokens to user1
    await stSTokenContract.transfer(user1, mintAmount);

    // Connect to contracts as user1
    const user1Signer = await hre.ethers.getSigner(user1);
    const stSTokenUser1 = stSTokenContract.connect(user1Signer);
    const issuerUser1 = issuerContract.connect(user1Signer);
    const dsUser1 = dsContract.connect(user1Signer);
    const redeemerUser1 = await hre.ethers.getContractAt(
      "Redeemer",
      (await hre.deployments.get(DS_REDEEMER_CONTRACT_ID)).address,
      user1Signer
    );

    // Get the redeemer contract as deployer to grant role
    const redeemerContract = await hre.ethers.getContractAt(
      "Redeemer",
      (await hre.deployments.get(DS_REDEEMER_CONTRACT_ID)).address,
      await hre.ethers.getSigner(deployer)
    );

    // Grant REDEMPTION_MANAGER_ROLE to user1
    const REDEMPTION_MANAGER_ROLE =
      await redeemerContract.REDEMPTION_MANAGER_ROLE();
    await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user1);

    // Approve tokens for the issuer
    await stSTokenUser1.approve(issuerContract.getAddress(), mintAmount);

    // Issue dS with stS token
    const issueAmount = 100000n * 10n ** 6n; // 100k dS (6 decimals)
    const minDsAmount = issueAmount; // No slippage for testing

    // Issue with stS token
    await issuerUser1.issue(mintAmount, stSTokenInfo.address, minDsAmount);

    // Now redeem some dS for stS token
    const redeemAmount = 50000n * 10n ** 6n; // 50k dS
    const minCollateralAmount = 0n; // No slippage check for simplicity in test

    // Approve dS for the redeemer
    await dsUser1.approve(redeemerUser1.getAddress(), redeemAmount);

    // Get initial balances before redemption
    const initialStSBalance = await stSTokenUser1.balanceOf(user1);
    const initialDsBalance = await dsUser1.balanceOf(user1);

    // Redeem for stS token
    await redeemerUser1.redeem(
      redeemAmount,
      stSTokenInfo.address,
      minCollateralAmount
    );

    // Check final balances
    const finalStSBalance = await stSTokenUser1.balanceOf(user1);
    const finalDsBalance = await dsUser1.balanceOf(user1);

    // Verify balances changed correctly
    assert.isTrue(
      finalStSBalance > initialStSBalance,
      "stS token balance should have increased after redemption"
    );
    assert.equal(
      initialDsBalance - finalDsBalance,
      redeemAmount,
      "dS balance should have decreased by the redeem amount"
    );

    // Check invariants
    await checkInvariants();
  });

  it("should allow redeeming dS for different collateral types (wOS, stS)", async function () {
    // First issue dS with multiple collateral types
    const mintAmount = 1000000n * 10n ** 18n; // 1 million tokens

    // Transfer tokens to user1
    await wOSTokenContract.transfer(user1, mintAmount);
    await stSTokenContract.transfer(user1, mintAmount);

    // Connect to contracts as user1
    const user1Signer = await hre.ethers.getSigner(user1);
    const wOSTokenUser1 = wOSTokenContract.connect(user1Signer);
    const stSTokenUser1 = stSTokenContract.connect(user1Signer);
    const issuerUser1 = issuerContract.connect(user1Signer);
    const redeemerUser1 = await hre.ethers.getContractAt(
      "Redeemer",
      (await hre.deployments.get(DS_REDEEMER_CONTRACT_ID)).address,
      user1Signer
    );
    const dsUser1 = dsContract.connect(user1Signer);

    // Get the redeemer contract as deployer to grant role
    const redeemerContract = await hre.ethers.getContractAt(
      "Redeemer",
      (await hre.deployments.get(DS_REDEEMER_CONTRACT_ID)).address,
      await hre.ethers.getSigner(deployer)
    );

    // Grant REDEMPTION_MANAGER_ROLE to user1
    const REDEMPTION_MANAGER_ROLE =
      await redeemerContract.REDEMPTION_MANAGER_ROLE();
    await redeemerContract.grantRole(REDEMPTION_MANAGER_ROLE, user1);

    // Approve tokens for the issuer
    await wOSTokenUser1.approve(issuerContract.getAddress(), mintAmount);
    await stSTokenUser1.approve(issuerContract.getAddress(), mintAmount);

    // Issue dS with each token type
    const issueAmount = 100000n * 10n ** 6n; // 100k dS (6 decimals)
    const minDsAmount = issueAmount; // No slippage for testing

    // Issue with wOS token
    await issuerUser1.issue(mintAmount, wOSTokenInfo.address, minDsAmount);

    // Issue with stS token
    await issuerUser1.issue(mintAmount, stSTokenInfo.address, minDsAmount);

    // Now redeem dS for each collateral type
    const redeemAmount = 30000n * 10n ** 6n; // 30k dS
    const minCollateralAmount = 0n; // No slippage check for simplicity in test

    // Approve dS for the redeemer
    await dsUser1.approve(redeemerUser1.getAddress(), redeemAmount * 3n);

    // Get initial balances
    const initialWOSBalance = await wOSTokenUser1.balanceOf(user1);
    const initialStSBalance = await stSTokenUser1.balanceOf(user1);

    // Redeem for wOS token
    await redeemerUser1.redeem(
      redeemAmount,
      wOSTokenInfo.address,
      minCollateralAmount
    );

    // Redeem for stS token
    await redeemerUser1.redeem(
      redeemAmount,
      stSTokenInfo.address,
      minCollateralAmount
    );

    // Check final balances
    const finalWOSBalance = await wOSTokenUser1.balanceOf(user1);
    const finalStSBalance = await stSTokenUser1.balanceOf(user1);

    // Verify balances increased
    assert.isTrue(
      finalWOSBalance > initialWOSBalance,
      "wOS token balance should have increased after redemption"
    );
    assert.isTrue(
      finalStSBalance > initialStSBalance,
      "stS token balance should have increased after redemption"
    );

    // Check invariants
    await checkInvariants();
  });

  it("should maintain proper collateralization ratio", async function () {
    // Mint some tokens to user1
    const mintAmount = 1000000n * 10n ** 18n; // 1 million tokens

    // Transfer tokens to user1
    await wOSTokenContract.transfer(user1, mintAmount);
    await stSTokenContract.transfer(user1, mintAmount);

    // Connect to contracts as user1
    const user1Signer = await hre.ethers.getSigner(user1);
    const wOSTokenUser1 = wOSTokenContract.connect(user1Signer);
    const stSTokenUser1 = stSTokenContract.connect(user1Signer);
    const issuerUser1 = issuerContract.connect(user1Signer);

    // Approve tokens for the issuer
    await wOSTokenUser1.approve(issuerContract.getAddress(), mintAmount);
    await stSTokenUser1.approve(issuerContract.getAddress(), mintAmount);

    // Issue dS with each token type
    const issueAmount = 100000n * 10n ** 6n; // 100k dS (6 decimals)
    const minDsAmount = issueAmount; // No slippage for testing

    // Issue with stS token
    await issuerUser1.issue(mintAmount, stSTokenInfo.address, minDsAmount);

    // Check collateralization ratio after first issuance
    const circulatingSupply1 = await issuerContract.circulatingDusd();
    const totalCollateralValueInDs1 = await issuerContract.collateralInDusd();

    assert.isTrue(
      totalCollateralValueInDs1 >= circulatingSupply1,
      "Collateral value should be greater than or equal to circulating supply"
    );

    // Issue with wOS token
    await issuerUser1.issue(mintAmount, wOSTokenInfo.address, minDsAmount);

    // Check collateralization ratio after second issuance
    const circulatingSupply2 = await issuerContract.circulatingDusd();
    const totalCollateralValueInDs2 = await issuerContract.collateralInDusd();

    assert.isTrue(
      totalCollateralValueInDs2 >= circulatingSupply2,
      "Collateral value should be greater than or equal to circulating supply after second issuance"
    );
    assert.isTrue(
      circulatingSupply2 > circulatingSupply1,
      "Circulating supply should increase after second issuance"
    );
    assert.isTrue(
      totalCollateralValueInDs2 > totalCollateralValueInDs1,
      "Collateral value should increase after second issuance"
    );

    // Check invariants
    await checkInvariants();
  });
});
