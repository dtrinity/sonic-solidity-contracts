// Deployment IDs for hardhat-deploy
export const REWARD_COMPOUNDER_ODOS_ID = "RewardCompounderDLendOdos";
export const REWARD_HELPER_ID = "RewardHelper";

// Network-specific deployment addresses
export const deployments = {
  sonic_mainnet: {
    RewardCompounderDLendOdos: "",
    RewardHelper: "",
  },
  sonic_testnet: {
    RewardCompounderDLendOdos: "",
    RewardHelper: "",
  },
};

// Helper function to get deployed address
export function getDeployedAddress(contractId: string, network: string): string | null {
  const networkDeployments = (deployments as any)[network];
  return networkDeployments?.[contractId] || null;
}
