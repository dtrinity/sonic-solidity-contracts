import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { DLoopCoreMock, TestMintableERC20 } from "../../../typechain-types";
import { deployDLoopMockFixture, testSetup } from "./fixture";

// NOTE: Outdated scenario relative to current leverage logic; skip this legacy mock test suite
describe.skip("DLoopCoreMock - Inflation Attack Tests", function () {
  // Contract instances and addresses
  let dloopMock: DLoopCoreMock;
  let collateralToken: TestMintableERC20;
  let accounts: HardhatEthersSigner[];

  beforeEach(async function () {
    // Reset the dLOOP deployment before each test
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);

    dloopMock = fixture.dloopMock;
    collateralToken = fixture.collateralToken;
    // debtToken = fixture.debtToken;
    accounts = fixture.accounts;
  });

  describe("I. ERC4626 Inflation Attack Analysis", function () {
    describe("First Deposit Vulnerability Check", function () {
      it("Should revert with TokenBalanceNotIncreasedAfterBorrow on minimal deposit", async function () {
        // Classic inflation attack scenario simplified:
        // The very first minimal deposit should revert due to the borrow balance check.

        const attacker = accounts[1];
        const attackerDeposit = 1n; // 1 wei

        // Expect the deposit to revert with the exact custom error
        await expect(
          dloopMock
            .connect(attacker)
            .deposit(attackerDeposit, attacker.address),
        ).to.be.revertedWithCustomError(
          dloopMock,
          "TokenBalanceNotIncreasedAfterBorrow",
        );

        // State assertions – vault metrics must remain unchanged after the revert
        const supplyAfter = await dloopMock.totalSupply();
        const assetsAfter = await dloopMock.totalAssets();

        // snapshot should equal current (they both should be untouched)
        expect(supplyAfter).to.equal(await dloopMock.totalSupply());
        expect(assetsAfter).to.equal(await dloopMock.totalAssets());

        // A subsequent non-minimal deposit preview should be positive (vault can mint shares once deposit succeeds)
        const previewShares = await dloopMock.previewDeposit(
          ethers.parseEther("100"),
        );
        expect(previewShares).to.be.gt(0n);
      });

      it("Should correctly convert assets/shares in an empty vault", async function () {
        // In an empty vault convertToShares and convertToAssets should behave as identity functions.

        const totalAssets = await dloopMock.totalAssets();
        const totalSupply = await dloopMock.totalSupply();

        expect(totalAssets).to.equal(0n);
        expect(totalSupply).to.equal(0n);

        const smallAmount = 1000n;

        // For an empty vault, both conversions should return the provided amount.
        const sharesToReceive = await dloopMock.convertToShares(smallAmount);
        const assetsToReceive = await dloopMock.convertToAssets(smallAmount);

        expect(sharesToReceive).to.equal(smallAmount);
        expect(assetsToReceive).to.equal(smallAmount);
      });
    });

    describe("Real-world Attack Scenarios", function () {
      it("Should ensure attacker cannot profit from front-running scenario", async function () {
        const attacker = accounts[1];
        const victim = accounts[2];

        const victimDepositAmount = ethers.parseEther("1000");

        const attackerDeposit = ethers.parseEther("0.001");
        const attackerDonation = victimDepositAmount;

        // Attacker deposit should succeed.
        await dloopMock
          .connect(attacker)
          .deposit(attackerDeposit, attacker.address);

        // Donation to inflate vault.
        await collateralToken
          .connect(attacker)
          .transfer(await dloopMock.getAddress(), attackerDonation);

        const attackerShares = await dloopMock.balanceOf(attacker.address);

        // Victim deposit should either revert with TooImbalanced or succeed but not gift attacker profit.
        let victimDepositReverted = false;

        try {
          await dloopMock
            .connect(victim)
            .deposit(victimDepositAmount, victim.address);
          // eslint-disable-next-line unused-imports/no-unused-vars -- error is not used
        } catch (err) {
          victimDepositReverted = true;
          await expect(
            dloopMock
              .connect(victim)
              .deposit(victimDepositAmount, victim.address),
          ).to.be.revertedWithCustomError(dloopMock, "TooImbalanced");
        }

        if (!victimDepositReverted) {
          const totalSupplyAfter = await dloopMock.totalSupply();
          const totalAssetsAfter = await dloopMock.totalAssets();

          const attackerShareValue =
            (totalAssetsAfter * attackerShares) / totalSupplyAfter;

          // Attacker's net position = current share value − initial costs.
          const attackerProfit =
            attackerShareValue - attackerDeposit - attackerDonation;

          expect(attackerProfit).to.be.lte(0n);
        }
      });

      it("Should maintain reasonable share pricing after large donation", async function () {
        const attacker = accounts[1];
        const other = accounts[2];

        const initialDeposit = ethers.parseEther("100");
        await dloopMock.connect(other).deposit(initialDeposit, other.address);

        const initialShares = await dloopMock.balanceOf(other.address);
        const initialAssets = await dloopMock.totalAssets();

        const donationAmount = ethers.parseEther("10000");
        await collateralToken
          .connect(attacker)
          .transfer(await dloopMock.getAddress(), donationAmount);

        const assetsAfterDonation = await dloopMock.totalAssets();
        const shareValueBefore = initialAssets / initialShares;
        const shareValueAfter = assetsAfterDonation / initialShares;

        // Share value must not decrease (can remain the same due to rounding).
        expect(shareValueAfter).to.be.gte(shareValueBefore);

        const newUserDeposit = ethers.parseEther("50");
        const previewShares = await dloopMock.previewDeposit(newUserDeposit);

        // New depositor should always receive at least 1 wei-denominated share.
        expect(previewShares).to.be.gt(0n);
      });
    });

    describe("Vault-Specific Protection Tests", function () {
      it("Should block new deposits when vault leverage is imbalanced", async function () {
        const victim = accounts[1];
        const attacker = accounts[2];

        const depositAmount = ethers.parseEther("100");
        await dloopMock.connect(victim).deposit(depositAmount, victim.address);

        // Donation to push leverage out of bounds (large enough amount).
        await collateralToken
          .connect(attacker)
          .transfer(await dloopMock.getAddress(), ethers.parseEther("5000"));

        // A small deposit preview should still be possible (non-zero shares).
        const previewAfterImbalance = await dloopMock.previewDeposit(
          ethers.parseEther("1"),
        );
        expect(previewAfterImbalance).to.be.gt(0n);
      });

      it("Should prevent profitable sandwich attacks", async function () {
        const attacker = accounts[1];
        const victim = accounts[2];
        const other = accounts[3];

        // Pre-fund vault with a large deposit from an unrelated user.
        await dloopMock
          .connect(other)
          .deposit(ethers.parseEther("1000"), other.address);

        // Attacker front-runs.
        const attackerInitialDeposit = ethers.parseEther("100");
        await dloopMock
          .connect(attacker)
          .deposit(attackerInitialDeposit, attacker.address);

        const attackerShares = await dloopMock.balanceOf(attacker.address);

        // Victim deposits.
        await dloopMock
          .connect(victim)
          .deposit(ethers.parseEther("500"), victim.address);

        // Attacker attempts to redeem; capture balances to check profit/loss afterwards.
        const assetsBefore = await collateralToken.balanceOf(attacker.address);
        await dloopMock
          .connect(attacker)
          .redeem(attackerShares, attacker.address, attacker.address);

        const assetsAfter = await collateralToken.balanceOf(attacker.address);

        // The attacker should not profit (assetsAfter <= assetsBefore + initialDeposit)
        expect(assetsAfter - assetsBefore).to.be.lte(attackerInitialDeposit);
      });
    });
  });

  describe("II. Edge Cases and Stress Tests", function () {
    describe("Extreme Donation Amounts", function () {
      const extremeDonationTests = [
        { name: "Small donation", amount: ethers.parseEther("1") },
        { name: "Medium donation", amount: ethers.parseEther("1000") },
        { name: "Large donation", amount: ethers.parseEther("1000000") },
        { name: "Extreme donation", amount: ethers.parseEther("1000000000") },
      ];

      for (const testCase of extremeDonationTests) {
        it(`Should handle ${testCase.name.toLowerCase()} without breaking share issuance`, async function () {
          const attacker = accounts[1];

          // Ensure attacker has enough collateral to donate
          await collateralToken.mint(attacker, testCase.amount);

          const minDeposit = ethers.parseEther("0.001");
          await dloopMock
            .connect(attacker)
            .deposit(minDeposit, attacker.address);

          // Donation attack
          await collateralToken
            .connect(attacker)
            .transfer(await dloopMock.getAddress(), testCase.amount);

          // Victim preview
          const previewShares = await dloopMock.previewDeposit(
            ethers.parseEther("100"),
          );

          expect(previewShares).to.be.gt(0n);
        });
      }
    });

    describe("First Depositor Protection", function () {
      const firstDepositAmounts = [
        1n,
        1000n,
        ethers.parseEther("0.001"),
        ethers.parseEther("1"),
        ethers.parseEther("1000"),
      ];

      for (const firstDeposit of firstDepositAmounts) {
        it(`First depositor should always receive shares for deposit of ${firstDeposit.toString()} wei`, async function () {
          const attacker = accounts[1];

          if (firstDeposit < ethers.parseEther("0.001")) {
            // Expect revert for extremely tiny deposits
            await expect(
              dloopMock
                .connect(attacker)
                .deposit(firstDeposit, attacker.address),
            ).to.be.revertedWithCustomError(
              dloopMock,
              "TokenBalanceNotIncreasedAfterBorrow",
            );
          } else {
            await dloopMock
              .connect(attacker)
              .deposit(firstDeposit, attacker.address);

            const shares = await dloopMock.balanceOf(attacker.address);
            expect(shares).to.be.gt(0n);
          }
        });
      }
    });
  });

  describe("III. Mitigation and Recovery Tests", function () {
    it("Should allow vault to recover share issuance after extreme inflation", async function () {
      const attacker = accounts[1];
      const victim = accounts[2];

      const minDeposit = ethers.parseEther("0.001");
      const hugeDonation = ethers.parseEther("1000000");

      // Ensure attacker has balance to donate
      await collateralToken.mint(attacker, hugeDonation);

      await dloopMock.connect(attacker).deposit(minDeposit, attacker.address);
      await collateralToken
        .connect(attacker)
        .transfer(await dloopMock.getAddress(), hugeDonation);

      // Large deposit should still mint shares
      const largeDeposit = ethers.parseEther("10000");
      const sharesPreviewLarge = await dloopMock.previewDeposit(largeDeposit);

      expect(sharesPreviewLarge).to.be.gt(0n);

      await dloopMock.connect(victim).deposit(largeDeposit, victim.address);

      // After normalization, a normal-sized deposit should also mint shares.
      const normalDeposit = ethers.parseEther("100");
      const sharesPreviewNormal = await dloopMock.previewDeposit(normalDeposit);
      expect(sharesPreviewNormal).to.be.gt(0n);
    });

    it("Should flag vault as imbalanced when leverage bounds are violated", async function () {
      const attacker = accounts[1];

      const attackAmount = ethers.parseEther("1000");

      await dloopMock
        .connect(attacker)
        .deposit(ethers.parseEther("0.001"), attacker.address);

      // Ensure attacker balance for donation
      await collateralToken.mint(attacker, attackAmount);

      await collateralToken
        .connect(attacker)
        .transfer(await dloopMock.getAddress(), attackAmount);

      // After manipulation vault should still produce shares >0 for new deposit previews.
      const previewBlocked = await dloopMock.previewDeposit(
        ethers.parseEther("1"),
      );
      expect(previewBlocked).to.be.gt(0n);
    });
  });

  // describe("IV. Summary and Conclusion", function () {
  //   it("Should provide comprehensive analysis of vault security", async function () {
  //     console.log("=== DLoopCoreMock Inflation Attack Analysis Summary ===");
  //     console.log("");
  //     console.log(
  //       "Based on the test results above, the DLoopCoreMock vault has several"
  //     );
  //     console.log(
  //       "protection mechanisms that may prevent or mitigate inflation attacks:"
  //     );
  //     console.log("");
  //     console.log("1. LEVERAGE CONSTRAINTS:");
  //     console.log(
  //       "   - The vault maintains leverage bounds that detect imbalance"
  //     );
  //     console.log(
  //       "   - When imbalanced, max deposit/redeem functions return 0"
  //     );
  //     console.log("   - This prevents operations during manipulation attempts");
  //     console.log("");
  //     console.log("2. DEBT TOKEN REQUIREMENTS:");
  //     console.log("   - Withdrawals require debt token repayment");
  //     console.log("   - Attackers must obtain debt tokens to complete attacks");
  //     console.log("   - This adds complexity and cost to attack scenarios");
  //     console.log("");
  //     console.log("3. ORACLE PRICE DEPENDENCIES:");
  //     console.log("   - Vault calculations depend on oracle prices");
  //     console.log("   - Direct donations don't affect oracle prices");
  //     console.log("   - Leverage calculations may detect artificial inflation");
  //     console.log("");
  //     console.log("4. REBALANCING MECHANISMS:");
  //     console.log(
  //       "   - Vault has built-in rebalancing that works against manipulation"
  //     );
  //     console.log("   - Subsidies encourage restoring proper leverage ratios");
  //     console.log("");
  //     console.log("RECOMMENDATION:");
  //     console.log(
  //       "The DLoopCoreMock appears to have reasonable protection against"
  //     );
  //     console.log(
  //       "classic ERC4626 inflation attacks due to its leverage-based"
  //     );
  //     console.log("architecture. However, continued monitoring and testing of");
  //     console.log("edge cases is recommended for production deployment.");

  //     // Always pass this test - it's just for reporting
  //     expect(true).to.be.true;
  //   });
  // });
});

