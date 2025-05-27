import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log("No dPool configuration found, skipping mock Curve pool deployment");
    return true;
  }

  // Deploy mock Curve pools for each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Deploying Mock Curve Pools for ${dPoolName} ---`);

    for (const poolConfig of dPoolConfig.curvePools) {
      const poolName = poolConfig.name;
      // Get token addresses from config
      const token0Address = config.tokenAddresses[poolConfig.token0 as keyof typeof config.tokenAddresses];
      const token1Address = config.tokenAddresses[poolConfig.token1 as keyof typeof config.tokenAddresses];

      if (!token0Address || !token1Address) {
        console.log(`⚠️  Skipping ${poolName}: missing token addresses for ${poolConfig.token0} or ${poolConfig.token1}`);
        continue;
      }

      console.log(`Deploying MockCurveStableSwapNG: ${poolName}`);
      console.log(`  Token 0 (${poolConfig.token0}): ${token0Address}`);
      console.log(`  Token 1 (${poolConfig.token1}): ${token1Address}`);

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
        console.log(`✅ Deployed ${poolName} at: ${curvePool.address}`);
      } else {
        console.log(`♻️  Reusing existing ${poolName} at: ${curvePool.address}`);
      }
    }
  }

  console.log(`🎱 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "curve"];
func.dependencies = ["tokens"];
func.id = "local_curve_pools_setup";

export default func; 