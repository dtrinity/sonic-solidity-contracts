import { ethers, deployments, getNamedAccounts } from 'hardhat';
import { expect } from 'chai';
import { ONE_HUNDRED_PERCENT_BPS } from '../../typescript/common/bps_constants';

describe('DLoopCoreMock', function () {
  let dloop: any;
  let deployer: string;
  let user: string;
  let underlying: string;
  let dStable: string;
  let accounts: any[];

  beforeEach(async function () {
    await deployments.fixture(["mock-dloop-core"]);
    accounts = await ethers.getSigners();
    deployer = accounts[0].address;
    user = accounts[1].address;

    // Deploy mock tokens with minting
    const MockERC20 = await ethers.getContractFactory("RewardClaimableMockERC20");
    const mockUnderlying = await MockERC20.deploy("Mock USDC", "mUSDC");
    const mockDStable = await MockERC20.deploy("Mock dUSD", "mdUSD");
    underlying = await mockUnderlying.getAddress();
    dStable = await mockDStable.getAddress();

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

  it('supply increases collateral', async function () {
    // Mint underlying to dloop contract
    const underlyingToken = await ethers.getContractAt("RewardClaimableMockERC20", underlying);
    await underlyingToken.mint(deployer, 1000);
    await underlyingToken.connect(accounts[0]).approve(dloop.target, 1000);
    // Supply to pool
    await dloop.connect(accounts[0]).setMockCollateral(deployer, 0);
    await dloop.connect(accounts[0]).testSupplyToPool(underlying, 1000, deployer);
    expect(await dloop.mockCollateral(deployer)).to.equal(1000);
  });

  it('borrow increases debt and transfers tokens', async function () {
    // Mint dStable to dloop contract
    const dStableToken = await ethers.getContractAt("RewardClaimableMockERC20", dStable);
    await dStableToken.mint(dloop.target, 1000);
    // Borrow from pool
    await dloop.connect(accounts[0]).setMockDebt(deployer, 0);
    const userBalanceBefore = await dStableToken.balanceOf(deployer);
    await dloop.connect(accounts[0]).testBorrowFromPool(dStable, 500, deployer);
    expect(await dloop.mockDebt(deployer)).to.equal(500);
    const userBalanceAfter = await dStableToken.balanceOf(deployer);
    expect(userBalanceAfter - userBalanceBefore).to.equal(500);
  });

  it('repay decreases debt and transfers tokens from user', async function () {
    // Mint dStable to user
    const dStableToken = await ethers.getContractAt("RewardClaimableMockERC20", dStable);
    await dStableToken.mint(deployer, 500);
    // Approve dloop contract
    await dStableToken.connect(accounts[0]).approve(dloop.target, 500);
    await dloop.connect(accounts[0]).setMockDebt(deployer, 500);
    await dloop.connect(accounts[0]).testRepayDebt(dStable, 300, deployer);
    expect(await dloop.mockDebt(deployer)).to.equal(200);
    // Check contract received tokens
    expect(await dStableToken.balanceOf(dloop.target)).to.be.at.least(300);
  });

  it('withdraw decreases collateral and transfers tokens', async function () {
    // Mint underlying to dloop contract
    const underlyingToken = await ethers.getContractAt("RewardClaimableMockERC20", underlying);
    await underlyingToken.mint(dloop.target, 1000);
    await dloop.connect(accounts[0]).setMockCollateral(deployer, 1000);
    const userBalanceBefore = await underlyingToken.balanceOf(deployer);
    await dloop.connect(accounts[0]).testWithdrawFromPool(underlying, 400, deployer);
    expect(await dloop.mockCollateral(deployer)).to.equal(600);
    const userBalanceAfter = await underlyingToken.balanceOf(deployer);
    expect(userBalanceAfter - userBalanceBefore).to.equal(400);
  });

  describe('table-driven stress tests', function () {
    let attacker: string;
    let victim: string;
    let underlyingToken: any;
    let dStableToken: any;

    beforeEach(async function () {
      attacker = accounts[2].address;
      victim = accounts[3].address;
      underlyingToken = await ethers.getContractAt("RewardClaimableMockERC20", underlying);
      dStableToken = await ethers.getContractAt("RewardClaimableMockERC20", dStable);
      // Give both attacker and victim some tokens
      await underlyingToken.mint(attacker, 1_000_000);
      await underlyingToken.mint(victim, 1_000_000);
      await underlyingToken.mint(dloop.target, 0); // Ensure vault starts empty
    });

    const testCases = [
      {
        desc: 'normal deposit and withdrawal',
        fn: async () => {
          await underlyingToken.connect(accounts[2]).approve(dloop.target, 1000);
          await dloop.connect(accounts[2]).testSupplyToPool(underlying, 1000, attacker);
          expect(await dloop.mockCollateral(attacker)).to.equal(1000);
          await dloop.connect(accounts[2]).testWithdrawFromPool(underlying, 1000, attacker);
          expect(await dloop.mockCollateral(attacker)).to.equal(0);
        }
      },
      {
        desc: 'multiple users deposit and withdraw',
        fn: async () => {
          await underlyingToken.connect(accounts[2]).approve(dloop.target, 500);
          await underlyingToken.connect(accounts[3]).approve(dloop.target, 1500);
          await dloop.connect(accounts[2]).testSupplyToPool(underlying, 500, attacker);
          await dloop.connect(accounts[3]).testSupplyToPool(underlying, 1500, victim);
          expect(await dloop.mockCollateral(attacker)).to.equal(500);
          expect(await dloop.mockCollateral(victim)).to.equal(1500);
          await dloop.connect(accounts[2]).testWithdrawFromPool(underlying, 500, attacker);
          await dloop.connect(accounts[3]).testWithdrawFromPool(underlying, 1500, victim);
          expect(await dloop.mockCollateral(attacker)).to.equal(0);
          expect(await dloop.mockCollateral(victim)).to.equal(0);
        }
      },
      {
        desc: 'borrow and repay flow',
        fn: async () => {
          await underlyingToken.connect(accounts[2]).approve(dloop.target, 1000);
          await dloop.connect(accounts[2]).testSupplyToPool(underlying, 1000, attacker);
          await dStableToken.mint(dloop.target, 1000);
          await dloop.connect(accounts[2]).testBorrowFromPool(dStable, 500, attacker);
          expect(await dloop.mockDebt(attacker)).to.equal(500);
          await dStableToken.connect(accounts[2]).approve(dloop.target, 500);
          await dStableToken.mint(attacker, 500);
          await dloop.connect(accounts[2]).testRepayDebt(dStable, 500, attacker);
          expect(await dloop.mockDebt(attacker)).to.equal(0);
        }
      },
      {
        desc: 'inflation attack',
        fn: async () => {
          // Step 1: Attacker deposits 1 wei as first depositor
          await underlyingToken.connect(accounts[2]).approve(dloop.target, 1);
          await dloop.connect(accounts[2]).testSupplyToPool(underlying, 1, attacker);
          // Step 2: Attacker donates 1000 tokens directly to vault (not via deposit)
          await underlyingToken.connect(accounts[2]).transfer(dloop.target, 1000);
          // Step 3: Victim deposits 1000 tokens
          await underlyingToken.connect(accounts[3]).approve(dloop.target, 1000);
          await dloop.connect(accounts[3]).testSupplyToPool(underlying, 1000, victim);
          // Step 4: Attacker withdraws their share (should be only 1 wei worth, not all vault assets)
          const attackerBalanceBefore = await underlyingToken.balanceOf(attacker);
          await dloop.connect(accounts[2]).testWithdrawFromPool(underlying, 1, attacker);
          const attackerBalanceAfter = await underlyingToken.balanceOf(attacker);
          const stolen = attackerBalanceAfter - attackerBalanceBefore;
          // Step 5: Check if attacker stole more than their fair share (should not be able to steal the victim's deposit)
          expect(stolen).to.be.lte(1, 'Inflation attack succeeded: attacker stole more than their share!');
        }
      }
    ];

    for (const testCase of testCases) {
      it(testCase.desc, testCase.fn);
    }
  });
});
