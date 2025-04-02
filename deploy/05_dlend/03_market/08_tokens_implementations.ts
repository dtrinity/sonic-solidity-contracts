import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  ATOKEN_IMPL_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const { address: addressesProviderAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID,
  );

  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderAddress,
  );

  const poolAddress = await addressesProviderContract.getPool();

  // Deploy AToken implementation
  const aTokenDeployment = await hre.deployments.deploy(ATOKEN_IMPL_ID, {
    contract: "AToken",
    from: deployer,
    args: [poolAddress],
    log: true,
  });

  const aTokenContract = await hre.ethers.getContractAt(
    "AToken",
    aTokenDeployment.address,
  );

  try {
    const initATokenResponse = await aTokenContract.initialize(
      poolAddress, // initializingPool
      ZeroAddress, // treasury
      ZeroAddress, // underlyingAsset
      ZeroAddress, // incentivesController
      0, // aTokenDecimals
      "ATOKEN_IMPL", // aTokenName
      "ATOKEN_IMPL", // aTokenSymbol
      "0x00", // params
    );
    const initATokenReceipt = await initATokenResponse.wait();
    console.log(`  - TxHash  : ${initATokenReceipt?.hash}`);
    console.log(`  - From    : ${initATokenReceipt?.from}`);
    console.log(`  - GasUsed : ${initATokenReceipt?.gasUsed.toString()}`);
  } catch (error: any) {
    // Contract instance has already been initialized
    if (
      error?.message.includes("Contract instance has already been initialized")
    ) {
      console.log(`  - Already initialized`);
    } else {
      throw Error(`Failed to initialize AToken implementation: ${error}`);
    }
  }

  // Deploy StableDebtToken implementation
  const stableDebtTokenDeployment = await hre.deployments.deploy(
    STABLE_DEBT_TOKEN_IMPL_ID,
    {
      contract: "StableDebtToken",
      from: deployer,
      args: [poolAddress],
      log: true,
    },
  );

  const stableDebtTokenContract = await hre.ethers.getContractAt(
    "StableDebtToken",
    stableDebtTokenDeployment.address,
  );

  try {
    const _initStableDebtTokenResponse =
      await stableDebtTokenContract.initialize(
        poolAddress, // initializingPool
        ZeroAddress, // underlyingAsset
        ZeroAddress, // incentivesController
        0, // debtTokenDecimals
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00", // params
      );
  } catch (error: any) {
    // Contract instance has already been initialized
    if (
      error?.message.includes("Contract instance has already been initialized")
    ) {
      console.log(`  - Already initialized`);
    } else {
      throw Error(
        `Failed to initialize StableDebtToken implementation: ${error}`,
      );
    }
  }

  // Deploy VariableDebtToken implementation
  const variableDebtTokenDeployment = await hre.deployments.deploy(
    VARIABLE_DEBT_TOKEN_IMPL_ID,
    {
      contract: "VariableDebtToken",
      from: deployer,
      args: [poolAddress],
      log: true,
    },
  );

  const variableDebtTokenContract = await hre.ethers.getContractAt(
    "VariableDebtToken",
    variableDebtTokenDeployment.address,
  );

  try {
    const _initVariableDebtTokenResponse =
      await variableDebtTokenContract.initialize(
        poolAddress, // initializingPool
        ZeroAddress, // underlyingAsset
        ZeroAddress, // incentivesController
        0, // debtTokenDecimals
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00", // params
      );
  } catch (error: any) {
    // Contract instance has already been initialized
    if (
      error?.message.includes("Contract instance has already been initialized")
    ) {
      console.log(`  - Already initialized`);
    } else {
      throw Error(
        `Failed to initialize VariableDebtToken implementation: ${error}`,
      );
    }
  }

  console.log(`🏦 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = "dLend:tokens_implementations";
func.tags = ["dlend", "dlend-market"];
func.dependencies = [
  "dlend-core",
  "dlend-periphery-pre",
  "PoolAddressesProvider",
  "init_pool",
];

export default func;
