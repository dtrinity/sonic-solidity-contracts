import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import { getConfig } from "../../config/config";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { get } = deployments;
  const { deployer } = await getNamedAccounts();

  const config = await getConfig(hre);

  // Skip if no dPool config
  if (!config.dPool) {
    console.log("No dPool configuration found, skipping dPOOL system configuration");
    return;
  }

  // Configure each dPool instance
  for (const [dPoolName, dPoolConfig] of Object.entries(config.dPool)) {
    console.log(`\n--- Configuring dPOOL System for ${dPoolName} ---`);

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
      console.log(`⚠️  Failed to get deployments for ${dPoolName}: ${error}`);
      console.log(`⚠️  Skipping ${dPoolName}: Missing required deployments`);
      continue;
    }

    // Get signers for admin and fee manager
    const initialAdmin = dPoolConfig.initialAdmin;
    const initialFeeManager = dPoolConfig.initialFeeManager;

    const adminSigner = initialAdmin === deployer ? deployer : initialAdmin;
    const feeManagerSigner = initialFeeManager === deployer ? deployer : initialFeeManager;

    // Get contract instances (use deployer for read calls initially)
    const poolToken = await ethers.getContractAt(
      "DPoolToken",
      poolTokenDeployment.address,
      await ethers.getSigner(deployer),
    );
    const collateralVault = await ethers.getContractAt(
      "DPoolCollateralVault",
      collateralVaultDeployment.address,
      await ethers.getSigner(deployer),
    );
    const router = await ethers.getContractAt(
      "DPoolRouter",
      routerDeployment.address,
      await ethers.getSigner(deployer),
    );

    console.log(`Configuring contracts:`);
    console.log(`  DPoolToken: ${poolTokenDeployment.address}`);
    console.log(`  CollateralVault: ${collateralVaultDeployment.address}`);
    console.log(`  Router: ${routerDeployment.address}`);

    // 1. Set router and collateral vault in DPoolToken
    try {
      const currentRouter = await poolToken.router();

      if (currentRouter === ethers.ZeroAddress) {
        console.log(`Setting router in DPoolToken...`);
        const tx1 = await poolToken
          .connect(await ethers.getSigner(adminSigner))
          .setRouter(routerDeployment.address);
        await tx1.wait();
        console.log(`✅ Router set in DPoolToken`);
      } else {
        console.log(`♻️  Router already set in DPoolToken`);
      }
    } catch (error) {
      console.log(`⚠️  Failed to set router: ${error}`);
      return false;
    }

    try {
      const currentCollateralVault = await poolToken.collateralVault();

      if (currentCollateralVault === ethers.ZeroAddress) {
        console.log(`Setting collateral vault in DPoolToken...`);
        const tx2 = await poolToken
          .connect(await ethers.getSigner(adminSigner))
          .setCollateralVault(collateralVaultDeployment.address);
        await tx2.wait();
        console.log(`✅ Collateral vault set in DPoolToken`);
      } else {
        console.log(`♻️  Collateral vault already set in DPoolToken`);
      }
    } catch (error) {
      console.log(`⚠️  Failed to set collateral vault: ${error}`);
      return false;
    }

    // 2. Set initial withdrawal fee
    try {
      const currentFee = await poolToken.withdrawalFeeBps();

      if (currentFee.toString() === "0") {
        console.log(
          `Setting initial withdrawal fee to ${dPoolConfig.initialWithdrawalFeeBps} BPS...`,
        );
        const tx3 = await poolToken
          .connect(await ethers.getSigner(feeManagerSigner))
          .setWithdrawalFeeBps(dPoolConfig.initialWithdrawalFeeBps);
        await tx3.wait();
        console.log(`✅ Withdrawal fee set`);
      } else {
        console.log(`♻️  Withdrawal fee already set: ${currentFee} BPS`);
      }
    } catch (error) {
      console.log(`⚠️  Failed to set withdrawal fee: ${error}`);
      return false;
    }

    // 3. Set router in collateral vault
    try {
      const currentRouter = await collateralVault.router();

      if (currentRouter === ethers.ZeroAddress) {
        console.log(`Setting router in CollateralVault...`);
        const tx4 = await collateralVault
          .connect(await ethers.getSigner(deployer))
          .setRouter(routerDeployment.address);
        await tx4.wait();
        console.log(`✅ Router set in CollateralVault`);
      } else {
        console.log(`♻️  Router already set in CollateralVault`);
      }
    } catch (error) {
      console.log(`⚠️  Failed to set router in collateral vault: ${error}`);
      return false;
    }

    // 4. Configure LP adapters and set default
    let firstLPToken = null;

    for (const poolConfig of dPoolConfig.curvePools) {
      const adapterName = `CurveLPAdapter_${poolConfig.name}`;

      try {
        const adapterDeployment = await get(adapterName);
        const curvePoolDeployment = await get(poolConfig.name);

        console.log(`Configuring adapter: ${adapterName}`);

        // Add LP adapter to router
        try {
          const existingAdapter = await router.lpAdapters(
            curvePoolDeployment.address,
          );

          if (existingAdapter === ethers.ZeroAddress) {
            console.log(`Adding LP adapter to router...`);
            const tx5 = await router
              .connect(await ethers.getSigner(deployer))
              .addLPAdapter(
                curvePoolDeployment.address,
                adapterDeployment.address,
              );
            await tx5.wait();
            console.log(`✅ LP adapter added to router`);
          } else {
            console.log(`♻️  LP adapter already added to router`);
          }
        } catch (error) {
          console.log(`⚠️  Failed to add LP adapter to router: ${error}`);
          return false;
        }

        // Add LP adapter to collateral vault
        try {
          const existingAdapter = await collateralVault.adapterForLP(
            curvePoolDeployment.address,
          );

          if (existingAdapter === ethers.ZeroAddress) {
            console.log(`Adding LP adapter to collateral vault...`);
            const tx6 = await collateralVault
              .connect(await ethers.getSigner(deployer))
              .addLPAdapter(
                curvePoolDeployment.address,
                adapterDeployment.address,
              );
            await tx6.wait();
            console.log(`✅ LP adapter added to collateral vault`);
          } else {
            console.log(`♻️  LP adapter already added to collateral vault`);
          }
        } catch (error) {
          console.log(`⚠️  Failed to add LP adapter to collateral vault: ${error}`);
          return false;
        }

        // Store first LP token for default setting
        if (!firstLPToken) {
          firstLPToken = curvePoolDeployment.address;
        }
      } catch (error) {
        console.log(`⚠️  Failed to configure adapter for ${poolConfig.name}: ${error}`);
        console.log(
          `⚠️  Skipping adapter configuration for ${poolConfig.name}: deployment not found`,
        );
        return false;
      }
    }

    // 5. Set default deposit LP
    if (firstLPToken) {
      try {
        const currentDefault = await router.defaultDepositLP();

        if (currentDefault === ethers.ZeroAddress) {
          console.log(`Setting default deposit LP token: ${firstLPToken}...`);
          const tx7 = await router
            .connect(await ethers.getSigner(deployer))
            .setDefaultDepositLP(firstLPToken);
          await tx7.wait();
          console.log(`✅ Default deposit LP set`);
        } else {
          console.log(`♻️  Default deposit LP already set: ${currentDefault}`);
        }
      } catch (error) {
        console.log(`⚠️  Failed to set default deposit LP: ${error}`);
        return false;
      }
    }

    // 6. Set initial max slippage
    try {
      const currentSlippage = await router.maxSlippageBps();

      if (
        currentSlippage.toString() !== dPoolConfig.initialSlippageBps.toString()
      ) {
        console.log(`Setting max slippage to ${dPoolConfig.initialSlippageBps} BPS...`);
        const tx8 = await router
          .connect(await ethers.getSigner(deployer))
          .setMaxSlippageBps(dPoolConfig.initialSlippageBps);
        await tx8.wait();
        console.log(`✅ Max slippage set`);
      } else {
        console.log(`♻️  Max slippage already set: ${currentSlippage} BPS`);
      }
    } catch (error) {
      console.log(`⚠️  Failed to set max slippage: ${error}`);
      return false;
    }

    // 7. Grant DPOOL_TOKEN_ROLE to DPoolToken in router
    try {
      const DPOOL_TOKEN_ROLE = await router.DPOOL_TOKEN_ROLE();
      const hasRole = await router.hasRole(
        DPOOL_TOKEN_ROLE,
        poolTokenDeployment.address,
      );

      if (!hasRole) {
        console.log(`Granting DPOOL_TOKEN_ROLE to DPoolToken in router...`);
        const tx9 = await router
          .connect(await ethers.getSigner(deployer))
          .grantRole(
            DPOOL_TOKEN_ROLE,
            poolTokenDeployment.address,
          );
        await tx9.wait();
        console.log(`✅ DPOOL_TOKEN_ROLE granted`);
      } else {
        console.log(`♻️  DPOOL_TOKEN_ROLE already granted`);
      }
    } catch (error) {
      console.log(`⚠️  Failed to grant DPOOL_TOKEN_ROLE: ${error}`);
      return false;
    }

    console.log(`🎉 Configuration complete for ${dPoolName}!`);
  }

  console.log(`🦉 ${__filename.split("/").slice(-2).join("/")}: ✅`);
};

func.tags = ["dpool", "dpool-configure"];
func.dependencies = ["dpool-token", "dpool-collateral-vault", "dpool-router", "dpool-adapters"];
func.runAtTheEnd = true; // Ensure this runs after all other deployments

export default func;
