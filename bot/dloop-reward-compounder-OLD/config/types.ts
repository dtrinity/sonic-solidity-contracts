export type NetworkAddresses = {
  CORE: string;
  DUSD: string;
  COLLATERAL: string;
  FLASH_LENDER: string;
  ODOS_ROUTER: string;
  REWARD_CONTROLLER?: string;
  POOL?: string;
  ADDRESS_PROVIDER?: string;
  REWARD_HELPER?: string;
};

export type RuntimeParams = {
  pollIntervalMs: number;
  slippageBps: number;
  minProfitBps: number;
};
