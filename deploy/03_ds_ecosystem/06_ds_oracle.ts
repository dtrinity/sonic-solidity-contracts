import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";
import { ZeroAddress } from "ethers";

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

  // Get the oracle address for wS, wS should never be the zero address
  const wSAddress = config.tokenAddresses.wS;
  if (!wSAddress || wSAddress === ZeroAddress) {
    throw new Error("wS address not found in config");
  }

  // Get the oracle that OracleAggregator points to for wS
  const wSOracleAddress =
    await oracleAggregatorContract.assetOracles(wSAddress);
  if (wSOracleAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("Oracle for wS not set in OracleAggregator");
  }

  // Point dS to the same oracle as wS
  console.log(
    `Setting oracle for dS (${config.tokenAddresses.dS}) to the same as wS (${wSAddress}): ${wSOracleAddress}`
  );
  await oracleAggregatorContract.setOracle(
    config.tokenAddresses.dS,
    wSOracleAddress
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["ds"];
func.dependencies = [ORACLE_AGGREGATOR_ID];
func.id = "DS_ORACLE";

export default func;