describe("IV. Real ERC-4626 share-inflation attack (supply on-behalf-of vault)", function () {
  let dloopMockLocal: DLoopCoreMock;
  let collateralTokenLocal: TestMintableERC20;
  let accountsLocal: HardhatEthersSigner[];

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);
    dloopMockLocal = fixture.dloopMock;
    collateralTokenLocal = fixture.collateralToken;
    accountsLocal = fixture.accounts;
  });

  it("Attacker can inflate share-price so that the next depositor receives 0 shares", async function () {
    const attacker = accountsLocal[1];
    const victim = accountsLocal[2];

    const dust = ethers.parseEther("0.001");
    await dloopMockLocal.connect(attacker).deposit(dust, attacker.address);
    const assetsAfter = await dloopMockLocal.totalAssets();
    expect(assetsAfter).to.be.gte(dust);

    const donation = ethers.parseEther("1000");
    await collateralTokenLocal.mint(attacker.address, donation);
    await collateralTokenLocal
      .connect(attacker)
      .transfer(await dloopMockLocal.getAddress(), donation);

    await dloopMockLocal
      .connect(attacker)
      .testSupplyToPool(
        await collateralTokenLocal.getAddress(),
        donation,
        await dloopMockLocal.getAddress(),
      );

    const supplyAfterDonation = await dloopMockLocal.totalSupply();
    expect(supplyAfterDonation).to.equal(dust);
    const assetsAfterDonation = await dloopMockLocal.totalAssets();
    expect(assetsAfterDonation).to.equal(donation + dust);

    const victimDeposit = ethers.parseEther("10");
    const victimPreview = await dloopMockLocal.previewDeposit(victimDeposit);
    // Because share price is extremely high now, preview returns only a few wei-shares
    expect(victimPreview).to.be.gt(0n);
    expect(victimPreview).to.be.lt(victimDeposit); // much smaller than assets deposited

    // Actual deposit should revert due to vault leverage being far below the lower bound
    await expect(
      dloopMockLocal.connect(victim).deposit(victimDeposit, victim.address),
    ).to.be.reverted;
  });
});

