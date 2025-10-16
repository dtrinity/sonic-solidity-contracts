import { ethers, BigNumberish } from "ethers";

// Network configurations
const NETWORKS = {
  sonic: {
    name: "sonic",
    rpcUrl: "https://rpc.soniclabs.com",
    chainId: 146,
    poolAddressesProvider: "0x1f8d8a3575d049aA0C195AA947483738811bAdcb",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    contracts: [
      "0x9ee939DdC8eaAAc72d3cAE793b12a09D92624E4a",
      "0x951Ed02C90A0185575Dc82e94088b9d3016b7263",
      "0xB8445316dB44C05c5D2fE37f610B773a072432C1",
      "0x6DF9A77c866e8a9C998286bDa5A17543e2105991",
      "0xB7c8B7C260D3CF0cc3ccF1AADF5a55d0C5032EB1",
    ],
  },
  fraxtal: {
    name: "fraxtal",
    rpcUrl: "https://rpc.frax.com",
    chainId: 252,
    poolAddressesProvider: "0xD9C622d64342B5FaCeef4d366B974AEf6dCB338D",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    contracts: [
      "0x9A8aF808Dd8884c7CaaFc6c90ABdC3f9EA418a83",
      "0x95c0afea3f48D4e3a5fE51b62e8B9F8538B8Ff11",
      "0xA860D1f093092440BBeadc0B85f1F14C004AB6f6",
    ],
  },
};

// ERC20 ABI for allowance and symbol functions
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Multicall3 ABI - only the methods we need
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)",
];

// PoolAddressesProvider ABI
const POOL_ADDRESSES_PROVIDER_ABI = ["function getPool() view returns (address)"];

// Pool ABI - simplified for the functions we need
const POOL_ABI = [
  "function getReservesList() view returns (address[])",
  "function getReserveData(address asset) view returns (tuple(tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked))",
];

interface ReserveData {
  configuration: { data: BigNumberish };
  liquidityIndex: BigNumberish;
  currentLiquidityRate: BigNumberish;
  variableBorrowIndex: BigNumberish;
  currentVariableBorrowRate: BigNumberish;
  currentStableBorrowRate: BigNumberish;
  lastUpdateTimestamp: BigNumberish;
  id: number;
  aTokenAddress: string;
  stableDebtTokenAddress: string;
  variableDebtTokenAddress: string;
  interestRateStrategyAddress: string;
  accruedToTreasury: BigNumberish;
  unbacked: BigNumberish;
}

interface TargetAsset {
  address: string;
  symbol: string;
  type: "underlying" | "aToken" | "stableDebt" | "variableDebt";
  underlyingAddress?: string;
}

async function getTargetAssets(provider: ethers.JsonRpcProvider, poolAddress: string, multicall3Address: string): Promise<TargetAsset[]> {
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

  // Get all reserve addresses
  const reservesList = await pool.getReservesList();
  console.log(`Found ${reservesList.length} reserves`);

  const targetAssets: TargetAsset[] = [];

  // Use individual calls for reserve data and symbols (multicall for allowances only)
  for (const reserveAddress of reservesList) {
    try {
      // Get reserve data
      const reserveData: ReserveData = await pool.getReserveData(reserveAddress);

      // Get underlying token symbol
      const underlyingToken = new ethers.Contract(reserveAddress, ERC20_ABI, provider);
      const symbol = await underlyingToken.symbol();

      // Add underlying token
      targetAssets.push({
        address: reserveAddress,
        symbol: symbol,
        type: "underlying",
      });

      // Add aToken
      targetAssets.push({
        address: reserveData.aTokenAddress,
        symbol: `a${symbol}`,
        type: "aToken",
        underlyingAddress: reserveAddress,
      });

      // // Add stable debt token
      // targetAssets.push({
      //   address: reserveData.stableDebtTokenAddress,
      //   symbol: `stableDebt${symbol}`,
      //   type: 'stableDebt',
      //   underlyingAddress: reserveAddress
      // });

      // // Add variable debt token
      // targetAssets.push({
      //   address: reserveData.variableDebtTokenAddress,
      //   symbol: `variableDebt${symbol}`,
      //   type: 'variableDebt',
      //   underlyingAddress: reserveAddress
      // });

      console.log(`Added reserve ${symbol} (${reserveAddress})`);
    } catch (error) {
      console.error(`Error getting data for reserve ${reserveAddress}:`, error);
    }
  }

  return targetAssets;
}

