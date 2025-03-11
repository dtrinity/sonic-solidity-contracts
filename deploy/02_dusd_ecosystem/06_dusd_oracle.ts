import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_HARD_PEG_ORACLE_WRAPPER_ID,
  ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  await hre.deployments.deploy(DUSD_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [
      config.oracleAggregator.hardDusdPeg,
      BigInt(10) ** BigInt(config.oracleAggregator.priceDecimals),
    ],
    contract: "HardPegOracleWrapper",
    autoMine: true,
    log: false,
  });

  // Get OracleAggregator contract
  const { address: oracleAggregatorAddress } =
    await hre.deployments.get(ORACLE_AGGREGATOR_ID);
  const oracleAggregatorContract = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer)
  );

  // Get HardPegOracleWrapper contract
  const { address: hardPegOracleWrapperAddress } = await hre.deployments.get(
    DUSD_HARD_PEG_ORACLE_WRAPPER_ID
  );

  // Set the HardPegOracleWrapper as the oracle for dUSD
  console.log(
    `Setting HardPegOracleWrapper for dUSD (${config.tokenAddresses.dUSD}) to`,
    hardPegOracleWrapperAddress
  );
  await oracleAggregatorContract.setOracle(
    config.tokenAddresses.dUSD,
    hardPegOracleWrapperAddress
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["dusd"];
func.dependencies = [ORACLE_AGGREGATOR_ID];
func.id = DUSD_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
