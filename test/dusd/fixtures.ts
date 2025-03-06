import { ZeroAddress } from "ethers";
import hre, { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_ISSUER_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";
import { ORACLE_AGGREGATOR_PRICE_DECIMALS } from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";

export const standaloneMinimalFixture = deployments.createFixture(
  async ({ deployments }) => {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["dusd"]);

    const { deployer } = await hre.getNamedAccounts();
    const signer = await hre.ethers.getSigner(deployer);

    const { tokenInfo: dusdInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "dUSD"
    );
    const { tokenInfo: frxUSDInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "frxUSD"
    );
    const { tokenInfo: usdcInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "USDC"
    );
    const { tokenInfo: sfrxUSDInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "sfrxUSD"
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
      frxUSDInfo.address,
      hre.ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS)
    );
    await mockOracleAggregatorContract.setAssetPrice(
      usdcInfo.address,
      hre.ethers.parseUnits("1", ORACLE_AGGREGATOR_PRICE_DECIMALS)
    );
    await mockOracleAggregatorContract.setAssetPrice(
      sfrxUSDInfo.address,
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
      frxUSDInfo.address,
      mockOracleAggregator.address
    );
    await oracleAggregator.setOracle(
      usdcInfo.address,
      mockOracleAggregator.address
    );
    await oracleAggregator.setOracle(
      sfrxUSDInfo.address,
      mockOracleAggregator.address
    );

    await setupDusdEcosystem(
      hre,
      oracleAggregatorAddress as string,
      dusdInfo.address,
      deployer
    );
  }
);

export const standaloneAmoFixture = deployments.createFixture(
  async ({ deployments }) => {
    await standaloneMinimalFixture(deployments);

    const { deployer } = await hre.getNamedAccounts();
    const { address: amoManagerAddress } = await deployments.get("AmoManager");
    const { tokenInfo: dusdInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "dUSD"
    );
    const { address: mockOracleAggregatorAddress } =
      await deployments.get(ORACLE_AGGREGATOR_ID);

    // Deploy MockAmoVault using standard deployment
    await hre.deployments.deploy("MockAmoVault", {
      from: deployer,
      args: [
        dusdInfo.address,
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
  dusdAddress: string,
  dusdDeployer: string
): Promise<void> => {
  // Update dUSD contracts with oracle
  const setOracleForContract = async (
    contractId: string,
    contractName: string
  ): Promise<void> => {
    const { address } = await hre.deployments.get(contractId);
    const contract = await hre.ethers.getContractAt(
      contractName,
      address,
      await hre.ethers.getSigner(dusdDeployer)
    );
    await contract.setOracle(oracleAddress);
  };

  await setOracleForContract(
    DUSD_COLLATERAL_VAULT_CONTRACT_ID,
    "CollateralHolderVault"
  );
  await setOracleForContract(DUSD_REDEEMER_CONTRACT_ID, "Redeemer");
  await setOracleForContract(DUSD_ISSUER_CONTRACT_ID, "Issuer");
};
