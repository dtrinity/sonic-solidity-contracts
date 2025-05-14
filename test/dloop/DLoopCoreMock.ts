import { ethers, deployments, getNamedAccounts } from 'hardhat';
import { expect } from 'chai';
import { ONE_HUNDRED_PERCENT_BPS } from '../../typescript/common/bps_constants';

describe('DLoopCoreMock', function () {
  let dloop: any;
  let deployer: string;
  let user: string;
  let underlying: string;
  let dStable: string;

  beforeEach(async function () {
    await deployments.fixture(); // Start from a fresh deployment
    await deployments.fixture(["tokens", "mock-dloop-core", "dUSD"]);
    const accounts = await ethers.getSigners();
    deployer = accounts[0].address;
    user = accounts[1].address;
    underlying = (await deployments.get("USDC")).address;
    dStable = (await deployments.get("dUSD")).address;
    const dloopDeployment = await deployments.get("DLoopCoreMock");
    dloop = await ethers.getContractAt("DLoopCoreMock", dloopDeployment.address);
  });

  it('deploys and has correct name/symbol', async function () {
    expect(await dloop.name()).to.equal("Mock dLOOP Vault");
    expect(await dloop.symbol()).to.equal("mdLOOP");
  });

  it('allows setting and getting mock price', async function () {
    await dloop.setMockPrice(underlying, 12345);
    expect(await dloop.getAssetPriceFromOracle(underlying)).to.equal(12345);
  });

  it('reverts if price not set', async function () {
    await expect(dloop.getAssetPriceFromOracle(ethers.ZeroAddress)).to.be.revertedWith('Mock price not set');
  });

  it('calculates leverage correctly', async function () {
    // Set up: collateral = 2000, debt = 1000
    await dloop.setMockCollateral(dloop.target, 2000);
    await dloop.setMockDebt(dloop.target, 1000);
    // Leverage = collateral / (collateral - debt) * 10000 (bps)
    const leverage = await dloop.getCurrentLeverageBps();
    expect(leverage).to.equal(2 * ONE_HUNDRED_PERCENT_BPS); // 2x leverage in bps
  });
});
