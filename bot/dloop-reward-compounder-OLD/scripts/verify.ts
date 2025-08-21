import { ethers } from "hardhat";
import { getDeployedAddress } from "../config/deploy-ids";
import { REWARD_COMPOUNDER_ABI } from "../typescript/abis/RewardCompounderDLendOdos";
import { REWARD_HELPER_ABI } from "../typescript/abis/RewardHelper";

async function main() {
    const network = process.env.HARDHAT_NETWORK || "sonic_testnet";
    console.log(`Verifying contracts on ${network}...`);

    try {
        // Verify RewardCompounderDLendOdos
        const compounderAddress = getDeployedAddress("RewardCompounderDLendOdos", network);
        if (compounderAddress) {
            console.log(`\nVerifying RewardCompounderDLendOdos at ${compounderAddress}...`);

            try {
                await hre.run("verify:verify", {
                    address: compounderAddress,
                    constructorArguments: [
                        process.env.DUSD_ADDRESS,
                        process.env.COLLATERAL_ADDRESS,
                        process.env.FLASH_LENDER_ADDRESS,
                        process.env.CORE_ADDRESS,
                        process.env.ODOS_ROUTER_ADDRESS
                    ]
                });
                console.log("✅ RewardCompounderDLendOdos verified successfully");
            } catch (error: any) {
                if (error.message.includes("Already Verified")) {
                    console.log("ℹ️  RewardCompounderDLendOdos already verified");
                } else {
                    console.error("❌ Failed to verify RewardCompounderDLendOdos:", error.message);
                }
            }
        } else {
            console.log("⚠️  RewardCompounderDLendOdos address not found in deploy-ids");
        }

        // Verify RewardHelper
        const helperAddress = getDeployedAddress("RewardHelper", network);
        if (helperAddress) {
            console.log(`\nVerifying RewardHelper at ${helperAddress}...`);

            try {
                await hre.run("verify:verify", {
                    address: helperAddress,
                    constructorArguments: [
                        process.env.POOL_ADDRESS,
                        process.env.REWARDS_CONTROLLER_ADDRESS,
                        process.env.ADDRESS_PROVIDER_ADDRESS
                    ]
                });
                console.log("✅ RewardHelper verified successfully");
            } catch (error: any) {
                if (error.message.includes("Already Verified")) {
                    console.log("ℹ️  RewardHelper already verified");
                } else {
                    console.error("❌ Failed to verify RewardHelper:", error.message);
                }
            }
        } else {
            console.log("⚠️  RewardHelper address not found in deploy-ids");
        }

        // Test contract functionality
        await testContracts(compounderAddress, helperAddress);

    } catch (error) {
        console.error("❌ Verification failed:", error);
        process.exit(1);
    }
}

async function testContracts(compounderAddress: string | null, helperAddress: string | null) {
    console.log("\n🧪 Testing contract functionality...");

    if (compounderAddress) {
        const compounder = new ethers.Contract(compounderAddress, REWARD_COMPOUNDER_ABI, ethers.provider);

        try {
            // Test view functions
            const dusd = await compounder.DUSD();
            const collateral = await compounder.COLLATERAL();
            const core = await compounder.CORE();
            const flash = await compounder.FLASH();
            const swapAgg = await compounder.SWAP_AGG();

            console.log("✅ Compounder view functions working:");
            console.log(`   DUSD: ${dusd}`);
            console.log(`   COLLATERAL: ${collateral}`);
            console.log(`   CORE: ${core}`);
            console.log(`   FLASH: ${flash}`);
            console.log(`   SWAP_AGG: ${swapAgg}`);
        } catch (error) {
            console.error("❌ Compounder test failed:", error);
        }
    }

    if (helperAddress) {
        const helper = new ethers.Contract(helperAddress, REWARD_HELPER_ABI, ethers.provider);

        try {
            // Test view functions
            const pool = await helper.POOL();
            const rewardsController = await helper.REWARDS_CONTROLLER();
            const addressProvider = await helper.ADDRESS_PROVIDER();

            console.log("✅ Helper view functions working:");
            console.log(`   POOL: ${pool}`);
            console.log(`   REWARDS_CONTROLLER: ${rewardsController}`);
            console.log(`   ADDRESS_PROVIDER: ${addressProvider}`);
        } catch (error) {
            console.error("❌ Helper test failed:", error);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
