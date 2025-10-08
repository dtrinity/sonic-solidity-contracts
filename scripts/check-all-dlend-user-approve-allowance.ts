import { ethers, BigNumberish } from "ethers";
import { splitToBatches } from "../../sonic-dlend-liquidator/bot-typescript/src/common/batch";

// Network configurations - focusing on sonic
const NETWORKS = {
  sonic: {
    name: "sonic",
    rpcUrl: "https://rpc.soniclabs.com",
    chainId: 146,
    poolAddressesProvider: "0x1f8d8a3575d049aA0C195AA947483738811bAdcb",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    graphUrl: "https://graph-node-sonic.dtrinity.org/subgraphs/name/dtrinity-aave-sonic",
    contracts: [
      // "0xebC684BA06A92b35E0F1fe021D4d50DBd7b5959c", // OdosWithdrawSwapAdapterV2
      // "0x0b0cCC881660dfe660066e27DeBad16965260CaD", // OdosWithdrawSwapAdapter
      // "0x112EBE4f04E745975551880974454B56764C1e7F", // OdosRepayAdapterV2
      // "0x21c28f31521A25C98d99002d857447B0C3fC0DBE", // OdosRepayAdapter
      // "0xebC684BA06A92b35E0F1fe021D4d50DBd7b5959c",
      "0x21c28f31521A25C98d99002d857447B0C3fC0DBE",
      "0x112EBE4f04E745975551880974454B56764C1e7F",
      "0x19E3Aeb751c90dBc4D884547760631B97cad4b32",
      "0xfAEEfE857296Ec061A537B31fB1341955826b52a",
      "0x0b0ccc881660dfe660066e27debad16965260cad",
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
    graphUrl: "https://graph-node.dtrinity.org/subgraphs/name/stablyio-aave-v3-messari-mainnet",
    contracts: [
      "0xC7878A1dD9cf82f5db84dC7157F623edeE52d247", // OdosWithdrawSwapAdapter
      "0x78c4438c37809Dae02167640Bd8b6Ac7E590f847", // OdosRepayAdapter
      "0x9A8aF808Dd8884c7CaaFc6c90ABdC3f9EA418a83",
      "0x95c0afea3f48D4e3a5fE51b62e8B9F8538B8Ff11",
      "0xA860D1f093092440BBeadc0B85f1F14C004AB6f6",
    ],
  },
};

// ERC20 ABI for allowance, balance, symbol, and decimals functions
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
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
  decimals: number;
  type: "underlying" | "aToken" | "stableDebt" | "variableDebt";
  underlyingAddress?: string;
}

interface User {
  id: string;
}

/**
 * Get all users in the Lending Pool
 *
 * @param graphUrl - The graph API URL
 * @returns All user addresses
 */
async function getAllLendingUserAddresses(graphUrl: string): Promise<string[]> {
  const batchSize = 1000;

  if (batchSize < 1) {
    throw Error("Invalid batch size: " + batchSize);
  }

  const query = `query GetAccounts($first: Int, $lastId: ID){
    accounts(
        first: $first,
        where: { id_gt: $lastId }
        orderBy: id,
        orderDirection: asc
    ) {
      id
    }
  }`;

  let lastId = "";
  const allUsers: string[] = [];

  while (true) {
    const response = await fetch(graphUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        variables: { lastId, first: batchSize },
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json();

    if (responseData.errors) {
      throw new Error(JSON.stringify(responseData.errors));
    }

    if (!responseData.data) {
      throw new Error("Unknown graph error");
    }

    const result = responseData.data;
    const users = result.accounts.map((u: User) => u.id);
    allUsers.push(...users);

    if (result.accounts.length === 0) {
      break;
    }

    lastId = result.accounts[result.accounts.length - 1].id;
  }
  return allUsers;
}

async function getTargetAssets(provider: ethers.JsonRpcProvider, poolAddress: string): Promise<TargetAsset[]> {
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

      // Get underlying token symbol and decimals
      const underlyingToken = new ethers.Contract(reserveAddress, ERC20_ABI, provider);
      const symbol = await underlyingToken.symbol();
      const decimals = await underlyingToken.decimals();

      // Add underlying token
      targetAssets.push({
        address: reserveAddress,
        symbol: symbol,
        decimals: decimals,
        type: "underlying",
      });

      // Add aToken
      targetAssets.push({
        address: reserveData.aTokenAddress,
        symbol: `a${symbol}`,
        decimals: decimals, // aTokens have the same decimals as underlying
        type: "aToken",
        underlyingAddress: reserveAddress,
      });

      console.log(`Added reserve ${symbol} (${reserveAddress}) - decimals: ${decimals}`);
    } catch (error) {
      console.error(`Error getting data for reserve ${reserveAddress}:`, error);
    }
  }

  return targetAssets;
}

