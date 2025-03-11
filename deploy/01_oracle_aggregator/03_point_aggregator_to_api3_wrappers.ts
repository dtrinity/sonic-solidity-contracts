import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  API3_ORACLE_WRAPPER_ID,
  ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  // Get OracleAggregator contract
  const { address: oracleAggregatorAddress } =
    await hre.deployments.get(ORACLE_AGGREGATOR_ID);
  const oracleAggregatorContract = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer)
  );

  // Get API3Wrapper contract for plain feeds
  const { address: api3OracleWrapperAddress } = await hre.deployments.get(
    API3_ORACLE_WRAPPER_ID
  );
  const api3OracleWrapperContract = await hre.ethers.getContractAt(
    "API3Wrapper",
    api3OracleWrapperAddress,
    await hre.ethers.getSigner(deployer)
  );

  // Set plain API3 oracle wrappers
  const plainFeeds =
    config.oracleAggregator.api3OracleAssets.plainApi3OracleWrappers || {};

  for (const [assetAddress, _proxyAddress] of Object.entries(plainFeeds)) {
    // Check that the API3 oracle wrapper has indeed been set for this asset
    const testPrice =
      await api3OracleWrapperContract.getAssetPrice(assetAddress);

    if (testPrice == 0n) {
      throw new Error(
        `The API3 oracle wrapper has not been set for ${assetAddress}`
      );
    }
    console.log(
      `Setting plain API3 oracle wrapper for ${assetAddress} to`,
      api3OracleWrapperAddress
    );
    await oracleAggregatorContract.setOracle(
      assetAddress,
      api3OracleWrapperAddress
    );
  }

  // Get API3CompositeWrapperWithThresholding contract for composite feeds
  const { address: api3CompositeWrapperAddress } = await hre.deployments.get(
    "API3CompositeWrapperWithThresholding"
  );
  const api3CompositeWrapperContract = await hre.ethers.getContractAt(
    "API3CompositeWrapperWithThresholding",
    api3CompositeWrapperAddress,
    await hre.ethers.getSigner(deployer)
  );

  // Set composite API3 oracle wrappers
  const compositeFeeds =
    config.oracleAggregator.api3OracleAssets
      .compositeApi3OracleWrappersWithThresholding || {};

  for (const [assetAddress, _feedConfig] of Object.entries(compositeFeeds)) {
    // Check that the composite API3 oracle wrapper has indeed been set for this asset
    const testPrice =
      await api3CompositeWrapperContract.getAssetPrice(assetAddress);

    if (testPrice == 0n) {
      throw new Error(
        `The composite API3 oracle wrapper has not been set for ${assetAddress}`
      );
    }
    console.log(
      `Setting composite API3 oracle wrapper for ${assetAddress} to`,
      api3CompositeWrapperAddress
    );
    await oracleAggregatorContract.setOracle(
      assetAddress,
      api3CompositeWrapperAddress
    );
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["point-api3-oracle-wrapper", "oracle-aggregator"];
func.dependencies = [ORACLE_AGGREGATOR_ID];
func.id = "POINT_API3_ORACLE_WRAPPER";

export default func;
