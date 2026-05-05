import { HardhatRuntimeEnvironment } from "hardhat/types";

type ForkingConfig = {
  network?: string;
};

/**
 * Resolve the effective deployment/config network name.
 *
 * hardhat-deploy uses HARDHAT_DEPLOY_FORK to load deployments for fork tests,
 * but the repo config previously keyed only off hre.network.name. Mirror the
 * hardhat-deploy convention so forked tests can reuse live network config.
 *
 * @param hre - Hardhat runtime environment.
 */
export function getEffectiveNetworkName(hre: HardhatRuntimeEnvironment): string {
  if (process.env.HARDHAT_DEPLOY_FORK) {
    return process.env.HARDHAT_DEPLOY_FORK;
  }

  const forking = (hre.network.config as ForkingConfig | undefined)?.network;

  if (typeof forking === "string" && forking.length > 0) {
    return forking;
  }

  return hre.network.name;
}