async function checkAllAllowances(
  provider: ethers.JsonRpcProvider,
  multicall3Address: string,
  targetAssets: TargetAsset[],
  userWallet: string,
  contracts: string[],
): Promise<Record<string, Record<string, string>>> {
  const multicallInterface = new ethers.Interface(MULTICALL3_ABI);
  const erc20Interface = new ethers.Interface(ERC20_ABI);

  // Prepare all allowance calls
  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];

  for (const asset of targetAssets) {
    for (const contract of contracts) {
      const callData = erc20Interface.encodeFunctionData("allowance", [userWallet, contract]);
      calls.push({
        target: asset.address,
        allowFailure: true,
        callData,
      });
    }
  }

  console.log(`Executing multicall with ${calls.length} allowance checks...`);

  // Execute multicall using provider.call
  const multicallData = multicallInterface.encodeFunctionData("aggregate3", [calls]);
  const tx = {
    to: multicall3Address,
    data: multicallData,
  };

  const result = await provider.call(tx);
  const decodedResult = multicallInterface.decodeFunctionResult("aggregate3", result);
  const multicallResults = decodedResult[0];

  // Process results
  const results: Record<string, Record<string, string>> = {};
  let callIndex = 0;

  for (const asset of targetAssets) {
    results[asset.address] = {};

    for (const contract of contracts) {
      const result = multicallResults[callIndex];

      if (result.success) {
        try {
          const decoded = erc20Interface.decodeFunctionResult("allowance", result.returnData);
          results[asset.address][contract] = decoded[0].toString();
        } catch (error) {
          console.error(`Error decoding allowance for ${asset.address} -> ${contract}:`, error);
          results[asset.address][contract] = "DECODE_ERROR";
        }
      } else {
        console.error(`Failed to get allowance for ${asset.address} -> ${contract}`);
        results[asset.address][contract] = "CALL_FAILED";
      }

      callIndex++;
    }
  }

  return results;
}

async function main() {
  const userWallet = process.argv[2];

  if (!userWallet || !ethers.isAddress(userWallet)) {
    console.error("Usage: yarn ts-node scripts/check-approve-allowance.ts <user_wallet_address>");
    console.error("Please provide a valid Ethereum address");
    process.exit(1);
  }

  console.log(`Checking allowances for user wallet: ${userWallet}\n`);

  for (const [networkKey, networkConfig] of Object.entries(NETWORKS)) {
    console.log(`\n=== ${networkConfig.name.toUpperCase()} NETWORK ===`);

    try {
      // Set up provider
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

      // Get pool address
      const poolAddressesProvider = new ethers.Contract(networkConfig.poolAddressesProvider, POOL_ADDRESSES_PROVIDER_ABI, provider);
      const poolAddress = await poolAddressesProvider.getPool();
      console.log(`Pool address: ${poolAddress}`);

      // Get target assets
      const targetAssets = await getTargetAssets(provider, poolAddress, networkConfig.multicall3);
      console.log(`\nFound ${targetAssets.length} target assets:`);
      targetAssets.forEach((asset) => {
        console.log(`  ${asset.symbol}: ${asset.address} (${asset.type})`);
      });

      // Check all allowances in a single multicall
      console.log(`\nChecking allowances for ${networkConfig.contracts.length} contracts...`);
      const allowanceResults = await checkAllAllowances(
        provider,
        networkConfig.multicall3,
        targetAssets,
        userWallet,
        networkConfig.contracts,
      );

      // Display results
      for (const contractAddress of networkConfig.contracts) {
        console.log(`\nContract: ${contractAddress}`);

        let hasNonZeroAllowances = false;
        for (const asset of targetAssets) {
          const allowance = allowanceResults[asset.address][contractAddress];
          if (allowance !== "0" && allowance !== "CALL_FAILED" && allowance !== "DECODE_ERROR") {
            console.log(`  ${asset.symbol}: ${allowance}`);
            hasNonZeroAllowances = true;
          }
        }

        if (!hasNonZeroAllowances) {
          console.log(`  No non-zero allowances found`);
        }
      }
    } catch (error) {
      console.error(`Error processing ${networkConfig.name} network:`, error);
    }
  }
}

// Run the script
main().catch(console.error);
