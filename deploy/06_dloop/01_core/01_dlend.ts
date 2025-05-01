import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../../config/config";
import { DLoopCoreConfig } from "../../../config/types";
import { assertNotEmpty } from "../../../typescript/common/assert";
import {
  DLOOP_CORE_DLEND_ID,
  POOL_ADDRESSES_PROVIDER_ID,
} from "../../../typescript/deploy-ids";

/**
 * Deploy dLOOP Core DLend contract
 *
 * @param hre - Hardhat runtime environment
 * @param dloopDeployer - The address of the deployer
 * @param dUSDAddress - The dUSD token address
 * @param vaultInfo - The vault information
 * @param vaultName - The vault name
 * @returns True if the deployment is successful
 */
async function deployDLoopCoreDLend(
  hre: HardhatRuntimeEnvironment,
  dloopDeployer: string,
  dUSDAddress: string,
  vaultInfo: DLoopCoreConfig,
  vaultName: string,
): Promise<boolean> {
  const { address: lendingPoolAddressesProviderAddress } =
    await hre.deployments.get(POOL_ADDRESSES_PROVIDER_ID);

  // Get the underlying token symbol using minimal ABI
  const minimalERC20ABI = ["function symbol() view returns (string)"];

  const underlyingTokenContract = await hre.ethers.getContractAt(
    minimalERC20ABI,
    vaultInfo.underlyingAsset,
    await hre.ethers.getSigner(dloopDeployer),
  );
  const underlyingTokenSymbol = await underlyingTokenContract.symbol();

  if (underlyingTokenSymbol === "") {
    throw new Error("The underlying token symbol is empty");
  }

  await hre.deployments.deploy(vaultName, {
    from: dloopDeployer,
    contract: "DLoopCoreDLend",
    args: [
      vaultInfo.name,
      vaultInfo.symbol,
      assertNotEmpty(vaultInfo.underlyingAsset),
      assertNotEmpty(dUSDAddress),
      assertNotEmpty(lendingPoolAddressesProviderAddress),
      vaultInfo.targetLeverageBps,
      vaultInfo.lowerBoundTargetLeverageBps,
      vaultInfo.upperBoundTargetLeverageBps,
      vaultInfo.maxSubsidyBps,
    ],
    log: true,
    autoMine: true,
  });

  return true;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts, getChainId } = hre;
  const { dloopDeployer } = await getNamedAccounts();
  const chainId = await getChainId();

  // Get network config
  const networkConfig = await getConfig(hre);
  const dloopConfig = networkConfig.dLoop;

  // Skip if no dLOOP configuration or no core vaults are defined
  if (
    !dloopConfig ||
    !dloopConfig.coreVaults ||
    Object.keys(dloopConfig.coreVaults).length === 0
  ) {
    console.log(
      `No dLOOP core vaults defined for network ${hre.network.name}. Skipping.`,
    );
    return;
  }

  // Get the dUSD token address from the configuration
  const dUSDAddress = dloopConfig.dUSDAddress;

  if (!dUSDAddress) {
    throw new Error("dUSD token address not found in configuration");
  }

  console.log(
    `Deploying dLOOP core vaults on network ${hre.network.name} (chainId: ${chainId})`,
  );

  // Deploy each core vault
  for (const [vaultKey, vaultInfo] of Object.entries(dloopConfig.coreVaults)) {
    console.log(`Deploying dLOOP core vault: ${vaultKey}`);

    switch (vaultInfo.venue) {
      case "dlend":
        await deployDLoopCoreDLend(
          hre,
          dloopDeployer,
          dUSDAddress,
          vaultInfo,
          vaultKey,
        );
        break;
      default:
        throw new Error(`Unsupported core vault venue: ${vaultInfo.venue}`);
    }
  }

  console.log("All dLOOP core vaults deployed successfully");

  return true;
};

func.tags = ["dloop", "core", "dlend"];
func.dependencies = [POOL_ADDRESSES_PROVIDER_ID];
func.id = DLOOP_CORE_DLEND_ID;

export default func;
