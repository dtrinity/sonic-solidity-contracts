import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no mock config or curve pools config
  if (!config.MOCK_ONLY?.curvePools) {
    console.log(
      "No mock curve pools configuration found, skipping mock Curve pool deployment",
    );
    return true;
  }

  console.log(`\n--- Deploying Mock Curve Pools ---`);

  // Deploy mock Curve pools from mock configuration
  for (const [poolId, poolConfig] of Object.entries(
    config.MOCK_ONLY.curvePools,
  )) {
    console.log(`\nDeploying pool: ${poolId}`);

    // Get token addresses from config
    const token0Address =
      config.tokenAddresses[
        poolConfig.token0 as keyof typeof config.tokenAddresses
      ];
    const token1Address =
      config.tokenAddresses[
        poolConfig.token1 as keyof typeof config.tokenAddresses
      ];

    if (!token0Address || !token1Address) {
      console.log(
        `⚠️  Skipping ${poolId}: missing token addresses for ${poolConfig.token0} or ${poolConfig.token1}`,
      );
      continue;
    }

    console.log(`  Pool Name: ${poolConfig.name}`);
    console.log(`  Token 0 (${poolConfig.token0}): ${token0Address}`);
    console.log(`  Token 1 (${poolConfig.token1}): ${token1Address}`);
    console.log(`  Fee: ${poolConfig.fee}`);

    const curvePool = await deploy(poolId, {
      contract: "MockCurveStableSwapNG",
      from: deployer,
      args: [
        `${poolConfig.token0}/${poolConfig.token1} LP`, // name
        `${poolConfig.token0}${poolConfig.token1}LP`, // symbol
        [token0Address, token1Address], // coins array
        poolConfig.fee, // fee
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    if (curvePool.newlyDeployed) {
      console.log(`✅ Deployed ${poolId} at: ${curvePool.address}`);
    } else {
      console.log(`♻️  Reusing existing ${poolId} at: ${curvePool.address}`);
    }
  }

  console.log(`🎱 ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

func.tags = ["local-setup", "curve"];
func.dependencies = ["tokens"];
func.id = "local_curve_pools_setup";

export default func;
