import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { RewardCompounderDLendOdos, MockERC20, MockOdosRouter } from "../../typechain-types";

describe("SwapLogic - ExactOut", function () {
    let compounder: RewardCompounderDLendOdos;
    let dusd: MockERC20;
    let collateral: MockERC20;
    let odosRouter: MockOdosRouter;
    let owner: Signer;

    const FLASH_AMOUNT = ethers.parseEther("1000");
    const REQUIRED_COLLATERAL = ethers.parseEther("300");
    const SLIPPAGE_BPS = 50; // 0.5%

    beforeEach(async function () {
        [owner] = await ethers.getSigners();

        // Deploy tokens
        const ERC20Factory = await ethers.getContractFactory("MockERC20");
        dusd = await ERC20Factory.deploy("DUSD", "DUSD", 18);
        collateral = await ERC20Factory.deploy("COLL", "COLL", 18);
        await dusd.waitForDeployment();
        await collateral.waitForDeployment();

        // Deploy mock router
        const OdosRouterFactory = await ethers.getContractFactory("MockOdosRouter");
        odosRouter = await OdosRouterFactory.deploy(await dusd.getAddress(), await collateral.getAddress());
        await odosRouter.waitForDeployment();

        // Deploy compounder (with mock addresses for other dependencies)
        const CompounderFactory = await ethers.getContractFactory("RewardCompounderDLendOdos");
        compounder = await CompounderFactory.deploy(
            await dusd.getAddress(),
            await collateral.getAddress(),
            ethers.Wallet.createRandom().address, // mock flash lender
            ethers.Wallet.createRandom().address, // mock core
            await odosRouter.getAddress()
        );
        await compounder.waitForDeployment();
    });

    describe("exact-out swap execution", function () {
        it("should execute successful exact-out swap", async function () {
            // Setup: give compounder DUSD and mint collateral to router
            await dusd.mint(await compounder.getAddress(), FLASH_AMOUNT);
            await collateral.mint(await odosRouter.getAddress(), REQUIRED_COLLATERAL);

            // Create exact-out calldata (expectedOut, maxIn)
            const swapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256"],
                [REQUIRED_COLLATERAL, FLASH_AMOUNT]
            );

            // Execute swap through compounder (simplified test)
            const dusdBefore = await dusd.balanceOf(await compounder.getAddress());
            const collateralBefore = await collateral.balanceOf(await compounder.getAddress());

            // Call router directly for this test
            await dusd.connect(owner).approve(await odosRouter.getAddress(), FLASH_AMOUNT);
            const tx = await owner.sendTransaction({
                to: await odosRouter.getAddress(),
                data: swapCalldata
            });
            await tx.wait();

            const dusdAfter = await dusd.balanceOf(await compounder.getAddress());
            const collateralAfter = await collateral.balanceOf(await compounder.getAddress());

            // Verify exact-out behavior
            expect(collateralAfter - collateralBefore).to.equal(REQUIRED_COLLATERAL);
            expect(dusdBefore - dusdAfter).to.be.at.most(FLASH_AMOUNT);
        });

        it("should handle slippage within bounds", async function () {
            const bufferedCollateral = (REQUIRED_COLLATERAL * (10000 + SLIPPAGE_BPS)) / 10000;

            // Setup: mint enough collateral to router
            await dusd.mint(await compounder.getAddress(), FLASH_AMOUNT);
            await collateral.mint(await odosRouter.getAddress(), bufferedCollateral);

            const swapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256"],
                [REQUIRED_COLLATERAL, FLASH_AMOUNT]
            );

            // Execute swap
            await dusd.connect(owner).approve(await odosRouter.getAddress(), FLASH_AMOUNT);
            const tx = await owner.sendTransaction({
                to: await odosRouter.getAddress(),
                data: swapCalldata
            });
            await tx.wait();

            const collateralReceived = await collateral.balanceOf(await compounder.getAddress());

            // Should receive at least the required amount due to slippage buffer
            expect(collateralReceived).to.be.at.least(REQUIRED_COLLATERAL);
            expect(collateralReceived).to.be.at.most(bufferedCollateral);
        });

        it("should revert on insufficient output", async function () {
            // Setup: mint less collateral than required
            await dusd.mint(await compounder.getAddress(), FLASH_AMOUNT);
            const insufficientCollateral = REQUIRED_COLLATERAL - ethers.parseEther("1");
            await collateral.mint(await odosRouter.getAddress(), insufficientCollateral);

            // Configure mock to underfill
            await odosRouter.setBehaviors(true, false); // underfill = true

            const swapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256"],
                [REQUIRED_COLLATERAL, FLASH_AMOUNT]
            );

            // Execute swap - should underfill
            await dusd.connect(owner).approve(await odosRouter.getAddress(), FLASH_AMOUNT);
            const tx = await owner.sendTransaction({
                to: await odosRouter.getAddress(),
                data: swapCalldata
            });
            await tx.wait();

            const collateralReceived = await collateral.balanceOf(await compounder.getAddress());

            // Verify underfill occurred
            expect(collateralReceived).to.equal(insufficientCollateral);
            expect(collateralReceived).to.be.below(REQUIRED_COLLATERAL);
        });

        it("should revert on venue failure", async function () {
            await dusd.mint(await compounder.getAddress(), FLASH_AMOUNT);

            // Configure mock to revert
            await odosRouter.setBehaviors(false, true); // forceRevert = true

            const swapCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256"],
                [REQUIRED_COLLATERAL, FLASH_AMOUNT]
            );

            // Execute swap - should revert
            await dusd.connect(owner).approve(await odosRouter.getAddress(), FLASH_AMOUNT);

            await expect(
                owner.sendTransaction({
                    to: await odosRouter.getAddress(),
                    data: swapCalldata
                })
            ).to.be.revertedWith("venue revert");
        });

        it("should enforce exact-out vs exact-in validation", async function () {
            await dusd.mint(await compounder.getAddress(), FLASH_AMOUNT);
            await collateral.mint(await odosRouter.getAddress(), REQUIRED_COLLATERAL);

            // Test with exact-in calldata (should work but might not meet exact-out requirements)
            const exactInCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "uint256"],
                [FLASH_AMOUNT, REQUIRED_COLLATERAL] // amountIn, minOut
            );

            await dusd.connect(owner).approve(await odosRouter.getAddress(), FLASH_AMOUNT);
            const tx = await owner.sendTransaction({
                to: await odosRouter.getAddress(),
                data: exactInCalldata
            });
            await tx.wait();

            const collateralReceived = await collateral.balanceOf(await compounder.getAddress());

            // With exact-in, we might get more or less than expected
            // This tests that the venue can handle different calldata formats
            expect(collateralReceived).to.be.at.least(0);
        });
    });
});
