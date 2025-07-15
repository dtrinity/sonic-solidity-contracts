import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";
import { FLASH_MINT_DSTABLE_LIQUIDATOR_PT_ODOS_ID } from "../../config/deploy-ids";
import { assertNotEmpty } from "../../typescript/common/assert";
import { getPoolAddressesProviderAddressFromParent } from "../../typescript/dlend_helpers/pool";
import { getFlashMintPTContractDeploymentName } from "../../typescript/odos_bot/pendle/bot_contract";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const config = await getConfig(hre);

  if (!config.liquidatorBotOdos) {
    throw new Error("Liquidator bot Odos config is not found");
  }

  const routerAddress = config.liquidatorBotOdos.odosRouter;

  if (!routerAddress) {
    throw new Error("Odos router address is not found");
  }

  // Get the PoolAddressesProvider address from the parent deployment
  const lendingPoolAddressesProviderAddress =
    await getPoolAddressesProviderAddressFromParent(hre);

  // Initialize the PoolAddressesProvider contract
  const addressProviderContract = await hre.ethers.getContractAt(
    [
      "function getPool() public view returns (address)",
      "function getPoolDataProvider() public view returns (address)",
    ],
    lendingPoolAddressesProviderAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Get the Pool address from the provider
  const poolAddress = await addressProviderContract.getPool();

  // Get the Pool Data Provider
  const poolDataProviderAddress =
    await addressProviderContract.getPoolDataProvider();
  const poolDataProviderContract = await hre.ethers.getContractAt(
    [
      "function getReserveTokensAddresses(address) public view returns (address, address, address)",
    ],
    poolDataProviderAddress,
    await hre.ethers.getSigner(deployer),
  );

  // Deploy a PT liquidator bot for each flash minter
  for (const [symbol, flashMinterAddress] of Object.entries(
    config.liquidatorBotOdos.flashMinters,
  )) {
    // Get the AToken of the flash minter (quote token)
    // All returns: { aTokenAddress, variableDebtTokenAddress, stableDebtTokenAddress }
    const [aTokenAddress, _variableDebtTokenAddress, _stableDebtTokenAddress] =
      await poolDataProviderContract.getReserveTokensAddresses(
        flashMinterAddress,
      );
    const deploymentId = getFlashMintPTContractDeploymentName(symbol);

    // Deploy the flash mint PT liquidator bot
    console.log(`Deploying flash mint PT liquidator bot for ${symbol}`);
    await hre.deployments.deploy(deploymentId, {
      from: deployer,
      args: [
        assertNotEmpty(flashMinterAddress),
        assertNotEmpty(lendingPoolAddressesProviderAddress),
        assertNotEmpty(poolAddress),
        assertNotEmpty(aTokenAddress),
        BigInt(config.liquidatorBotOdos.slippageTolerance),
        assertNotEmpty(routerAddress),
      ],
      libraries: undefined,
      contract: "FlashMintLiquidatorAaveBorrowRepayPTOdos",
      autoMine: true,
      log: false,
    });

    // Configure the deployed contract
    console.log(`Configuring deployed PT contract for ${symbol}`);
    const flashMintPTLiquidatorBotDeployedResult =
      await hre.deployments.get(deploymentId);
    const flashMintPTLiquidatorBotContract = await hre.ethers.getContractAt(
      "FlashMintLiquidatorAaveBorrowRepayPTOdos",
      flashMintPTLiquidatorBotDeployedResult.address,
      await hre.ethers.getSigner(deployer),
    );

    // Set proxy contracts if they exist in config
    if (config.tokenProxyContractMap) {
      for (const [token, proxyContract] of Object.entries(
        config.tokenProxyContractMap,
      )) {
        await flashMintPTLiquidatorBotContract.setProxyContract(
          token,
          proxyContract,
        );
      }
    }

    console.log(
      `🤖 Deployed Flash Mint PT Liquidator Bot for ${symbol} at ${flashMintPTLiquidatorBotDeployedResult.address}`,
    );
  }

  // Return true to indicate the success of the script
  return true;
};

func.tags = ["pt-liquidator-bot"];
func.dependencies = [];
func.id = FLASH_MINT_DSTABLE_LIQUIDATOR_PT_ODOS_ID;

export default func; 