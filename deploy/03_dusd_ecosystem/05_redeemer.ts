import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_REDEEMER_CONTRACT_ID,
  DUSD_TOKEN_ID,
  USD_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  // Get deployed addresses
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    USD_ORACLE_AGGREGATOR_ID,
  );

  const { address: collateralVaultAddress } = await hre.deployments.get(
    DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const collateralVault = await hre.ethers.getContractAt(
    "CollateralHolderVault",
    collateralVaultAddress,
    await hre.ethers.getSigner(deployer),
  );
  const { tokenAddresses } = await getConfig(hre);

  const deployment = await hre.deployments.deploy(DUSD_REDEEMER_CONTRACT_ID, {
    from: deployer,
    args: [
      collateralVaultAddress,
      tokenAddresses.dUSD,
      oracleAggregatorAddress,
    ],
    contract: "Redeemer",
    autoMine: true,
    log: false,
  });

  console.log("Allowing Redeemer to withdraw collateral");
  await collateralVault.grantRole(
    await collateralVault.COLLATERAL_WITHDRAWER_ROLE(),
    deployment.address,
  );

  console.log(`☯️ ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DUSD_REDEEMER_CONTRACT_ID;
func.tags = ["dusd"];
func.dependencies = [
  DUSD_COLLATERAL_VAULT_CONTRACT_ID,
  DUSD_TOKEN_ID,
  "usd-oracle",
];

export default func;
