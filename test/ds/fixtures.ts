import { ZeroAddress } from "ethers";
import hre, { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_ISSUER_CONTRACT_ID,
  DS_REDEEMER_CONTRACT_ID,
  ORACLE_AGGREGATOR_ID,
  DS_AMO_MANAGER_ID,
} from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";

export const standaloneMinimalFixture = deployments.createFixture(
  async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["ds"]);

    const { deployer } = await hre.getNamedAccounts();
    const signer = await hre.ethers.getSigner(deployer);

    const { tokenInfo: dsInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "dS"
    );
    const { tokenInfo: wOSInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "wOS"
    );
    const { tokenInfo: stSInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "stS"
    );
    const mockOracleAggregator = await hre.deployments.deploy(
      "MockOracleAggregator",
      {
        from: deployer,
        args: [
          ZeroAddress,
          BigInt(10) ** BigInt(ORACLE_AGGREGATOR_PRICE_DECIMALS),
        ],
        autoMine: true,
        log: false,
      }
    );

    // Set prices for the mock oracle
    const mockOracleAggregatorContract = await hre.ethers.getContractAt(
      "MockOracleAggregator",
      mockOracleAggregator.address,
      signer
    );
    await mockOracleAggregatorContract.setAssetPrice(
      wOSInfo.address,
      hre.ethers.parseUnits("1.1", ORACLE_AGGREGATOR_PRICE_DECIMALS)
    );
    await mockOracleAggregatorContract.setAssetPrice(
      stSInfo.address,
      hre.ethers.parseUnits("1.1", ORACLE_AGGREGATOR_PRICE_DECIMALS)
    );

    // Point OracleAggregator to the mock oracle
    const { address: oracleAggregatorAddress } =
      await hre.deployments.get(ORACLE_AGGREGATOR_ID);
    const oracleAggregator = await hre.ethers.getContractAt(
      "OracleAggregator",
      oracleAggregatorAddress,
      signer
    );
    await oracleAggregator.grantRole(
      await oracleAggregator.ORACLE_MANAGER_ROLE(),
      deployer
    );
    await oracleAggregator.setOracle(
      wOSInfo.address,
      mockOracleAggregator.address
    );
    await oracleAggregator.setOracle(
      stSInfo.address,
      mockOracleAggregator.address
    );

    await setupDusdEcosystem(
      hre,
      oracleAggregatorAddress as string,
      dsInfo.address,
      deployer
    );
  }
);

export const standaloneAmoFixture = deployments.createFixture(
  async ({ deployments }) => {
    await standaloneMinimalFixture(deployments);

    const { deployer } = await hre.getNamedAccounts();
    const { address: amoManagerAddress } =
      await deployments.get(DS_AMO_MANAGER_ID);
    const { tokenInfo: dsInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "dS"
    );
    const { address: mockOracleAggregatorAddress } =
      await deployments.get(ORACLE_AGGREGATOR_ID);

    // Deploy MockAmoVault using standard deployment
    await hre.deployments.deploy("MockAmoVault", {
      from: deployer,
      args: [
        dsInfo.address,
        amoManagerAddress,
        deployer,
        deployer,
        deployer,
        mockOracleAggregatorAddress,
      ],
      autoMine: true,
      log: false,
    });
  }
);

const setupDusdEcosystem = async (
  hre: HardhatRuntimeEnvironment,
  oracleAddress: string,
  dsAddress: string,
  dsDeployer: string
): Promise<void> => {
  // Update dS contracts with oracle
  const setOracleForContract = async (
    contractId: string,
    contractName: string
  ): Promise<void> => {
    const { address } = await hre.deployments.get(contractId);
    const contract = await hre.ethers.getContractAt(
      contractName,
      address,
      await hre.ethers.getSigner(dsDeployer)
    );
    await contract.setOracle(oracleAddress);
  };

  await setOracleForContract(
    DS_COLLATERAL_VAULT_CONTRACT_ID,
    "CollateralHolderVault"
  );
  await setOracleForContract(DS_REDEEMER_CONTRACT_ID, "Redeemer");
  await setOracleForContract(DS_ISSUER_CONTRACT_ID, "Issuer");
};
