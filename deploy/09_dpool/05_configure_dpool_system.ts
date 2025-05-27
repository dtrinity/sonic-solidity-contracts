import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { log, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    log("No dPool configuration found, skipping dPOOL system configuration");
    return;
  }

  const signer = await ethers.getSigner(deployer);

  // Configure each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    log(`\n--- Configuring dPOOL System for ${dPoolName} ---`);

    // Get all deployed contracts
    const tokenName = `DPoolToken_${dPoolName}`;
    const collateralVaultName = `DPoolCollateralVault_${dPoolName}`;
    const routerName = `DPoolRouter_${dPoolName}`;

    let poolTokenDeployment, collateralVaultDeployment, routerDeployment;

    try {
      poolTokenDeployment = await get(tokenName);
      collateralVaultDeployment = await get(collateralVaultName);
      routerDeployment = await get(routerName);
    } catch (error) {
      console.log(error);
      log(`⚠️  Skipping ${dPoolName}: Missing required deployments`);
      continue;
    }

    // Get contract instances
    const poolToken = await ethers.getContractAt(
      "DPoolToken",
      poolTokenDeployment.address,
      signer,
    );
    const collateralVault = await ethers.getContractAt(
      "DPoolCollateralVault",
      collateralVaultDeployment.address,
      signer,
    );
    const router = await ethers.getContractAt(
      "DPoolRouter",
      routerDeployment.address,
      signer,
    );

    log(`Configuring contracts:`);
    log(`  DPoolToken: ${poolTokenDeployment.address}`);
    log(`  CollateralVault: ${collateralVaultDeployment.address}`);
    log(`  Router: ${routerDeployment.address}`);

    // 1. Set router and collateral vault in DPoolToken
    try {
      const currentRouter = await poolToken.router();

      if (currentRouter === ethers.ZeroAddress) {
        log(`Setting router in DPoolToken...`);
        const tx1 = await poolToken.setRouter(routerDeployment.address);
        await tx1.wait();
        log(`✅ Router set in DPoolToken`);
      } else {
        log(`♻️  Router already set in DPoolToken`);
      }
    } catch (error) {
      log(`⚠️  Failed to set router: ${error}`);
    }

    try {
      const currentCollateralVault = await poolToken.collateralVault();

      if (currentCollateralVault === ethers.ZeroAddress) {
        log(`Setting collateral vault in DPoolToken...`);
        const tx2 = await poolToken.setCollateralVault(
          collateralVaultDeployment.address,
        );
        await tx2.wait();
        log(`✅ Collateral vault set in DPoolToken`);
      } else {
        log(`♻️  Collateral vault already set in DPoolToken`);
      }
    } catch (error) {
      log(`⚠️  Failed to set collateral vault: ${error}`);
    }

    // 2. Set initial withdrawal fee
    try {
      const currentFee = await poolToken.withdrawalFeeBps();

      if (currentFee.toString() === "0") {
        log(
          `Setting initial withdrawal fee to ${dPoolConfig.initialWithdrawalFeeBps} BPS...`,
        );
        const tx3 = await poolToken.setWithdrawalFeeBps(
          dPoolConfig.initialWithdrawalFeeBps,
        );
        await tx3.wait();
        log(`✅ Withdrawal fee set`);
      } else {
        log(`♻️  Withdrawal fee already set: ${currentFee} BPS`);
      }
    } catch (error) {
      log(`⚠️  Failed to set withdrawal fee: ${error}`);
    }

    // 3. Set router in collateral vault
    try {
      const currentRouter = await collateralVault.router();

      if (currentRouter === ethers.ZeroAddress) {
        log(`Setting router in CollateralVault...`);
        const tx4 = await collateralVault.setRouter(routerDeployment.address);
        await tx4.wait();
        log(`✅ Router set in CollateralVault`);
      } else {
        log(`♻️  Router already set in CollateralVault`);
      }
    } catch (error) {
      log(`⚠️  Failed to set router in collateral vault: ${error}`);
    }

    // 4. Configure LP adapters and set default
    let firstLPToken = null;

    for (const poolConfig of dPoolConfig.curvePools) {
      const adapterName = `CurveLPAdapter_${poolConfig.name}`;

      try {
        const adapterDeployment = await get(adapterName);
        const curvePoolDeployment = await get(poolConfig.name);

        log(`Configuring adapter: ${adapterName}`);

        // Add LP adapter to router
        try {
          const existingAdapter = await router.lpAdapters(
            curvePoolDeployment.address,
          );

          if (existingAdapter === ethers.ZeroAddress) {
            log(`Adding LP adapter to router...`);
            const tx5 = await router.addLPAdapter(
              curvePoolDeployment.address,
              adapterDeployment.address,
            );
            await tx5.wait();
            log(`✅ LP adapter added to router`);
          } else {
            log(`♻️  LP adapter already added to router`);
          }
        } catch (error) {
          log(`⚠️  Failed to add LP adapter to router: ${error}`);
        }

        // Add LP adapter to collateral vault
        try {
          const existingAdapter = await collateralVault.adapterForLP(
            curvePoolDeployment.address,
          );

          if (existingAdapter === ethers.ZeroAddress) {
            log(`Adding LP adapter to collateral vault...`);
            const tx6 = await collateralVault.addLPAdapter(
              curvePoolDeployment.address,
              adapterDeployment.address,
            );
            await tx6.wait();
            log(`✅ LP adapter added to collateral vault`);
          } else {
            log(`♻️  LP adapter already added to collateral vault`);
          }
        } catch (error) {
          log(`⚠️  Failed to add LP adapter to collateral vault: ${error}`);
        }

        // Store first LP token for default setting
        if (!firstLPToken) {
          firstLPToken = curvePoolDeployment.address;
        }
      } catch (error) {
        console.log(error);
        log(
          `⚠️  Skipping adapter configuration for ${poolConfig.name}: deployment not found`,
        );
      }
    }

    // 5. Set default deposit LP
    if (firstLPToken) {
      try {
        const currentDefault = await router.defaultDepositLP();

        if (currentDefault === ethers.ZeroAddress) {
          log(`Setting default deposit LP token: ${firstLPToken}...`);
          const tx7 = await router.setDefaultDepositLP(firstLPToken);
          await tx7.wait();
          log(`✅ Default deposit LP set`);
        } else {
          log(`♻️  Default deposit LP already set: ${currentDefault}`);
        }
      } catch (error) {
        log(`⚠️  Failed to set default deposit LP: ${error}`);
      }
    }

    // 6. Set initial max slippage
    try {
      const currentSlippage = await router.maxSlippageBps();

      if (
        currentSlippage.toString() !== dPoolConfig.initialSlippageBps.toString()
      ) {
        log(`Setting max slippage to ${dPoolConfig.initialSlippageBps} BPS...`);
        const tx8 = await router.setMaxSlippageBps(
          dPoolConfig.initialSlippageBps,
        );
        await tx8.wait();
        log(`✅ Max slippage set`);
      } else {
        log(`♻️  Max slippage already set: ${currentSlippage} BPS`);
      }
    } catch (error) {
      log(`⚠️  Failed to set max slippage: ${error}`);
    }

    // 7. Grant DPOOL_TOKEN_ROLE to DPoolToken in router
    try {
      const DPOOL_TOKEN_ROLE = await router.DPOOL_TOKEN_ROLE();
      const hasRole = await router.hasRole(
        DPOOL_TOKEN_ROLE,
        poolTokenDeployment.address,
      );

      if (!hasRole) {
        log(`Granting DPOOL_TOKEN_ROLE to DPoolToken in router...`);
        const tx9 = await router.grantRole(
          DPOOL_TOKEN_ROLE,
          poolTokenDeployment.address,
        );
        await tx9.wait();
        log(`✅ DPOOL_TOKEN_ROLE granted`);
      } else {
        log(`♻️  DPOOL_TOKEN_ROLE already granted`);
      }
    } catch (error) {
      log(`⚠️  Failed to grant DPOOL_TOKEN_ROLE: ${error}`);
    }

    log(`🎉 Configuration complete for ${dPoolName}!`);
  }
};

func.tags = ["dpool", "dpool-configure"];
func.dependencies = ["dpool-token", "dpool-collateral-vault", "dpool-router", "dpool-adapters"];
func.runAtTheEnd = true; // Ensure this runs after all other deployments

export default func;
