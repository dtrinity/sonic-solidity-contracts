export const REWARD_HELPER_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "_pool", "type": "address" },
            { "internalType": "address", "name": "_rewards", "type": "address" },
            { "internalType": "address", "name": "_provider", "type": "address" }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [],
        "name": "InvalidAddress",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NoRewardsFound",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ADDRESS_PROVIDER",
        "outputs": [{ "internalType": "contract IPoolAddressesProvider", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "POOL",
        "outputs": [{ "internalType": "contract IPool", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "REWARDS_CONTROLLER",
        "outputs": [{ "internalType": "contract IRewardsDistributor", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getAllReserves",
        "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "address", "name": "rewardToken", "type": "address" }
        ],
        "name": "getUserAccruedRewards",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "address[]", "name": "assets", "type": "address[]" },
            { "internalType": "address", "name": "rewardToken", "type": "address" }
        ],
        "name": "getUserTotalRewards",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "address[]", "name": "assets", "type": "address[]" }
        ],
        "name": "getAllUserRewards",
        "outputs": [
            { "internalType": "address[]", "name": "rewardTokens", "type": "address[]" },
            { "internalType": "uint256[]", "name": "rewardAmounts", "type": "uint256[]" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "address", "name": "rewardToken", "type": "address" }
        ],
        "name": "getUserRewardsAllReserves",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "user", "type": "address" }
        ],
        "name": "getUserRewardSummary",
        "outputs": [
            { "internalType": "uint256", "name": "totalAccruedRewards", "type": "uint256" },
            { "internalType": "address[]", "name": "rewardTokens", "type": "address[]" },
            { "internalType": "uint256[]", "name": "accruedAmounts", "type": "uint256[]" }
        ],
        "stateMutability": "view",
        "type": "function"
    }
] as const;
