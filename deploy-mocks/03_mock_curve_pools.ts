import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    log("No dPool configuration found, skipping mock Curve pool deployment");
    return;
  }

  // Deploy mock Curve pools for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    log(`\n--- Deploying Mock Curve Pools for ${dPoolName} ---`);

    for (const poolConfig of dPoolConfig.curvePools) {
      const poolName = poolConfig.name;
      
      // Get token addresses from config
      const token0Address = config.MOCK_ONLY?.tokens[poolConfig.token0]?.address ||
                           config.tokenAddresses[poolConfig.token0 as keyof typeof config.tokenAddresses];
      const token1Address = config.MOCK_ONLY?.tokens[poolConfig.token1]?.address ||
                           config.tokenAddresses[poolConfig.token1 as keyof typeof config.tokenAddresses];

      if (!token0Address || !token1Address) {
        log(`⚠️  Skipping ${poolName}: missing token addresses for ${poolConfig.token0} or ${poolConfig.token1}`);
        continue;
      }

      log(`Deploying MockCurveStableSwapNG: ${poolName}`);
      log(`  Token 0 (${poolConfig.token0}): ${token0Address}`);
      log(`  Token 1 (${poolConfig.token1}): ${token1Address}`);

      const curvePool = await deploy(poolName, {
        contract: "MockCurveStableSwapNG",
        from: deployer,
        args: [
          `${poolConfig.token0}/${poolConfig.token1} LP`, // name
          `${poolConfig.token0}${poolConfig.token1}LP`, // symbol
          [token0Address, token1Address], // coins array
          4000000, // fee: 0.04% (4000000 / 10**10)
        ],
        log: true,
        skipIfAlreadyDeployed: true,
      });

      if (curvePool.newlyDeployed) {
        log(`✅ Deployed ${poolName} at: ${curvePool.address}`);
      } else {
        log(`♻️  Reusing existing ${poolName} at: ${curvePool.address}`);
      }
    }
  }
};

func.tags = ["dpool", "dpool-curve-pools", "mocks"];
func.dependencies = ["tokens"]; // Ensure tokens are deployed first

export default func; 