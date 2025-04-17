import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import {
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  S_ORACLE_AGGREGATOR_ID,
} from "../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  // Get the CollateralVault contract
  const { address: collateralVaultAddress } = await hre.deployments.get(
    DS_COLLATERAL_VAULT_CONTRACT_ID,
  );
  const collateralVault = await hre.ethers.getContractAt(
    "CollateralHolderVault",
    collateralVaultAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get the OracleAggregator contract
  const { address: oracleAggregatorAddress } = await hre.deployments.get(
    S_ORACLE_AGGREGATOR_ID,
  );
  const oracleAggregator = await hre.ethers.getContractAt(
    "OracleAggregator",
    oracleAggregatorAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get collateral addresses from config
  const collateralAddresses = config.dStables?.dS?.collaterals || [];

  // Array of tokens to whitelist with defined addresses
  interface TokenInfo {
    address: string;
  }

  const tokensToWhitelist: TokenInfo[] = [];

  // Filter out zero addresses
  for (const address of collateralAddresses) {
    if (address && address !== ZeroAddress) {
      tokensToWhitelist.push({ address });
    }
  }

  // Sanity check: Verify that the oracle can provide a price for each asset
  for (const token of tokensToWhitelist) {
    const price = await oracleAggregator.getAssetPrice(token.address);

    if (price.toString() === "0") {
      throw new Error(`Aborting: Oracle price for ${token.address} is zero.`);
    }
  }

  // Whitelist each valid token
  for (const token of tokensToWhitelist) {
    try {
      // Check if the token is already whitelisted
      const isAlreadyWhitelisted = await collateralVault.isCollateralSupported(
        token.address,
      );

      if (isAlreadyWhitelisted) {
        console.log(
          `ℹ️ ${token.address} is already whitelisted as collateral. Skipping.`,
        );
        continue;
      }

      // Whitelist the token
      await collateralVault.allowCollateral(token.address);
      console.log(`${token.address} whitelisted as collateral`);
    } catch (error) {
      throw new Error(`Error whitelisting ${token.address}: ${error}`);
    }
  }

  console.log(`🔮 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  // Return true to indicate deployment success
  return true;
};

func.tags = ["ds"];
func.dependencies = [
  "ds-collateral-vault",
  "s-oracle",
  "wS_HardPegOracleWrapper",
];
func.id = "ds-whitelist-collateral";

export default func;
