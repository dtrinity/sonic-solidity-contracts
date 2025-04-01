import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  S_ORACLE_AGGREGATOR_ID,
  WS_HARD_PEG_ORACLE_WRAPPER_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  // Deploy a hard peg oracle wrapper for wS with a peg of 1
  await hre.deployments.deploy(WS_HARD_PEG_ORACLE_WRAPPER_ID, {
    from: deployer,
    args: [
      config.oracleAggregators.S.baseCurrency, // Technically this is wS, so wS points to itself, but that's ok since we treat the counterparty risk of wS as negligible
      BigInt(10) ** BigInt(config.oracleAggregators.S.priceDecimals), // 1 unit of wS
      BigInt(10) ** BigInt(config.oracleAggregators.S.priceDecimals), // Hard peg of 1 S per wS
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
    WS_HARD_PEG_ORACLE_WRAPPER_ID,
  );

  // Set the HardPegOracleWrapper as the oracle for wS
  console.log(
    `Setting HardPegOracleWrapper for wS (${config.tokenAddresses.wS}) to`,
    hardPegOracleWrapperAddress,
  );
  await oracleAggregatorContract.setOracle(
    config.tokenAddresses.wS,
    hardPegOracleWrapperAddress,
  );

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["ds"];
func.dependencies = ["s-oracle"];
func.id = WS_HARD_PEG_ORACLE_WRAPPER_ID;

export default func;
