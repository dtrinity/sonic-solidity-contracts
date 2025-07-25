import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import {
  DLEND_STATIC_A_TOKEN_FACTORY_ID,
  POOL_PROXY_ID,
} from "../../typescript/deploy-ids";
import { chunk } from "../../typescript/dlend/helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deployments, ethers } = hre;
  const signer = await ethers.getSigner(deployer);

  // Get deployed Pool proxy address
  const { address: poolAddress } = await deployments.get(POOL_PROXY_ID);

  // Deploy StaticATokenFactory
  const staticATokenFactoryDeployment = await deployments.deploy(
    DLEND_STATIC_A_TOKEN_FACTORY_ID,
    {
      from: deployer,
      args: [poolAddress], // pool address only
      contract: "StaticATokenFactory",
      autoMine: true,
    },
  );

  if (staticATokenFactoryDeployment.newlyDeployed) {
    // Get contract instances
    const staticATokenFactory = await ethers.getContractAt(
      "StaticATokenFactory",
      staticATokenFactoryDeployment.address,
    );
    const pool = await ethers.getContractAt(
      "contracts/dlend/core/interfaces/IPool.sol:IPool",
      poolAddress,
    );

    // Get reserves list from the Pool
    const reservesList = await pool.getReservesList();

    if (reservesList.length > 0) {
      // Process reserves in chunks
      const chunkSize = 3;
      const chunkedReserves = chunk(reservesList, chunkSize);

      for (
        let chunkIndex = 0;
        chunkIndex < chunkedReserves.length;
        chunkIndex++
      ) {
        const reservesChunk = chunkedReserves[chunkIndex];

        try {
          // @ts-ignore – the autogenerated typings might not include the function, so we bypass type checking here.
          const callData = (
            staticATokenFactory.interface as any
          ).encodeFunctionData("createStaticATokens", [reservesChunk]);
          // Send a raw transaction
          const tx = await signer.sendTransaction({
            to: staticATokenFactoryDeployment.address,
            data: callData,
          });
          await tx.wait();
        } catch (error: any) {
          console.error(
            `  Failed to create StaticATokens for chunk ${chunkIndex + 1}: ${error.message || String(error)}`,
          );
          // Re-throw to ensure the deployment script fails rather than silently succeeding.
          throw error;
        }
      }
    } else {
      console.log(
        "No reserves found in the Pool, skipping createStaticATokens",
      );
    }
  }

  console.log(`🧧 ${__filename.split("/").slice(-2).join("/")}: ✅`);

  return true;
};

func.id = DLEND_STATIC_A_TOKEN_FACTORY_ID;
func.tags = ["dlend-static-wrapper-factory"];
func.dependencies = [POOL_PROXY_ID, "dlend-pool-init"];

export default func;
