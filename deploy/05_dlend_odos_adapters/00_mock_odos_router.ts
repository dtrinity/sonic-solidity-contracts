import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { getConfig } from "../../config/config";
import { isMainnet } from "../../typescript/hardhat/deploy";
import { TestERC20, OdosRouterV2Mock } from "../../typechain-types";

// Exchange rate configuration based on oracle feed prices
interface ExchangeRateConfig {
  baseToken: string;
  quoteToken: string;
  rate: string; // Rate in the direction of base -> quote
}

// Initial exchange rates to set
// Rates are calculated based on oracle feed prices:
// - sfrxUSD/frxUSD = 1.1 (from oracle)
// - stS/S = 1.1 (from oracle)
// - S/USD = 4.2 (from oracle)
// Cross rates are calculated accordingly
const exchangeRates: ExchangeRateConfig[] = [
  {
    baseToken: "dUSD",
    quoteToken: "sfrxUSD",
    rate: "1.1", // 1 dUSD = 1.1 sfrxUSD (based on sfrxUSD/frxUSD oracle rate)
  },
  {
    baseToken: "dS",
    quoteToken: "stS",
    rate: "1.1", // 1 dS = 1.1 stS (based on stS/S oracle rate)
  },
  {
    baseToken: "dUSD",
    quoteToken: "dS",
    rate: "0.238095", // 1 dUSD = 0.238095 dS (1/4.2, based on S/USD oracle rate)
  },
  {
    baseToken: "sfrxUSD",
    quoteToken: "stS",
    rate: "0.216374", // 1 sfrxUSD = 0.216374 stS (calculated from cross rates)
  },
];

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const config = await getConfig(hre);

  if (isMainnet(hre.network.name)) {
    // We use the real router on mainnet
    return true;
  }

  // Deploy OdosRouterV2Mock
  const deployed = await hre.deployments.deploy("OdosRouterV2Mock", {
    contract: "OdosRouterV2Mock",
    from: deployer,
    args: [],
    autoMine: true,
    log: false,
  });

  console.log(`Deployed OdosRouterV2Mock at ${deployed.address}`);

  // Get router contract instance
  const router = (await hre.ethers.getContractAt(
    "OdosRouterV2Mock",
    deployed.address
  )) as OdosRouterV2Mock;

  // Set exchange rates
  for (const rate of exchangeRates) {
    // Get token addresses
    const baseDeployment = await hre.deployments.get(rate.baseToken);
    const quoteDeployment = await hre.deployments.get(rate.quoteToken);

    // Convert rate to wei (18 decimals)
    const rateInWei = hre.ethers.parseUnits(rate.rate, 18);

    // Set the exchange rate
    await router.setExchangeRate(
      baseDeployment.address,
      quoteDeployment.address,
      rateInWei
    );

    // Also set the inverse rate
    const inverseRate = BigInt(1e36) / rateInWei; // 1e36 because we're dividing two 18 decimal numbers
    await router.setExchangeRate(
      quoteDeployment.address,
      baseDeployment.address,
      inverseRate
    );

    console.log(
      `Set exchange rate for ${rate.baseToken}/${rate.quoteToken} = ${rate.rate}`
    );
    console.log(
      `Set inverse exchange rate for ${rate.quoteToken}/${rate.baseToken} = ${inverseRate}`
    );
  }

  // Get all mock tokens and deposit 5% to the router
  if (config.MOCK_ONLY?.tokens) {
    for (const [symbol, _tokenConfig] of Object.entries(
      config.MOCK_ONLY.tokens
    )) {
      // Get the deployed token contract
      const tokenDeployment = await hre.deployments.get(symbol);
      const token = (await hre.ethers.getContractAt(
        "TestERC20",
        tokenDeployment.address
      )) as TestERC20;

      // Calculate 5% of total supply
      const totalSupply = await token.totalSupply();
      const amountToDeposit = (totalSupply * BigInt(5)) / BigInt(100); // 5%

      // Transfer tokens to the router
      await token.transfer(deployed.address, amountToDeposit);

      console.log(
        `Deposited ${amountToDeposit.toString()} ${symbol} to OdosRouterV2Mock`
      );
    }
  }

  console.log(`🔄  ${__filename.split("/").slice(-2).join("/")}: ✅`);
  return true;
};

// Make sure this runs after the mock tokens are deployed
func.dependencies = ["local_token_setup"];
func.tags = ["mock_odos_router_setup"];
func.id = "mock_odos_router_setup";

export default func;
