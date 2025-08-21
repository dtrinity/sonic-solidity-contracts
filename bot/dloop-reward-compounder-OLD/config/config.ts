import { HardhatRuntimeEnvironment } from "hardhat/types";
import { addresses as sonicMainnetAddresses } from "./networks/sonic_mainnet";
import { addresses as sonicTestnetAddresses } from "./networks/sonic_testnet";

export interface RewardCompounderConfig {
  coreAddress: string;
  dusdAddress: string;
  collateralAddress: string;
  flashLenderAddress: string;
  odosRouterAddress: string;
  rewardControllerAddress: string;
  poolAddress: string;
  addressProviderAddress: string;
}

export async function getConfig(hre: HardhatRuntimeEnvironment): Promise<RewardCompounderConfig> {
  const network = hre.network.name;

  let addresses;
  switch (network) {
    case "sonic_mainnet":
      addresses = sonicMainnetAddresses;
      break;
    case "sonic_testnet":
      addresses = sonicTestnetAddresses;
      break;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }

  return {
    coreAddress: addresses.CORE,
    dusdAddress: addresses.DUSD,
    collateralAddress: addresses.COLLATERAL,
    flashLenderAddress: addresses.FLASH_LENDER,
    odosRouterAddress: addresses.ODOS_ROUTER,
    rewardControllerAddress: addresses.REWARD_CONTROLLER,
    poolAddress: addresses.POOL,
    addressProviderAddress: addresses.ADDRESS_PROVIDER,
  };
}
