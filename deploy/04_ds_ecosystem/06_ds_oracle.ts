import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_HARD_PEG_ORACLE_WRAPPER_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  await hre.deployments.deploy(DS_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.S.baseCurrency,
      BigInt(10) ** BigInt(config.oracleAggregators.S.priceDecimals),
      config.oracleAggregators.S.hardDStablePeg,
    ],
    contract: "HardPegOracleWrapper",
    autoMine: true,
    log: false,
  });

  // Get OracleAggregator contract
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );
  const oracleAggregatorContract = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get HardPegOracleWrapper contract
  const { address: hardPegOracleWrapperAddress } = await hre.deployments.get(
    DS_HARD_PEG_ORACLE_WRAPPER_ID,
  );

  // Set the HardPegOracleWrapper as the oracle for dUSD
  console.log(
    `Setting HardPegOracleWrapper for dS (${config.tokenAddresses.dS}) to`,
    hardPegOracleWrapperAddress,
  );
  await oracleAggregatorContract.setOracle(
    config.tokenAddresses.dS,
    hardPegOracleWrapperAddress,
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["ds"];
func.dependencies = ["s-oracle"];
func.id = DS_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
