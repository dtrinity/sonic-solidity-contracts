import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_AMO_MANAGER_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_ISSUER_CONTRACT_ID,
  DS_TOKEN_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );

  const { address: collateralVaultAddress } = await hre.deployments.get(
    DS_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const { tokenAddresses } = await getConfig(hre);
  const { address: amoManagerAddress } =
    await hre.deployments.get(DS_AMO_MANAGER_ID);

  await hre.deployments.deploy(DS_ISSUER_CONTRACT_ID, {
    from: deployer,
    args: [
      collateralVaultAddress,
      tokenAddresses.dS,
      oracleAggregatorAddress,
      amoManagerAddress,
    ],
    contract: "Issuer",
    autoMine: true,
    log: false,
  });

  // Get the deployed Issuer contract address
  const { address: issuerAddress } = await hre.deployments.get(
    DS_ISSUER_CONTRACT_ID,
  );

  // Grant MINTER_ROLE to the Issuer contract so it can mint dS
  const dsContract = await hre.ethers.getContractAt(
    "ERC20StablecoinUpgradeable",
    tokenAddresses.dS,
  );

  const MINTER_ROLE = await dsContract.MINTER_ROLE();

  await dsContract.grantRole(MINTER_ROLE, issuerAddress);
  console.log(`Granted MINTER_ROLE to Issuer contract at ${issuerAddress}`);

  console.log(`≻ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DS_ISSUER_CONTRACT_ID;
func.tags = ["ds"];
func.dependencies = [
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  DS_TOKEN_ID,
  "s-oracle",
  DS_AMO_MANAGER_ID,
];

export default func;
