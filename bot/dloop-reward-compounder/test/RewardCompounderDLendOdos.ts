import { expect } from "chai";
import { ethers } from "hardhat";

describe("RewardCompounderDLendOdos - happy path", () => {
  it("compounds rewards, repays flash, and realizes profit", async () => {
    const [deployer] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const dUSD = await MockERC20.deploy("dUSD", "dUSD", 18);
    const sfrx = await MockERC20.deploy("sfrxUSD", "sfrx", 18);
    await dUSD.waitForDeployment();
    await sfrx.waitForDeployment();

    // Mint balances to lender and router
    // Lender holds dUSD to lend
    const feeBps = 8; // 0.08%
    const MockFlashLender = await ethers.getContractFactory("MockFlashLender");
    const lender = await MockFlashLender.deploy(await dUSD.getAddress(), feeBps);
    await lender.waitForDeployment();

    // Router with 0.1% loss
    const rateBps = 9990;
    const MockOdos = await ethers.getContractFactory("MockOdosRouterV2");
    const router = await MockOdos.deploy(await dUSD.getAddress(), await sfrx.getAddress(), rateBps);
    await router.waitForDeployment();

    // Core mock with K = assets * 2/3 and threshold low, treasury fee 1%
    const kBps = 6667;
    const threshold = 1n;
    const treasuryBps = 100; // 1%
    const MockCore = await ethers.getContractFactory("MockDLoopCoreDLend");
    const core = await MockCore.deploy(await sfrx.getAddress(), await dUSD.getAddress(), kBps, threshold, treasuryBps);
    await core.waitForDeployment();
    // Core needs dUSD to pay out K during deposit
    await dUSD.mint(await core.getAddress(), ethers.parseUnits("100000000", 18));

    // Fund lender with a lot of dUSD and router with a lot of sfrx for payouts
    await dUSD.mint(await lender.getAddress(), ethers.parseUnits("100000000", 18));
    await sfrx.mint(await router.getAddress(), ethers.parseUnits("100000000", 18));

    // Deploy periphery
    const Periphery = await ethers.getContractFactory("RewardCompounderDLendOdos");
    const periphery = await Periphery.deploy(
      await dUSD.getAddress(),
      await sfrx.getAddress(),
      await core.getAddress(),
      await lender.getAddress(),
      await router.getAddress()
    );
    await periphery.waitForDeployment();

    // Approvals for router to pull from periphery will be set inside contract

    // Fund periphery with nothing initially
    const flashAmount = ethers.parseUnits("100000", 18);
    // We also ensure router has no tokens; it pulls from periphery via transferFrom

    // Build router swap calldata: swapExactIn(dUSD -> sfrx, amount, minOut)
    const minOut = flashAmount * BigInt(rateBps) / 10000n;
    const swapData = new ethers.Interface([
      "function swapExactIn(address input, address output, uint256 amountIn, uint256 minOut) returns (uint256)"
    ]).encodeFunctionData("swapExactIn", [await dUSD.getAddress(), await sfrx.getAddress(), flashAmount, minOut]);

    // Run
    const tx = await periphery.run(flashAmount, swapData, minOut);
    const receipt = await tx.wait();
    expect(receipt?.status).to.eq(1);

    // Verify events and profit
    // Check periphery dUSD balance is positive (profit retained)
    const peripheryDusd = await dUSD.balanceOf(await periphery.getAddress());
    expect(peripheryDusd).to.be.gt(0n);
  });

  it("reverts when exchangeThreshold is not met", async () => {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const dUSD = await MockERC20.deploy("dUSD", "dUSD", 18);
    const sfrx = await MockERC20.deploy("sfrxUSD", "sfrx", 18);
    await dUSD.waitForDeployment();
    await sfrx.waitForDeployment();

    const MockFlashLender = await ethers.getContractFactory("MockFlashLender");
    const lender = await MockFlashLender.deploy(await dUSD.getAddress(), 8);
    await lender.waitForDeployment();

    const MockOdos = await ethers.getContractFactory("MockOdosRouterV2");
    const router = await MockOdos.deploy(await dUSD.getAddress(), await sfrx.getAddress(), 9990);
    await router.waitForDeployment();

    const MockCore = await ethers.getContractFactory("MockDLoopCoreDLend");
    // Set a very high threshold so previewDeposit will be below
    const core = await MockCore.deploy(await sfrx.getAddress(), await dUSD.getAddress(), 6667, ethers.parseUnits("200000", 18), 100);
    await core.waitForDeployment();

    await dUSD.mint(await lender.getAddress(), ethers.parseUnits("100000000", 18));
    await sfrx.mint(await router.getAddress(), ethers.parseUnits("100000000", 18));
    await dUSD.mint(await core.getAddress(), ethers.parseUnits("100000000", 18));

    const Periphery = await ethers.getContractFactory("RewardCompounderDLendOdos");
    const periphery = await Periphery.deploy(
      await dUSD.getAddress(),
      await sfrx.getAddress(),
      await core.getAddress(),
      await lender.getAddress(),
      await router.getAddress()
    );

    const flashAmount = ethers.parseUnits("100000", 18);
    const minOut = flashAmount * 9990n / 10000n;
    const swapData = new ethers.Interface([
      "function swapExactIn(address input, address output, uint256 amountIn, uint256 minOut) returns (uint256)"
    ]).encodeFunctionData("swapExactIn", [await dUSD.getAddress(), await sfrx.getAddress(), flashAmount, minOut]);

    await expect(periphery.run(flashAmount, swapData, minOut)).to.be.reverted;
  });

  it("reverts when not enough to repay flash", async () => {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const dUSD = await MockERC20.deploy("dUSD", "dUSD", 18);
    const sfrx = await MockERC20.deploy("sfrxUSD", "sfrx", 18);
    await dUSD.waitForDeployment();
    await sfrx.waitForDeployment();

    const MockFlashLender = await ethers.getContractFactory("MockFlashLender");
    const lender = await MockFlashLender.deploy(await dUSD.getAddress(), 8);
    await lender.waitForDeployment();

    const MockOdos = await ethers.getContractFactory("MockOdosRouterV2");
    // Make route very bad: 50% out
    const router = await MockOdos.deploy(await dUSD.getAddress(), await sfrx.getAddress(), 5000);
    await router.waitForDeployment();

    const MockCore = await ethers.getContractFactory("MockDLoopCoreDLend");
    // K = 0, treasury = 100% so netZ = 0
    const core = await MockCore.deploy(await sfrx.getAddress(), await dUSD.getAddress(), 0, 1, 10000);
    await core.waitForDeployment();

    await dUSD.mint(await lender.getAddress(), ethers.parseUnits("100000000", 18));
    await sfrx.mint(await router.getAddress(), ethers.parseUnits("100000000", 18));
    await dUSD.mint(await core.getAddress(), ethers.parseUnits("100000000", 18));

    const Periphery = await ethers.getContractFactory("RewardCompounderDLendOdos");
    const periphery = await Periphery.deploy(
      await dUSD.getAddress(),
      await sfrx.getAddress(),
      await core.getAddress(),
      await lender.getAddress(),
      await router.getAddress()
    );

    const flashAmount = ethers.parseUnits("100000", 18);
    const minOut = flashAmount * 5000n / 10000n;
    const swapData = new ethers.Interface([
      "function swapExactIn(address input, address output, uint256 amountIn, uint256 minOut) returns (uint256)"
    ]).encodeFunctionData("swapExactIn", [await dUSD.getAddress(), await sfrx.getAddress(), flashAmount, minOut]);

    await expect(periphery.run(flashAmount, swapData, minOut)).to.be.reverted;
  });
});
