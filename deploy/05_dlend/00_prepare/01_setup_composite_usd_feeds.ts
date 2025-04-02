import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "ethers";

import {
  USD_ORACLE_AGGREGATOR_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
} from "../../../typescript/deploy-ids";
import { getTokenContractForSymbol } from "../../../typescript/token/utils";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const signer = await hre.ethers.getSigner(deployer);

  // --- Get necessary contracts and addresses ---

  // Oracle Aggregators
  const { address: usdOracleAggregatorAddress } = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID
  );
  const usdOracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    usdOracleAggregatorAddress,
    signer
  );
  const { address: sOracleAggregatorAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID
  );
  const sOracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    sOracleAggregatorAddress,
    signer
  );

  // Existing USD Composite Wrapper
  const { address: compositeWrapperAddress } = await hre.deployments.get(
    USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID
  );
  const compositeWrapper = await hre.ethers.getContractAt(
    "API3CompositeWrapperWithThresholding",
    compositeWrapperAddress,
    signer
  );

  // Token Addresses
  const { tokenInfo: stSTokenInfo } = await getTokenContractForSymbol(
    hre,
    deployer,
    "stS"
  );
  const stSTokenAddress = stSTokenInfo.address;
  const { tokenInfo: wOSTokenInfo } = await getTokenContractForSymbol(
    hre,
    deployer,
    "wOS"
  );
  const wOSTokenAddress = wOSTokenInfo.address;
  const { tokenInfo: wSTokenInfo } = await getTokenContractForSymbol(
    hre,
    deployer,
    "wS"
  );
  const wSTokenAddress = wSTokenInfo.address;

  // --- Get Oracle Addresses from Aggregators ---
  const stS_S_OracleAddress =
    await sOracleAggregator.assetOracles(stSTokenAddress);
  const wOS_S_OracleAddress =
    await sOracleAggregator.assetOracles(wOSTokenAddress);
  const S_USD_OracleAddress =
    await usdOracleAggregator.assetOracles(wSTokenAddress);

  // --- Configure Feeds within the Existing Wrapper ---

  // Configure stS -> S -> USD feed
  await compositeWrapper.addCompositeFeed(
    stSTokenAddress,
    stS_S_OracleAddress,
    S_USD_OracleAddress,
    ethers.ZeroAddress,
    0,
    ethers.ZeroAddress,
    0
  );

  // Configure wOS -> S -> USD feed
  await compositeWrapper.addCompositeFeed(
    wOSTokenAddress,
    wOS_S_OracleAddress,
    S_USD_OracleAddress,
    ethers.ZeroAddress,
    0,
    ethers.ZeroAddress,
    0
  );

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true; // Ensures the script runs only once per deployment
};

func.id = "dLend:prepare:setup_composite_usd_feeds";
func.tags = ["dlend-prepare", "oracles"];
func.dependencies = [
  // Depends on the aggregators and the composite wrapper being deployed
  USD_ORACLE_AGGREGATOR_ID,
  S_ORACLE_AGGREGATOR_ID,
  USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID,
  // Also depends on the underlying oracles used by the aggregators for stS, wOS, and wS
];
// This script ensures the composite feeds required by the Aave PriceOracle are set up
// within the main USD Composite Wrapper.

export default func;