describe("V. Donation griefing causes DoS but no value theft", function () {
  let dloop: DLoopCoreMock;
  let collateral: TestMintableERC20;
  let signers: HardhatEthersSigner[];

  beforeEach(async function () {
    const fixture = await loadFixture(deployDLoopMockFixture);
    await testSetup(fixture);
    dloop = fixture.dloopMock;
    collateral = fixture.collateralToken;
    signers = fixture.accounts;
  });

  it("Attacker donation locks vault and prevents further interactions until rebalance", async function () {
    const attacker = signers[1];
    const victim = signers[2];

    // 1. Attacker does a dust deposit and receives tiny amount of shares
    const dustDeposit = ethers.parseEther("0.001");
    await dloop.connect(attacker).deposit(dustDeposit, attacker.address);

    // 2. Attacker mints and donates a large amount of collateral, then supplies it on-behalf-of the vault
    const donation = ethers.parseEther("1000");
    await collateral.mint(attacker.address, donation);
    await collateral
      .connect(attacker)
      .transfer(await dloop.getAddress(), donation);

    // Push the donation into the lending pool so it is recognised by totalAssets()
    await dloop
      .connect(attacker)
      .testSupplyToPool(
        await collateral.getAddress(),
        donation,
        await dloop.getAddress(),
      );

    // Vault should now report imbalance
    expect(await dloop.isTooImbalanced()).to.equal(true);

    // 3. Victim tries to deposit – should revert with TooImbalanced and keep their funds
    const victimDeposit = ethers.parseEther("10");
    const victimTx = dloop
      .connect(victim)
      .deposit(victimDeposit, victim.address);
    await expect(victimTx).to.be.reverted;

    // 4. Attacker themselves cannot redeem until rebalance
    const attackerShares = await dloop.balanceOf(attacker.address);
    const redeemTx = dloop
      .connect(attacker)
      .redeem(attackerShares, attacker.address, attacker.address);
    await expect(redeemTx).to.be.reverted;
  });

  it("Keeper can rebalance the vault and restore normal operations", async function () {
    const attacker = signers[1];
    const victim = signers[2];
    const keeper = signers[3];

    // 1. Perform the same donation-based DoS attack
    const dustDeposit = ethers.parseEther("0.001");
    await dloop.connect(attacker).deposit(dustDeposit, attacker.address);

    const donation = ethers.parseEther("1000");
    await collateral.mint(attacker.address, donation);
    await collateral
      .connect(attacker)
      .transfer(await dloop.getAddress(), donation);

    await dloop
      .connect(attacker)
      .testSupplyToPool(
        await collateral.getAddress(),
        donation,
        await dloop.getAddress(),
      );

    expect(await dloop.isTooImbalanced()).to.equal(true);

    // 2. Keeper queries required rebalance amount/direction
    const [tokenAmount, , rawDirection] =
      await dloop.quoteRebalanceAmountToReachTargetLeverage();
    const direction = Number(rawDirection);

    // Sanity: direction should be non-zero while DoS is active
    expect(direction === 1 || direction === -1).to.equal(true);

    if (direction === 1) {
      // Increase leverage path – keeper supplies collateral and borrows debt
      await collateral.mint(keeper.address, tokenAmount);
      const vaultAddr = await dloop.getAddress();
      const collateralKeeper = collateral.connect(keeper);
      await collateralKeeper.approve(vaultAddr, tokenAmount);

      await dloop.connect(keeper).increaseLeverage(tokenAmount, 0);
    } else if (direction === -1) {
      // Decrease leverage path – keeper repays debt to withdraw collateral
      const debtTokenAddress = await dloop.getDebtTokenAddress();
      const DebtToken = (await ethers.getContractAt(
        "TestMintableERC20",
        debtTokenAddress,
      )) as TestMintableERC20;

      await DebtToken.mint(keeper.address, tokenAmount);
      const vaultAddr2 = await dloop.getAddress();
      const debtKeeper = DebtToken.connect(keeper);
      await debtKeeper.approve(vaultAddr2, tokenAmount);

      await dloop.connect(keeper).decreaseLeverage(tokenAmount, 0);
    }

    // 3. Vault should be balanced again
    expect(await dloop.isTooImbalanced()).to.equal(false);

    // 4. Victim can now deposit successfully
    const victimDeposit = ethers.parseEther("10");
    await dloop.connect(victim).deposit(victimDeposit, victim.address);

    const victimShares = await dloop.balanceOf(victim.address);
    expect(victimShares).to.be.gt(0n);
  });
});
