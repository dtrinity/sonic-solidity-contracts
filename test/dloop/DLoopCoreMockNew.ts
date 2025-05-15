import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { ONE_HUNDRED_PERCENT_BPS, ONE_PERCENT_BPS } from '../../typescript/common/bps_constants';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { TestMintableERC20, DLoopCoreMock } from '../../typechain-types';

describe('DLoopCoreMock', function () {
  let dloop: DLoopCoreMock;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let mockPool: SignerWithAddress;
  let underlying: TestMintableERC20;
  let dStable: TestMintableERC20;
  let accounts: SignerWithAddress[];

  beforeEach(async function () {
    await deployments.fixture();
    accounts = await ethers.getSigners();
    [deployer, user, mockPool] = accounts;

    // Deploy mock tokens with minting
    const MockERC20 = await ethers.getContractFactory("TestMintableERC20");
    underlying = (await MockERC20.deploy("Mock USDC", "mUSDC", 18)) as TestMintableERC20;
    dStable = (await MockERC20.deploy("Mock dUSD", "mdUSD", 18)) as TestMintableERC20;

    console.log('deployer', await deployer.getAddress());
    console.log('user', await user.getAddress());
    console.log('mockPool', await mockPool.getAddress());

    // Deploy dLOOP contract
    const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock", deployer);
    dloop = (await DLoopCoreMock.deploy(
      "Mock dLOOP Vault",
      "mdLOOP",
      await underlying.getAddress(),
      await dStable.getAddress(),
      300 * ONE_PERCENT_BPS, // 3x leverage
      200 * ONE_PERCENT_BPS, // 2x lower bound
      400 * ONE_PERCENT_BPS, // 4x upper bound
      1 * ONE_PERCENT_BPS,   // 1% max subsidy
      await mockPool.getAddress(),
    )) as DLoopCoreMock;

    // Setup mock pool with large balances and approvals
    await underlying.mint(await mockPool.getAddress(), ethers.parseEther("1000000")); // 1M tokens
    await dStable.mint(await mockPool.getAddress(), ethers.parseEther("1000000")); // 1M tokens
    await underlying.connect(mockPool).approve(await dloop.getAddress(), ethers.MaxUint256);
    await dStable.connect(mockPool).approve(await dloop.getAddress(), ethers.MaxUint256);

    // Set initial prices
    await dloop.setMockPrice(await underlying.getAddress(), ethers.parseUnits("1", 8)); // $1
    await dloop.setMockPrice(await dStable.getAddress(), ethers.parseUnits("1", 8)); // $1
  });

  describe('Internal Pool Logic Tests', function () {
    const testCases = [
      { name: 'small amount', amount: ethers.parseEther("1") },
      { name: 'medium amount', amount: ethers.parseEther("1000") },
      { name: 'large amount', amount: ethers.parseEther("100000") }
    ];

    testCases.forEach(({ name, amount }) => {
      describe(`Test Case: ${name}`, function () {
        it('testSupplyToPool should increase collateral and transfer to pool', async function () {
          // Setup
          await underlying.mint(await user.getAddress(), amount);
          await underlying.connect(user).approve(await dloop.getAddress(), amount);
          
          // Initial state
          const initialPoolBalance = await underlying.balanceOf(await mockPool.getAddress());
          const initialCollateral = await dloop.mockCollateral(await user.getAddress());

          // Execute
          await dloop.connect(user).testSupplyToPool(
            await underlying.getAddress(),
            amount,
            await user.getAddress()
          );

          // Verify
          expect(await dloop.mockCollateral(await user.getAddress())).to.equal(initialCollateral + amount);
          expect(await underlying.balanceOf(await mockPool.getAddress())).to.equal(initialPoolBalance + amount);
        });

        it('testBorrowFromPool should increase debt and transfer from pool', async function () {
          // Execute
          await dloop.connect(user).testBorrowFromPool(
            await dStable.getAddress(),
            amount,
            await user.getAddress()
          );

          // Verify
          expect(await dloop.mockDebt(await user.getAddress())).to.equal(amount);
          expect(await dStable.balanceOf(await user.getAddress())).to.equal(amount);
        });

        it('testRepayDebt should decrease debt and transfer to pool', async function () {
          // Setup: First borrow, then repay
          await dloop.connect(user).testBorrowFromPool(
            await dStable.getAddress(),
            amount,
            await user.getAddress()
          );
          await dStable.connect(user).approve(await dloop.getAddress(), amount);

          // Execute
          await dloop.connect(user).testRepayDebt(
            await dStable.getAddress(),
            amount,
            await user.getAddress()
          );

          // Verify
          expect(await dloop.mockDebt(await user.getAddress())).to.equal(0);
          expect(await dStable.balanceOf(await mockPool.getAddress())).to.equal(ethers.parseEther("1000000")); // Back to initial pool balance
        });

        it('testWithdrawFromPool should decrease collateral and transfer from pool', async function () {
          // Setup: First supply, then withdraw
          await underlying.mint(await user.getAddress(), amount);
          await underlying.connect(user).approve(await dloop.getAddress(), amount);
          await dloop.connect(user).testSupplyToPool(
            await underlying.getAddress(),
            amount,
            await user.getAddress()
          );

          // Execute
          await dloop.connect(user).testWithdrawFromPool(
            await underlying.getAddress(),
            amount,
            await user.getAddress()
          );

          // Verify
          expect(await dloop.mockCollateral(await user.getAddress())).to.equal(0);
          expect(await underlying.balanceOf(await user.getAddress())).to.equal(amount);
        });
      });
    });
  });

  describe('Deposit and Redeem Tests', function () {
    interface TestCase {
      name: string;
      depositAmount: bigint;
      priceChange?: { token: string; newPrice: bigint; };
    }

    const testCases: TestCase[] = [
      { 
        name: 'basic deposit and redeem',
        depositAmount: ethers.parseEther("100")
      },
      { 
        name: 'deposit and redeem with underlying price increase',
        depositAmount: ethers.parseEther("100"),
        priceChange: { 
          token: 'underlying',
          newPrice: ethers.parseUnits("1.5", 8) // $1.50
        }
      },
      { 
        name: 'deposit and redeem with underlying price decrease',
        depositAmount: ethers.parseEther("100"),
        priceChange: { 
          token: 'underlying',
          newPrice: ethers.parseUnits("0.5", 8) // $0.50
        }
      }
    ];

    testCases.forEach((testCase) => {
      describe(`Test Case: ${testCase.name}`, function () {
        it('should correctly handle deposit and redeem', async function () {
          // Setup: Mint tokens to user and approve
          const leveragedAmount = (testCase.depositAmount * 300n) / 100n; // 3x leverage
          await underlying.mint(await user.getAddress(), leveragedAmount);
          await underlying.connect(user).approve(await dloop.getAddress(), leveragedAmount);

          // Initial state
          const initialShares = await dloop.balanceOf(await user.getAddress());
          const initialAssets = await dloop.totalAssets();

          // Deposit
          await dloop.connect(user).deposit(testCase.depositAmount, await user.getAddress());
          
          // Verify deposit
          expect(await dloop.balanceOf(await user.getAddress())).to.be.gt(initialShares);
          expect(await dloop.totalAssets()).to.be.gt(initialAssets);

          // Change price if specified
          if (testCase.priceChange) {
            const token = testCase.priceChange.token === 'underlying' ? 
              await underlying.getAddress() : 
              await dStable.getAddress();
            await dloop.setMockPrice(token, testCase.priceChange.newPrice);
          }

          // Get shares balance
          const userShares = await dloop.balanceOf(await user.getAddress());

          // Calculate expected assets
          const expectedAssets = await dloop.convertToAssets(userShares);

          // Redeem
          await dloop.connect(user).redeem(userShares, await user.getAddress(), await user.getAddress());

          // Verify redeem
          expect(await dloop.balanceOf(await user.getAddress())).to.equal(0);
          expect(await underlying.balanceOf(await user.getAddress())).to.equal(expectedAssets);
        });
      });
    });
  });
});
