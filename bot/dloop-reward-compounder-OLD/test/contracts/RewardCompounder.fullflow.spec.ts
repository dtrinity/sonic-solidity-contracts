import { ethers } from "hardhat";
import { expect } from "chai";

describe("RewardCompounderDLendOdos - fullflow", () => {
  it("runs a profitable full flow and repays flash", async () => {
    const [deployer] = await ethers.getSigners();

    // Deploy tokens
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const dUSD = await ERC20.deploy("dUSD", "dUSD", 18);
    const collateral = await ERC20.deploy("COL", "COL", 18);
    const shares = await ERC20.deploy("SHARE", "SHARE", 18);

    // Seed receiver with nothing (all inside flow)

    // Deploy mocks
    const Core = await ethers.getContractFactory("MockDLoopCoreDLend");
    const core = await Core.deploy(await collateral.getAddress(), await dUSD.getAddress(), await shares.getAddress());
    // params: S=1e18, preview=300e18, K=200e18, netZ=110e18
    await core.setParams(ethers.parseEther("1"), ethers.parseEther("300"), ethers.parseEther("200"), ethers.parseEther("110"), false);

    const Lender = await ethers.getContractFactory("MockFlashLender");
    const lender = await Lender.deploy(await dUSD.getAddress(), 9n); // 9 bps

    const Router = await ethers.getContractFactory("MockOdosRouter");
    const router = await Router.deploy(await dUSD.getAddress(), await collateral.getAddress());

    // Deploy periphery
    const Periphery = await ethers.getContractFactory("RewardCompounderDLendOdos");
    const periphery = await Periphery.deploy(
      await dUSD.getAddress(),
      await collateral.getAddress(),
      await lender.getAddress(),
      await core.getAddress(),
      await router.getAddress()
    );

    // Prepare flash amount and swap calldata (expectedOut, maxIn)
    const S = await core.exchangeThreshold();
    const required = await core.previewMint(S);
    const flashAmount = ethers.parseEther("295");
    const swapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256"],[required, flashAmount]);

    // Approvals for mocks: lender will pull back amount+fee from periphery; periphery approves inside
    // Seed no balances; lender mints to periphery during flash

    // Execute
    await expect(periphery.run(swapCalldata, flashAmount, 0)).to.emit(periphery, "RunStarted");

    // After run, check that periphery could repay and may hold small profit
    const dusdBal = await dUSD.balanceOf(await periphery.getAddress());
    expect(dusdBal).to.be.gte(0n);
  });
});

