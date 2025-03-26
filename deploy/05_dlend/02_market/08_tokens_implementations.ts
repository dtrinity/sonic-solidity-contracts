import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ZeroAddress } from "ethers";
import {
  POOL_ADDRESSES_PROVIDER_ID,
  ATOKEN_IMPL_ID,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
  STABLE_DEBT_TOKEN_IMPL_ID,
} from "../../../typescript/deploy-ids";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { lendingDeployer } = await hre.getNamedAccounts();
  const deployer = await hre.ethers.getSigner(lendingDeployer);

  const { address: addressesProviderAddress } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  const addressesProviderContract = await hre.ethers.getContractAt(
    "PoolAddressesProvider",
    addressesProviderAddress
  );

  const poolAddress = await addressesProviderContract.getPool();

  // Deploy AToken implementation
  const aTokenDeployment = await hre.deployments.deploy(ATOKEN_IMPL_ID, {
    contract: "AToken",
    from: deployer.address,
    args: [poolAddress],
    log: true,
  });

  const aTokenContract = await hre.ethers.getContractAt(
    "AToken",
    aTokenDeployment.address
  );

  console.log(`------------------------`);
  console.log(`Initialize AToken implementation`);
  console.log(`  - AToken implementation: ${aTokenDeployment.address}`);
  console.log(`  - Pool Address         : ${poolAddress}`);

  try {
    const initATokenResponse = await aTokenContract.initialize(
      poolAddress, // initializingPool
      ZeroAddress, // treasury
      ZeroAddress, // underlyingAsset
      ZeroAddress, // incentivesController
      0, // aTokenDecimals
      "ATOKEN_IMPL", // aTokenName
      "ATOKEN_IMPL", // aTokenSymbol
      "0x00" // params
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
  console.log(`------------------------`);

  // Deploy StableDebtToken implementation
  const stableDebtTokenDeployment = await hre.deployments.deploy(
    STABLE_DEBT_TOKEN_IMPL_ID,
    {
      contract: "StableDebtToken",
      from: deployer.address,
      args: [poolAddress],
      log: true,
    }
  );

  const stableDebtTokenContract = await hre.ethers.getContractAt(
    "StableDebtToken",
    stableDebtTokenDeployment.address
  );

  console.log(`------------------------`);
  console.log(`Initialize StableDebtToken implementation`);
  console.log(
    `  - StableDebtToken implementation: ${stableDebtTokenDeployment.address}`
  );
  console.log(`  - Pool Address                  : ${poolAddress}`);

  try {
    const initStableDebtTokenResponse =
      await stableDebtTokenContract.initialize(
        poolAddress, // initializingPool
        ZeroAddress, // underlyingAsset
        ZeroAddress, // incentivesController
        0, // debtTokenDecimals
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00" // params
      );
    const initStableDebtTokenReceipt = await initStableDebtTokenResponse.wait();
    console.log(`  - TxHash  : ${initStableDebtTokenReceipt?.hash}`);
    console.log(`  - From    : ${initStableDebtTokenReceipt?.from}`);
    console.log(
      `  - GasUsed : ${initStableDebtTokenReceipt?.gasUsed.toString()}`
    );
  } catch (error: any) {
    // Contract instance has already been initialized
    if (
      error?.message.includes("Contract instance has already been initialized")
    ) {
      console.log(`  - Already initialized`);
    } else {
      throw Error(
        `Failed to initialize StableDebtToken implementation: ${error}`
      );
    }
  }
  console.log(`------------------------`);

  // Deploy VariableDebtToken implementation
  const variableDebtTokenDeployment = await hre.deployments.deploy(
    VARIABLE_DEBT_TOKEN_IMPL_ID,
    {
      contract: "VariableDebtToken",
      from: deployer.address,
      args: [poolAddress],
      log: true,
    }
  );

  const variableDebtTokenContract = await hre.ethers.getContractAt(
    "VariableDebtToken",
    variableDebtTokenDeployment.address
  );

  console.log(`------------------------`);
  console.log(`Initialize VariableDebtToken implementation`);
  console.log(
    `  - VariableDebtToken implementation: ${variableDebtTokenDeployment.address}`
  );
  console.log(`  - Pool Address                    : ${poolAddress}`);

  try {
    const initVariableDebtTokenResponse =
      await variableDebtTokenContract.initialize(
        poolAddress, // initializingPool
        ZeroAddress, // underlyingAsset
        ZeroAddress, // incentivesController
        0, // debtTokenDecimals
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00" // params
      );
    const initVariableDebtTokenReceipt =
      await initVariableDebtTokenResponse.wait();
    console.log(`  - TxHash  : ${initVariableDebtTokenReceipt?.hash}`);
    console.log(`  - From    : ${initVariableDebtTokenReceipt?.from}`);
    console.log(
      `  - GasUsed : ${initVariableDebtTokenReceipt?.gasUsed.toString()}`
    );
  } catch (error: any) {
    // Contract instance has already been initialized
    if (
      error?.message.includes("Contract instance has already been initialized")
    ) {
      console.log(`  - Already initialized`);
    } else {
      throw Error(
        `Failed to initialize VariableDebtToken implementation: ${error}`
      );
    }
  }
  console.log(`------------------------`);

  return true;
};

func.id = "tokens_implementations";
func.tags = ["market", "tokens"];
func.dependencies = ["addresses-provider", "pool"];

export default func;