interface AllowanceAndBalanceResult {
  allowance: string; // Formatted allowance (human readable)
  balance: string; // Formatted balance (human readable)
}

async function checkAllUserAllowancesAndBalances(
  provider: ethers.JsonRpcProvider,
  multicall3Address: string,
  targetAssets: TargetAsset[],
  users: string[],
  contracts: string[],
  batchSize: number,
): Promise<Record<string, Record<string, Record<string, AllowanceAndBalanceResult>>>> {
  const multicallInterface = new ethers.Interface(MULTICALL3_ABI);
  const erc20Interface = new ethers.Interface(ERC20_ABI);

  console.log(`Processing ${users.length} users in batches of ${batchSize}...`);

  // Process users in batches of batchSize (to avoid "Request Entity Too Large" errors)
  const userBatches = splitToBatches(users, batchSize);
  const allResults: Record<string, Record<string, Record<string, AllowanceAndBalanceResult>>> = {};

  for (let batchIndex = 0; batchIndex < userBatches.length; batchIndex++) {
    const userBatch = userBatches[batchIndex];
    console.log(`Processing batch ${batchIndex + 1}/${userBatches.length} (${userBatch.length} users)...`);

    // Prepare all allowance and balance calls for this batch
    const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];

    for (const user of userBatch) {
      for (const asset of targetAssets) {
        // Add balance call for this user and asset
        const balanceCallData = erc20Interface.encodeFunctionData("balanceOf", [user]);
        calls.push({
          target: asset.address,
          allowFailure: true,
          callData: balanceCallData,
        });

        // Add allowance calls for each contract
        for (const contract of contracts) {
          const allowanceCallData = erc20Interface.encodeFunctionData("allowance", [user, contract]);
          calls.push({
            target: asset.address,
            allowFailure: true,
            callData: allowanceCallData,
          });
        }
      }
    }

    console.log(
      `Executing multicall with ${calls.length} calls (${calls.length / userBatch.length} per user) for batch ${batchIndex + 1}...`,
    );

    // Execute multicall using provider.call
    const multicallData = multicallInterface.encodeFunctionData("aggregate3", [calls]);
    const tx = {
      to: multicall3Address,
      data: multicallData,
    };

    const result = await provider.call(tx);
    const decodedResult = multicallInterface.decodeFunctionResult("aggregate3", result);
    const multicallResults = decodedResult[0];

    // Process results for this batch
    let callIndex = 0;

    for (const user of userBatch) {
      if (!allResults[user]) {
        allResults[user] = {};
      }

      for (const asset of targetAssets) {
        if (!allResults[user][asset.address]) {
          allResults[user][asset.address] = {};
        }

        // Process balance call first
        const balanceResult = multicallResults[callIndex];
        let formattedBalance = "0";
        if (balanceResult.success) {
          try {
            const decodedBalance = erc20Interface.decodeFunctionResult("balanceOf", balanceResult.returnData);
            formattedBalance = ethers.formatUnits(decodedBalance[0], asset.decimals);
          } catch (error) {
            console.error(`Error decoding balance for ${user} -> ${asset.address}:`, error);
            formattedBalance = "DECODE_ERROR";
          }
        } else {
          console.error(`Failed to get balance for ${user} -> ${asset.address}`);
          formattedBalance = "CALL_FAILED";
        }
        callIndex++;

        // Process allowance calls for each contract
        for (const contract of contracts) {
          const allowanceResult = multicallResults[callIndex];
          let formattedAllowance = "0";
          if (allowanceResult.success) {
            try {
              const decodedAllowance = erc20Interface.decodeFunctionResult("allowance", allowanceResult.returnData);
              formattedAllowance = ethers.formatUnits(decodedAllowance[0], asset.decimals);
            } catch (error) {
              console.error(`Error decoding allowance for ${user} -> ${asset.address} -> ${contract}:`, error);
              formattedAllowance = "DECODE_ERROR";
            }
          } else {
            console.error(`Failed to get allowance for ${user} -> ${asset.address} -> ${contract}`);
            formattedAllowance = "CALL_FAILED";
          }

          allResults[user][asset.address][contract] = {
            allowance: formattedAllowance,
            balance: formattedBalance,
          };

          callIndex++;
        }
      }
    }

    // Add a small delay between batches to avoid rate limiting
    if (batchIndex < userBatches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return allResults;
}

async function main() {
  const networkConfig = NETWORKS.fraxtal;
  const multicallBatchSize = 20;

  console.log(`Checking allowances for all dLEND users on ${networkConfig.name.toUpperCase()} network\n`);

  try {
    // Get all dLEND users
    console.log("Fetching all dLEND users...");
    const allUsers = await getAllLendingUserAddresses(networkConfig.graphUrl);
    console.log(`Found ${allUsers.length} dLEND users\n`);

    // Set up provider
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

    // Get pool address
    const poolAddressesProvider = new ethers.Contract(networkConfig.poolAddressesProvider, POOL_ADDRESSES_PROVIDER_ABI, provider);
    const poolAddress = await poolAddressesProvider.getPool();
    console.log(`Pool address: ${poolAddress}`);

    // Get target assets
    const targetAssets = await getTargetAssets(provider, poolAddress);
    console.log(`\nFound ${targetAssets.length} target assets:`);
    targetAssets.forEach((asset) => {
      console.log(`  ${asset.symbol}: ${asset.address} (${asset.type}) - decimals: ${asset.decimals}`);
    });

    // Check all user allowances and balances in batches
    console.log(`\nChecking allowances and balances for ${networkConfig.contracts.length} contracts...`);
    const allowanceResults = await checkAllUserAllowancesAndBalances(
      provider,
      networkConfig.multicall3,
      targetAssets,
      allUsers,
      networkConfig.contracts,
      multicallBatchSize,
    );

    // Display results in structured format
    const totalAvailableAmounts: Record<string, number> = {};
    let totalNonZeroAllowances = 0;
    let totalUsersWithAllowances = 0;

    for (const contractAddress of networkConfig.contracts) {
      console.log(`\nContract: ${contractAddress}`);
      let contractNonZeroAllowances = 0;
      let contractHasData = false;

      for (const user of allUsers) {
        let userHasNonZeroAllowance = false;

        for (const asset of targetAssets) {
          const result = allowanceResults[user][asset.address][contractAddress];
          if (result.allowance !== "CALL_FAILED" && result.allowance !== "DECODE_ERROR") {
            const allowanceValue = parseFloat(result.allowance);
            if (allowanceValue > 0) {
              if (!userHasNonZeroAllowance) {
                console.log(`  User: ${user}`);
                userHasNonZeroAllowance = true;
                totalUsersWithAllowances++;
                contractHasData = true;
              }

              const balanceValue = parseFloat(result.balance);
              const availableAmount = Math.min(allowanceValue, balanceValue);

              console.log(`    Token: ${asset.symbol} (${asset.address})`);
              console.log(`      allowance: ${result.allowance}`);
              console.log(`      balance: ${result.balance}`);

              // Track total available amounts
              if (!totalAvailableAmounts[asset.symbol]) {
                totalAvailableAmounts[asset.symbol] = 0;
              }
              totalAvailableAmounts[asset.symbol] += availableAmount;

              contractNonZeroAllowances++;
              totalNonZeroAllowances++;
            }
          }
        }
      }

      if (!contractHasData) {
        console.log(`  No non-zero allowances found`);
      } else {
        console.log(`  Total non-zero allowances: ${contractNonZeroAllowances}`);
      }
    }

    // Display final stats
    console.log(`\n=== TOTAL AVAILABLE AMOUNTS ===`);
    for (const asset of targetAssets) {
      const totalAvailable = totalAvailableAmounts[asset.symbol] || 0;
      console.log(`${asset.symbol}: ${totalAvailable.toFixed(Math.min(6, Number(asset.decimals)))}`);
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total users checked: ${allUsers.length}`);
    console.log(`Users with non-zero allowances: ${totalUsersWithAllowances}`);
    console.log(`Total non-zero allowances: ${totalNonZeroAllowances}`);
  } catch (error) {
    console.error(`Error processing ${networkConfig.name} network:`, error);
  }
}

// Run the script
main().catch(console.error);
