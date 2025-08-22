// AaveOracle needs to fetch the base asset price, AaveOracle just passes through prices to the USD OracleAggregator
// To accomplish this, we can just point the base asset price feed to the dUSD hard peg oracle which always returns 1

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { DUSD_HARD_PEG_ORACLE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID } from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Point the base currency (USD) price feed to the dUSD HardPegOracleWrapper
  const { address: oracleAggregatorAddress } = await hre.deployments.get(USD_ORACLE_AGGREGATOR_ID);
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer),
  );

  const { address: hardPegAddress } = await hre.deployments.get(DUSD_HARD_PEG_ORACLE_WRAPPER_ID);

  console.log(`Setting HardPegOracleWrapper for base currency (${config.oracleAggregators.USD.baseCurrency}) to`, hardPegAddress);
  await oracleAggregator.setOracle(config.oracleAggregators.USD.baseCurrency, hardPegAddress);

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["dusd"];
func.dependencies = [DUSD_HARD_PEG_ORACLE_WRAPPER_ID, USD_ORACLE_AGGREGATOR_ID];
func.id = "point-usd-oracle-aggregator-for-usd";

export default func;
