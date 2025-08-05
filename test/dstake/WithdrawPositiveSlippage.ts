import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  createDStakeFixture,
  SDUSD_CONFIG,
  DStakeFixtureConfig,
} from "./fixture";
import { DStakeRouterDLend } from "../../typechain-types";
import { DStakeToken } from "../../typechain-types";
import { ERC20 } from "../../typechain-types";
import { IDStableConversionAdapter } from "../../typechain-types";

// Utility to impersonate an address and fund it with ETH for tx costs
async function impersonateAndFund(address: string) {
  await network.provider.send("hardhat_impersonateAccount", [address]);
  await network.provider.send("hardhat_setBalance", [
    address,
    "0x1000000000000000000", // 1 ETH
  ]);
  return await ethers.getSigner(address);
}

describe("DStakeRouter – positive slippage withdraw", function () {
  const cfg: DStakeFixtureConfig = SDUSD_CONFIG;
  const loadFixture = createDStakeFixture(cfg);

  it("should forward the full amount received from adapter even when > requested (bug demonstration)", async function () {
    const {
      deployer,
      DStakeToken,
      router,
      collateralVault,
      dStableToken,
      vaultAssetAddress,
      adapter: underlyingAdapter,
    } = await loadFixture();

    // Cast types
    const routerContract = router as unknown as DStakeRouterDLend;
    const dStakeToken = DStakeToken as unknown as DStakeToken;
    const dStable = dStableToken as unknown as ERC20;
    const underlying =
      underlyingAdapter as unknown as IDStableConversionAdapter;
    if (underlying === null || underlying === undefined) {
      throw new Error(
        "Underlying adapter not found in fixture – test cannot proceed"
      );
    }

    // ---------- Prepare a test deposit ----------
    const decimals = await dStable.decimals();
    const depositAmount = ethers.parseUnits("100", decimals);

    // Grant deployer minting rights & mint dStable to user1 for deposit
    const [_, user1] = await ethers.getSigners();

    const dstableMinter = await ethers.getContractAt(
      "ERC20StablecoinUpgradeable",
      await dStable.getAddress(),
      deployer
    );
    const MINTER_ROLE = await (dstableMinter as any).MINTER_ROLE();
    await dstableMinter.grantRole(MINTER_ROLE, deployer.address);
    await dstableMinter.mint(user1.address, depositAmount);

    // User approves and deposits into DStakeToken (uses underlying adapter)
    await dStable
      .connect(user1)
      .approve(await dStakeToken.getAddress(), depositAmount);
    await dStakeToken.connect(user1).deposit(depositAmount, user1.address);

    // ------------- Deploy wrapper adapter that overpays -------------
    const PositiveAdapterFactory = await ethers.getContractFactory(
      "PositiveSlippageAdapter",
      deployer
    );
    const positiveAdapter = await PositiveAdapterFactory.deploy(
      await (underlying as any).getAddress(),
      await dStable.getAddress()
    );
    await positiveAdapter.waitForDeployment();

    // Mint extra dStable to the adapter so it can pay bonus (10 %)
    const bonusAmount = depositAmount / 10n; // 10 % bonus pool
    await dstableMinter.mint(await positiveAdapter.getAddress(), bonusAmount);

    // ----------- Switch router to use the new adapter ------------
    // Admin (deployer) removes existing mapping & sets the wrapper
    await routerContract.connect(deployer).removeAdapter(vaultAssetAddress);
    const positiveAdapterAddress = await positiveAdapter.getAddress();
    await routerContract
      .connect(deployer)
      .addAdapter(vaultAssetAddress, positiveAdapterAddress);

    // ------------- Perform withdraw via DStakeToken ---------------
    // We impersonate the DStakeToken contract to call router.withdraw directly
    const dStakeTokenAddress = await dStakeToken.getAddress();
    const dStakeTokenSigner = await impersonateAndFund(dStakeTokenAddress);

    // Initial user balance
    const balBefore = await dStable.balanceOf(user1.address);

    // Withdraw the exact depositAmount
    await routerContract
      .connect(dStakeTokenSigner)
      .withdraw(depositAmount, user1.address, user1.address);

    const balAfter = await dStable.balanceOf(user1.address);
    const received = balAfter - balBefore;

    // Assertion: user received MORE than requested due to positive slippage
    expect(received).to.be.gt(depositAmount);
    // Extra should be roughly 10 % (allow some tolerance for rounding)
    const expectedMin = depositAmount + depositAmount / 20n; // >5 %
    expect(received).to.be.gte(expectedMin);
  });
});
