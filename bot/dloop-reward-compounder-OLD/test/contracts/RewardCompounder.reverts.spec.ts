import { ethers } from "hardhat";
import { expect } from "chai";

describe("RewardCompounderDLendOdos - reverts", () => {
  it("reverts when below threshold or deposit disabled", async () => {
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const dUSD = await ERC20.deploy("dUSD", "dUSD", 18);
    const collateral = await ERC20.deploy("COL", "COL", 18);
    const shares = await ERC20.deploy("SHARE", "SHARE", 18);

    const Core = await ethers.getContractFactory("MockDLoopCoreDLend");
    const core = await Core.deploy(await collateral.getAddress(), await dUSD.getAddress(), await shares.getAddress());
    await core.setParams(0n, ethers.parseEther("300"), ethers.parseEther("200"), ethers.parseEther("110"), true);

    const Lender = await ethers.getContractFactory("MockFlashLender");
    const lender = await Lender.deploy(await dUSD.getAddress(), 9n);

    const Router = await ethers.getContractFactory("MockOdosRouter");
    const router = await Router.deploy(await dUSD.getAddress(), await collateral.getAddress());

    const Periphery = await ethers.getContractFactory("RewardCompounderDLendOdos");
    const periphery = await Periphery.deploy(
      await dUSD.getAddress(), await collateral.getAddress(), await lender.getAddress(), await core.getAddress(), await router.getAddress()
    );

    const swapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256"],[0n, 0n]);
    await expect(periphery.run(swapCalldata, 0n, 0)).to.be.reverted;
  });

  it("reverts when swap underfills collateral", async () => {
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const dUSD = await ERC20.deploy("dUSD", "dUSD", 18);
    const collateral = await ERC20.deploy("COL", "COL", 18);
    const shares = await ERC20.deploy("SHARE", "SHARE", 18);

    const Core = await ethers.getContractFactory("MockDLoopCoreDLend");
    const core = await Core.deploy(await collateral.getAddress(), await dUSD.getAddress(), await shares.getAddress());

    const Lender = await ethers.getContractFactory("MockFlashLender");
    const lender = await Lender.deploy(await dUSD.getAddress(), 9n);

    const Router = await ethers.getContractFactory("MockOdosRouter");
    const router = await Router.deploy(await dUSD.getAddress(), await collateral.getAddress());
    await router.setBehaviors(true, false); // underfill

    const Periphery = await ethers.getContractFactory("RewardCompounderDLendOdos");
    const periphery = await Periphery.deploy(
      await dUSD.getAddress(), await collateral.getAddress(), await lender.getAddress(), await core.getAddress(), await router.getAddress()
    );

    const S = await core.exchangeThreshold();
    const required = await core.previewMint(S);
    const X = ethers.parseEther("295");
    const swapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256"],[required, X]);
    await expect(periphery.run(swapCalldata, X, 0)).to.be.revertedWithCustomError(periphery, "InsufficientCollateral");
  });
});

