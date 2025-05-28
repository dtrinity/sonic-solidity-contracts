import { deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { BigNumberish } from "ethers";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../typescript/token/utils";
import { ERC20 } from "../../typechain-types";


export interface DPoolFixtureConfig {
  dPoolName: "dpUSDC" | "dpfrxUSD";
  baseAssetSymbol: string;
  poolTokenSymbol: string;
  curvePoolTokens: [string, string];
  curvePoolName: string;
  deploymentTags: string[];
}

export const DPUSDC_CONFIG: DPoolFixtureConfig = {
  dPoolName: "dpUSDC",
  baseAssetSymbol: "USDC",
  poolTokenSymbol: "USDC-USDS_Curve",
  curvePoolTokens: ["USDC", "USDS"],
  curvePoolName: "USDC_USDS_CurvePool",
  deploymentTags: [
    "local-setup", // mock tokens and oracles
    "oracle", // mock oracle setup uses this tag
    "curve", // mock curve pools
    "dpool", // dPOOL core contracts and configuration
  ],
};

export const DPfrxUSD_CONFIG: DPoolFixtureConfig = {
  dPoolName: "dpfrxUSD",
  baseAssetSymbol: "frxUSD",
  poolTokenSymbol: "frxUSD-USDC_Curve",
  curvePoolTokens: ["frxUSD", "USDC"],
  curvePoolName: "frxUSD_USDC_CurvePool",
  deploymentTags: [
    "local-setup",
    "oracle", // needed for frxUSD
    "curve",
    "dpool",
  ],
};

// Array of all DPool configurations
export const DPOOL_CONFIGS: DPoolFixtureConfig[] = [DPUSDC_CONFIG, DPfrxUSD_CONFIG];

export interface DPoolFixtureResult {
  config: DPoolFixtureConfig;
  poolToken: any; // DPoolToken contract
  collateralVault: any; // DPoolCollateralVault contract
  router: any; // DPoolRouter contract
  curvePool: any; // MockCurveStableSwapNG contract
  curveLPAdapter: any; // CurveLPAdapter contract
  baseAssetToken: ERC20;
  baseAssetInfo: TokenInfo;
  otherAssetToken: ERC20;
  otherAssetInfo: TokenInfo;
  deployer: any; // Signer
  user1: any; // Signer
  user2: any; // Signer
}

// Core logic for fetching dPOOL components after deployments are done
async function fetchDPoolComponents(
  hreElements: {
    deployments: HardhatRuntimeEnvironment["deployments"];
    getNamedAccounts: HardhatRuntimeEnvironment["getNamedAccounts"];
    ethers: HardhatRuntimeEnvironment["ethers"];
    globalHre: HardhatRuntimeEnvironment;
  },
  config: DPoolFixtureConfig
): Promise<DPoolFixtureResult> {
  const { deployments, getNamedAccounts, ethers, globalHre } = hreElements;
  const { deployer, user1, user2 } = await getNamedAccounts();
  const deployerSigner = await ethers.getSigner(deployer);
  const user1Signer = await ethers.getSigner(user1);
  const user2Signer = await ethers.getSigner(user2);

  // Get base asset token
  const { contract: baseAssetToken, tokenInfo: baseAssetInfo } =
    await getTokenContractForSymbol(globalHre, deployer, config.baseAssetSymbol);

  // Get other asset token
  const otherAssetSymbol = config.curvePoolTokens.find(
    (token) => token !== config.baseAssetSymbol
  )!;
  const { contract: otherAssetToken, tokenInfo: otherAssetInfo } =
    await getTokenContractForSymbol(globalHre, deployer, otherAssetSymbol);

  // Get dPOOL contracts
  const poolTokenDeployment = await deployments.get(
    `DPoolToken_${config.dPoolName}`
  );
  const poolToken = await ethers.getContractAt(
    "DPoolToken",
    poolTokenDeployment.address
  );

  const collateralVaultDeployment = await deployments.get(
    `DPoolCollateralVault_${config.dPoolName}`
  );
  const collateralVault = await ethers.getContractAt(
    "DPoolCollateralVault",
    collateralVaultDeployment.address
  );

  const routerDeployment = await deployments.get(
    `DPoolRouter_${config.dPoolName}`
  );
  const router = await ethers.getContractAt(
    "DPoolRouter",
    routerDeployment.address
  );

  // Get Curve pool
  const curvePoolDeployment = await deployments.get(config.curvePoolName);
  const curvePool = await ethers.getContractAt(
    "MockCurveStableSwapNG",
    curvePoolDeployment.address
  );

  // Get CurveLPAdapter
  const adapterDeployment = await deployments.get(
    `CurveLPAdapter_${config.curvePoolName}`
  );
  const curveLPAdapter = await ethers.getContractAt(
    "CurveLPAdapter",
    adapterDeployment.address
  );

  return {
    config,
    poolToken,
    collateralVault,
    router,
    curvePool,
    curveLPAdapter,
    baseAssetToken: baseAssetToken as unknown as ERC20,
    baseAssetInfo,
    otherAssetToken: otherAssetToken as unknown as ERC20,
    otherAssetInfo,
    deployer: deployerSigner,
    user1: user1Signer,
    user2: user2Signer,
  };
}

export const createDPoolFixture = (config: DPoolFixtureConfig) => {
  return deployments.createFixture(
    async (hreFixtureEnv: HardhatRuntimeEnvironment) => {
      // Clean slate: run all default deployment scripts
      await hreFixtureEnv.deployments.fixture();
      // Run dPOOL-specific deployment tags
      await hreFixtureEnv.deployments.fixture(config.deploymentTags);
      // Fetch dPOOL components using fixture environment
      return fetchDPoolComponents(
        {
          deployments: hreFixtureEnv.deployments,
          getNamedAccounts: hreFixtureEnv.getNamedAccounts,
          ethers: hreFixtureEnv.ethers,
          globalHre: hreFixtureEnv,
        },
        config
      );
    }
  );
};

// Pre-bound fixtures for common test cases
export const DPUSDCFixture = createDPoolFixture(DPUSDC_CONFIG);
export const DPfrxUSDFixture = createDPoolFixture(DPfrxUSD_CONFIG);

// Utility functions for tests
export async function fundUserWithTokens(
  token: ERC20,
  user: any,
  amount: BigNumberish,
  deployer: any
): Promise<void> {
  await token.connect(deployer).transfer(user.address, amount);
}

export async function approveToken(
  token: ERC20,
  owner: any,
  spender: string,
  amount: BigNumberish
): Promise<void> {
  await token.connect(owner).approve(spender, amount);
}

export async function depositToPool(
  poolToken: any,
  user: any,
  amount: BigNumberish
): Promise<any> {
  return poolToken.connect(user).deposit(amount, user.address);
}

export async function withdrawFromPool(
  poolToken: any,
  user: any,
  amount: BigNumberish
): Promise<any> {
  return poolToken.connect(user).withdraw(amount, user.address, user.address);
}

export async function redeemFromPool(
  poolToken: any,
  user: any,
  shares: BigNumberish
): Promise<any> {
  return poolToken.connect(user).redeem(shares, user.address, user.address);
}

export async function getPoolTokenValue(poolToken: any): Promise<BigNumberish> {
  return poolToken.totalAssets();
}

export async function getPoolTokenShares(poolToken: any): Promise<BigNumberish> {
  return poolToken.totalSupply();
}

export async function getUserShares(
  poolToken: any,
  user: any
): Promise<BigNumberish> {
  return poolToken.balanceOf(user.address);
}

export async function getUserBaseAssets(
  baseAsset: ERC20,
  user: any
): Promise<BigNumberish> {
  return baseAsset.balanceOf(user.address);
} 