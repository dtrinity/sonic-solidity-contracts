export const REWARD_COMPOUNDER_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "_dusd", "type": "address" },
            { "internalType": "address", "name": "_collateral", "type": "address" },
            { "internalType": "address", "name": "_flash", "type": "address" },
            { "internalType": "address", "name": "_core", "type": "address" },
            { "internalType": "address", "name": "_swapAgg", "type": "address" }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [],
        "name": "InvalidLender",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidToken",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "ZeroThreshold",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "DepositDisabled",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "SwapFailed",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InsufficientCollateral",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "NotEnoughToRepay",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": false, "internalType": "uint256", "name": "sharesTarget", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "flashAmount", "type": "uint256" }
        ],
        "name": "RunStarted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": false, "internalType": "uint256", "name": "spentDUSD", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "gotCollateral", "type": "uint256" }
        ],
        "name": "SwapExecuted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": false, "internalType": "uint256", "name": "sharesMinted", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "assetsUsed", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "kBorrowed", "type": "uint256" }
        ],
        "name": "Minted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": false, "internalType": "uint256", "name": "netDUSDReward", "type": "uint256" }
        ],
        "name": "Compounded",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": false, "internalType": "uint256", "name": "totalDebt", "type": "uint256" }
        ],
        "name": "FlashRepaid",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": false, "internalType": "int256", "name": "profit", "type": "int256" }
        ],
        "name": "RunProfit",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "COLLATERAL",
        "outputs": [{ "internalType": "contract IERC20", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "CORE",
        "outputs": [{ "internalType": "contract IDLoopCoreDLend", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "DUSD",
        "outputs": [{ "internalType": "contract IERC20", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "FLASH",
        "outputs": [{ "internalType": "contract IERC3156FlashLender", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "SWAP_AGG",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "bytes", "name": "swapCalldata", "type": "bytes" },
            { "internalType": "uint256", "name": "flashAmount", "type": "uint256" },
            { "internalType": "uint256", "name": "slippageBps", "type": "uint256" }
        ],
        "name": "run",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "initiator", "type": "address" },
            { "internalType": "address", "name": "token", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" },
            { "internalType": "uint256", "name": "fee", "type": "uint256" },
            { "internalType": "bytes", "name": "data", "type": "bytes" }
        ],
        "name": "onFlashLoan",
        "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;
