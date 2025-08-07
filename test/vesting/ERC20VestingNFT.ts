import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { deployments, ethers, getNamedAccounts, network } from "hardhat";

import {
  ERC20VestingNFT,
  TestERC20,
  TestMintableERC20,
} from "../../typechain-types";

// Test fixture for ERC20VestingNFT - minimal setup without dStake dependencies
const createVestingFixture = deployments.createFixture(
  async ({ deployments }) => {
    // Don't run any deployment scripts - just deploy what we need for testing

    const { deployer, user1, user2 } = await getNamedAccounts();
    const deployerSigner = await ethers.getSigner(deployer);
    const user1Signer = await ethers.getSigner(user1);
    const user2Signer = await ethers.getSigner(user2);

    // Deploy mock dSTAKE token for testing
    const mockDStakeToken = await deployments.deploy("MockDStakeToken", {
      from: deployer,
      contract: "TestMintableERC20",
      args: ["Mock dSTAKE Token", "dSTAKE", 18],
      log: false,
    });

    const dstakeToken = (await ethers.getContractAt(
      "TestMintableERC20",
      mockDStakeToken.address,
    )) as TestMintableERC20;

    // 6 months in seconds
    const VESTING_PERIOD = 180 * 24 * 60 * 60;
    const MAX_TOTAL_SUPPLY = ethers.parseUnits("1000000", 18);

    // Deploy ERC20VestingNFT directly without using the deployment script
    const vestingNFTDeployment = await deployments.deploy(
      "TestERC20VestingNFT",
      {
        from: deployer,
        contract: "ERC20VestingNFT",
        args: [
          "Test dSTAKE Vesting NFT",
          "TEST-dVEST",
          mockDStakeToken.address,
          VESTING_PERIOD,
          MAX_TOTAL_SUPPLY,
          0,
          deployer,
        ],
        log: false,
      },
    );

    const vestingNFT = await ethers.getContractAt(
      "ERC20VestingNFT",
      vestingNFTDeployment.address,
    );

    return {
      vestingNFT,
      dstakeToken,
      deployer: deployerSigner,
      user1: user1Signer,
      user2: user2Signer,
      VESTING_PERIOD,
      MAX_TOTAL_SUPPLY,
    };
  },
);

describe("ERC20VestingNFT", function () {
  let vestingNFT: any;
  let dstakeToken: TestMintableERC20;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let VESTING_PERIOD: number;
  let MAX_TOTAL_SUPPLY: bigint;

  beforeEach(async function () {
    const fixture = await createVestingFixture();
    vestingNFT = fixture.vestingNFT;
    dstakeToken = fixture.dstakeToken;
    deployer = fixture.deployer;
    user1 = fixture.user1;
    user2 = fixture.user2;
    VESTING_PERIOD = fixture.VESTING_PERIOD;
    MAX_TOTAL_SUPPLY = fixture.MAX_TOTAL_SUPPLY;
  });

  describe("Contract Deployment & Initialization", function () {
    it("Should deploy with valid parameters", async function () {
      expect(await vestingNFT.name()).to.equal("Test dSTAKE Vesting NFT");
      expect(await vestingNFT.symbol()).to.equal("TEST-dVEST");
      expect(await vestingNFT.dstakeToken()).to.equal(
        await dstakeToken.getAddress(),
      );
      expect(await vestingNFT.vestingPeriod()).to.equal(VESTING_PERIOD);
      expect(await vestingNFT.maxTotalSupply()).to.equal(MAX_TOTAL_SUPPLY);
      expect(await vestingNFT.owner()).to.equal(deployer.address);
      expect(await vestingNFT.depositsEnabled()).to.be.true;
      expect(await vestingNFT.totalDeposited()).to.equal(0);
    });

    it("Should revert deployment with zero dSTAKE token address", async function () {
      await expect(
        deployments.deploy("InvalidVestingNFT1", {
          from: deployer.address,
          contract: "ERC20VestingNFT",
          args: [
            "Test Name",
            "TEST",
            ZeroAddress,
            VESTING_PERIOD,
            MAX_TOTAL_SUPPLY,
            0,
            deployer.address,
          ],
          log: false,
        }),
      ).to.be.revertedWithCustomError(vestingNFT, "ZeroAddress");
    });

    it("Should revert deployment with zero initial owner", async function () {
      // We need to create a contract factory to test constructor errors properly
      const ERC20VestingNFTFactory =
        await ethers.getContractFactory("ERC20VestingNFT");

      await expect(
        ERC20VestingNFTFactory.deploy(
          "Test Name",
          "TEST",
          await dstakeToken.getAddress(),
          VESTING_PERIOD,
          MAX_TOTAL_SUPPLY,
          0,
          ZeroAddress,
        ),
      ).to.be.revertedWithCustomError(
        ERC20VestingNFTFactory,
        "OwnableInvalidOwner",
      );
    });

    it("Should revert deployment with zero vesting period", async function () {
      await expect(
        deployments.deploy("InvalidVestingNFT3", {
          from: deployer.address,
          contract: "ERC20VestingNFT",
          args: [
            "Test Name",
            "TEST",
            await dstakeToken.getAddress(),
            0,
            MAX_TOTAL_SUPPLY,
            0,
            deployer.address,
          ],
          log: false,
        }),
      ).to.be.revertedWithCustomError(vestingNFT, "ZeroAmount");
    });

    it("Should revert deployment with zero max total supply", async function () {
      await expect(
        deployments.deploy("InvalidVestingNFT4", {
          from: deployer.address,
          contract: "ERC20VestingNFT",
          args: [
            "Test Name",
            "TEST",
            await dstakeToken.getAddress(),
            VESTING_PERIOD,
            0,
            0,
            deployer.address,
          ],
          log: false,
        }),
      ).to.be.revertedWithCustomError(vestingNFT, "ZeroAmount");
    });
  });

  describe("Deposit Functionality", function () {
    const depositAmount = ethers.parseUnits("100", 18);

    beforeEach(async function () {
      // Mint tokens to users and approve the vesting contract
      await dstakeToken.mint(user1.address, depositAmount * 10n);
      await dstakeToken.mint(user2.address, depositAmount * 10n);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), depositAmount * 10n);
      await dstakeToken
        .connect(user2)
        .approve(await vestingNFT.getAddress(), depositAmount * 10n);
    });

    it("Should successfully deposit and mint NFT", async function () {
      const tx = await vestingNFT.connect(user1).deposit(depositAmount);
      const receipt = await tx.wait();

      // Check event emission
      await expect(tx)
        .to.emit(vestingNFT, "Deposited")
        .withArgs(user1.address, 1, depositAmount);

      // Check NFT ownership
      expect(await vestingNFT.ownerOf(1)).to.equal(user1.address);
      expect(await vestingNFT.balanceOf(user1.address)).to.equal(1);

      // Check vesting position
      const position = await vestingNFT.vestingPositions(1);
      expect(position.amount).to.equal(depositAmount);
      expect(position.matured).to.be.false;

      // Check total deposited
      expect(await vestingNFT.totalDeposited()).to.equal(depositAmount);

      // Check token transfers
      expect(await dstakeToken.balanceOf(user1.address)).to.equal(
        depositAmount * 9n,
      );
      expect(
        await dstakeToken.balanceOf(await vestingNFT.getAddress()),
      ).to.equal(depositAmount);
    });

    it("Should revert deposit with zero amount", async function () {
      await expect(
        vestingNFT.connect(user1).deposit(0),
      ).to.be.revertedWithCustomError(vestingNFT, "ZeroAmount");
    });

    it("Should revert deposit when deposits are disabled", async function () {
      await vestingNFT.connect(deployer).setDepositsEnabled(false);
      await expect(
        vestingNFT.connect(user1).deposit(depositAmount),
      ).to.be.revertedWithCustomError(vestingNFT, "DepositsDisabled");
    });

    it("Should revert deposit exceeding max total supply", async function () {
      // Set a low max supply
      await vestingNFT.connect(deployer).setMaxTotalSupply(depositAmount / 2n);
      await expect(
        vestingNFT.connect(user1).deposit(depositAmount),
      ).to.be.revertedWithCustomError(vestingNFT, "MaxSupplyExceeded");
    });

    it("Should handle multiple deposits from different users", async function () {
      await vestingNFT.connect(user1).deposit(depositAmount);
      await vestingNFT.connect(user2).deposit(depositAmount * 2n);

      expect(await vestingNFT.ownerOf(1)).to.equal(user1.address);
      expect(await vestingNFT.ownerOf(2)).to.equal(user2.address);
      expect(await vestingNFT.totalDeposited()).to.equal(depositAmount * 3n);

      const position1 = await vestingNFT.vestingPositions(1);
      const position2 = await vestingNFT.vestingPositions(2);
      expect(position1.amount).to.equal(depositAmount);
      expect(position2.amount).to.equal(depositAmount * 2n);
    });

    it("Should revert deposit below minimum threshold", async function () {
      const threshold = ethers.parseUnits("150", 18);
      await vestingNFT.connect(deployer).setMinDepositAmount(threshold);
      await expect(
        vestingNFT.connect(user1).deposit(depositAmount),
      ).to.be.revertedWithCustomError(vestingNFT, "DepositBelowMinimum");
    });

    it("Should allow deposit equal to or above minimum threshold", async function () {
      const threshold = ethers.parseUnits("50", 18);
      await vestingNFT.connect(deployer).setMinDepositAmount(threshold);
      await expect(vestingNFT.connect(user1).deposit(depositAmount)).to.not.be
        .reverted;
    });
  });

  describe("Early Redemption Functionality", function () {
    const depositAmount = ethers.parseUnits("100", 18);

    beforeEach(async function () {
      await dstakeToken.mint(user1.address, depositAmount);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), depositAmount);
      await vestingNFT.connect(user1).deposit(depositAmount);
    });

    it("Should successfully redeem early", async function () {
      const initialBalance = await dstakeToken.balanceOf(user1.address);

      const tx = await vestingNFT.connect(user1).redeemEarly(1);

      await expect(tx)
        .to.emit(vestingNFT, "RedeemedEarly")
        .withArgs(user1.address, 1, depositAmount);

      // Check NFT is burned
      await expect(vestingNFT.ownerOf(1)).to.be.reverted;

      // Check vesting position is deleted
      const position = await vestingNFT.vestingPositions(1);
      expect(position.amount).to.equal(0);

      // Check total deposited is updated
      expect(await vestingNFT.totalDeposited()).to.equal(0);

      // Check token is returned
      expect(await dstakeToken.balanceOf(user1.address)).to.equal(
        initialBalance + depositAmount,
      );
      expect(
        await dstakeToken.balanceOf(await vestingNFT.getAddress()),
      ).to.equal(0);
    });

    it("Should revert redeem early for non-existent token", async function () {
      await expect(
        vestingNFT.connect(user1).redeemEarly(99),
      ).to.be.revertedWithCustomError(vestingNFT, "TokenNotExists");
    });

    it("Should revert redeem early for token not owned by caller", async function () {
      await expect(
        vestingNFT.connect(user2).redeemEarly(1),
      ).to.be.revertedWithCustomError(vestingNFT, "NotTokenOwner");
    });

    it("Should revert redeem early when vesting is complete", async function () {
      // Fast forward past vesting period
      await time.increase(VESTING_PERIOD + 1);

      await expect(
        vestingNFT.connect(user1).redeemEarly(1),
      ).to.be.revertedWithCustomError(vestingNFT, "VestingAlreadyComplete");
    });

    it("Should revert redeem early for matured token", async function () {
      // Fast forward and withdraw matured
      await time.increase(VESTING_PERIOD + 1);
      await vestingNFT.connect(user1).withdrawMatured(1);

      await expect(
        vestingNFT.connect(user1).redeemEarly(1),
      ).to.be.revertedWithCustomError(vestingNFT, "TokenAlreadyMatured");
    });
  });

  describe("Matured Withdrawal Functionality", function () {
    const depositAmount = ethers.parseUnits("100", 18);

    beforeEach(async function () {
      await dstakeToken.mint(user1.address, depositAmount);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), depositAmount);
      await vestingNFT.connect(user1).deposit(depositAmount);
    });

    it("Should successfully withdraw matured", async function () {
      // Fast forward past vesting period
      await time.increase(VESTING_PERIOD + 1);

      const initialBalance = await dstakeToken.balanceOf(user1.address);

      const tx = await vestingNFT.connect(user1).withdrawMatured(1);

      await expect(tx)
        .to.emit(vestingNFT, "WithdrawnMatured")
        .withArgs(user1.address, 1, depositAmount);

      // Check NFT still exists but is matured
      expect(await vestingNFT.ownerOf(1)).to.equal(user1.address);

      const position = await vestingNFT.vestingPositions(1);
      expect(position.amount).to.equal(depositAmount);
      expect(position.matured).to.be.true;

      // Check total deposited is updated
      expect(await vestingNFT.totalDeposited()).to.equal(0);

      // Check token is returned
      expect(await dstakeToken.balanceOf(user1.address)).to.equal(
        initialBalance + depositAmount,
      );
      expect(
        await dstakeToken.balanceOf(await vestingNFT.getAddress()),
      ).to.equal(0);
    });

    it("Should revert withdraw matured for non-existent token", async function () {
      await expect(
        vestingNFT.connect(user1).withdrawMatured(99),
      ).to.be.revertedWithCustomError(vestingNFT, "TokenNotExists");
    });

    it("Should revert withdraw matured for token not owned by caller", async function () {
      await time.increase(VESTING_PERIOD + 1);
      await expect(
        vestingNFT.connect(user2).withdrawMatured(1),
      ).to.be.revertedWithCustomError(vestingNFT, "NotTokenOwner");
    });

    it("Should revert withdraw matured before vesting period ends", async function () {
      await expect(
        vestingNFT.connect(user1).withdrawMatured(1),
      ).to.be.revertedWithCustomError(vestingNFT, "VestingNotComplete");
    });

    it("Should revert withdraw matured if already matured", async function () {
      await time.increase(VESTING_PERIOD + 1);
      await vestingNFT.connect(user1).withdrawMatured(1);

      await expect(
        vestingNFT.connect(user1).withdrawMatured(1),
      ).to.be.revertedWithCustomError(vestingNFT, "TokenAlreadyMatured");
    });
  });

  describe("NFT Transfer Logic (Soul-bound Feature)", function () {
    const depositAmount = ethers.parseUnits("100", 18);

    beforeEach(async function () {
      await dstakeToken.mint(user1.address, depositAmount);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), depositAmount);
      await vestingNFT.connect(user1).deposit(depositAmount);
    });

    it("Should allow transfer of non-matured NFT", async function () {
      await vestingNFT
        .connect(user1)
        .transferFrom(user1.address, user2.address, 1);
      expect(await vestingNFT.ownerOf(1)).to.equal(user2.address);
    });

    it("Should prevent transfer of matured NFT", async function () {
      // Fast forward and withdraw matured
      await time.increase(VESTING_PERIOD + 1);
      await vestingNFT.connect(user1).withdrawMatured(1);

      await expect(
        vestingNFT.connect(user1).transferFrom(user1.address, user2.address, 1),
      ).to.be.revertedWithCustomError(vestingNFT, "TransferOfMaturedToken");
    });

    it("Should allow new owner to redeem early after transfer", async function () {
      await vestingNFT
        .connect(user1)
        .transferFrom(user1.address, user2.address, 1);

      // user1 should not be able to redeem
      await expect(
        vestingNFT.connect(user1).redeemEarly(1),
      ).to.be.revertedWithCustomError(vestingNFT, "NotTokenOwner");

      // user2 should be able to redeem
      await expect(vestingNFT.connect(user2).redeemEarly(1)).to.not.be.reverted;
    });
  });

  describe("Owner Functions", function () {
    describe("setDepositsEnabled", function () {
      it("Should allow owner to disable deposits", async function () {
        const tx = await vestingNFT.connect(deployer).setDepositsEnabled(false);

        await expect(tx).to.emit(vestingNFT, "DepositsToggled").withArgs(false);

        expect(await vestingNFT.depositsEnabled()).to.be.false;
      });

      it("Should allow owner to re-enable deposits", async function () {
        await vestingNFT.connect(deployer).setDepositsEnabled(false);
        const tx = await vestingNFT.connect(deployer).setDepositsEnabled(true);

        await expect(tx).to.emit(vestingNFT, "DepositsToggled").withArgs(true);

        expect(await vestingNFT.depositsEnabled()).to.be.true;
      });

      it("Should revert if non-owner tries to set deposits enabled", async function () {
        await expect(
          vestingNFT.connect(user1).setDepositsEnabled(false),
        ).to.be.revertedWithCustomError(
          vestingNFT,
          "OwnableUnauthorizedAccount",
        );
      });
    });

    describe("setMaxTotalSupply", function () {
      it("Should allow owner to update max total supply", async function () {
        const newMaxSupply = ethers.parseUnits("2000000", 18);
        const tx = await vestingNFT
          .connect(deployer)
          .setMaxTotalSupply(newMaxSupply);

        await expect(tx)
          .to.emit(vestingNFT, "MaxTotalSupplyUpdated")
          .withArgs(newMaxSupply);

        expect(await vestingNFT.maxTotalSupply()).to.equal(newMaxSupply);
      });

      it("Should allow setting max supply below current total deposited", async function () {
        // Make a deposit first
        const depositAmount = ethers.parseUnits("100", 18);
        await dstakeToken.mint(user1.address, depositAmount);
        await dstakeToken
          .connect(user1)
          .approve(await vestingNFT.getAddress(), depositAmount);
        await vestingNFT.connect(user1).deposit(depositAmount);

        // Set max supply below current deposits - should succeed
        const newMaxSupply = depositAmount / 2n;
        const tx = await vestingNFT
          .connect(deployer)
          .setMaxTotalSupply(newMaxSupply);

        await expect(tx)
          .to.emit(vestingNFT, "MaxTotalSupplyUpdated")
          .withArgs(newMaxSupply);

        expect(await vestingNFT.maxTotalSupply()).to.equal(newMaxSupply);

        // New deposits should be blocked until total deposited drops below cap
        await expect(
          vestingNFT.connect(user1).deposit(1),
        ).to.be.revertedWithCustomError(vestingNFT, "MaxSupplyExceeded");
      });

      it("Should allow deposits to resume after withdrawals bring total below new cap", async function () {
        // Setup: Make deposits from two users
        const depositAmount = ethers.parseUnits("100", 18);
        await dstakeToken.mint(user1.address, depositAmount);
        await dstakeToken.mint(user2.address, depositAmount);
        await dstakeToken
          .connect(user1)
          .approve(await vestingNFT.getAddress(), depositAmount);
        await dstakeToken
          .connect(user2)
          .approve(await vestingNFT.getAddress(), depositAmount);

        await vestingNFT.connect(user1).deposit(depositAmount);
        await vestingNFT.connect(user2).deposit(depositAmount);

        expect(await vestingNFT.totalDeposited()).to.equal(depositAmount * 2n);

        // Set max supply below current total deposited
        const newMaxSupply = depositAmount + depositAmount / 2n; // 150 tokens
        await vestingNFT.connect(deployer).setMaxTotalSupply(newMaxSupply);

        // New deposits should be blocked
        await expect(
          vestingNFT.connect(user1).deposit(1),
        ).to.be.revertedWithCustomError(vestingNFT, "MaxSupplyExceeded");

        // User1 redeems early, reducing total deposited
        await vestingNFT.connect(user1).redeemEarly(1);
        expect(await vestingNFT.totalDeposited()).to.equal(depositAmount);

        // Now deposits should be allowed again since total < maxSupply
        const smallDeposit = ethers.parseUnits("10", 18);
        await dstakeToken.mint(user1.address, smallDeposit);
        await dstakeToken
          .connect(user1)
          .approve(await vestingNFT.getAddress(), smallDeposit);

        await expect(vestingNFT.connect(user1).deposit(smallDeposit)).to.not.be
          .reverted;
        expect(await vestingNFT.totalDeposited()).to.equal(
          depositAmount + smallDeposit,
        );
      });

      it("Should revert if non-owner tries to set max total supply", async function () {
        await expect(
          vestingNFT
            .connect(user1)
            .setMaxTotalSupply(ethers.parseUnits("2000000", 18)),
        ).to.be.revertedWithCustomError(
          vestingNFT,
          "OwnableUnauthorizedAccount",
        );
      });
    });

    describe("setMinDepositAmount", function () {
      it("Should allow owner to update minimum deposit amount", async function () {
        const newMinDeposit = ethers.parseUnits("1000", 18);
        const tx = await vestingNFT
          .connect(deployer)
          .setMinDepositAmount(newMinDeposit);

        await expect(tx)
          .to.emit(vestingNFT, "MinDepositAmountUpdated")
          .withArgs(newMinDeposit);

        expect(await vestingNFT.minDepositAmount()).to.equal(newMinDeposit);
      });

      it("Should allow setting minimum deposit to zero", async function () {
        // First set a non-zero value
        await vestingNFT
          .connect(deployer)
          .setMinDepositAmount(ethers.parseUnits("100", 18));

        // Then set to zero
        const tx = await vestingNFT.connect(deployer).setMinDepositAmount(0);

        await expect(tx)
          .to.emit(vestingNFT, "MinDepositAmountUpdated")
          .withArgs(0);

        expect(await vestingNFT.minDepositAmount()).to.equal(0);
      });

      it("Should revert if non-owner tries to set minimum deposit amount", async function () {
        await expect(
          vestingNFT
            .connect(user1)
            .setMinDepositAmount(ethers.parseUnits("1000", 18)),
        ).to.be.revertedWithCustomError(
          vestingNFT,
          "OwnableUnauthorizedAccount",
        );
      });

      it("Should enforce new minimum deposit amount immediately", async function () {
        const depositAmount = ethers.parseUnits("100", 18);
        const newMinDeposit = ethers.parseUnits("150", 18);

        // Setup tokens - need enough for all deposits: 100 + 100 + 150 = 350
        await dstakeToken.mint(user1.address, ethers.parseUnits("400", 18));
        await dstakeToken
          .connect(user1)
          .approve(await vestingNFT.getAddress(), ethers.parseUnits("400", 18));

        // First deposit should work with default min (0)
        await expect(vestingNFT.connect(user1).deposit(depositAmount)).to.not.be
          .reverted;

        // Set new minimum
        await vestingNFT.connect(deployer).setMinDepositAmount(newMinDeposit);

        // Second deposit should fail
        await expect(
          vestingNFT.connect(user1).deposit(depositAmount),
        ).to.be.revertedWithCustomError(vestingNFT, "DepositBelowMinimum");

        // Deposit with amount >= minimum should work
        await expect(vestingNFT.connect(user1).deposit(newMinDeposit)).to.not.be
          .reverted;
      });
    });
  });

  describe("View Functions", function () {
    const depositAmount = ethers.parseUnits("100", 18);

    beforeEach(async function () {
      await dstakeToken.mint(user1.address, depositAmount);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), depositAmount);
      await vestingNFT.connect(user1).deposit(depositAmount);
    });

    describe("isVestingComplete", function () {
      it("Should return false before vesting period ends", async function () {
        expect(await vestingNFT.isVestingComplete(1)).to.be.false;
      });

      it("Should return true after vesting period ends", async function () {
        await time.increase(VESTING_PERIOD + 1);
        expect(await vestingNFT.isVestingComplete(1)).to.be.true;
      });

      it("Should return false for non-existent token", async function () {
        expect(await vestingNFT.isVestingComplete(99)).to.be.false;
      });
    });

    describe("getRemainingVestingTime", function () {
      it("Should return positive value while vesting", async function () {
        const remaining = await vestingNFT.getRemainingVestingTime(1);
        expect(remaining).to.be.gt(0);
        expect(remaining).to.be.lte(VESTING_PERIOD);
      });

      it("Should return 0 after vesting complete", async function () {
        await time.increase(VESTING_PERIOD + 1);
        expect(await vestingNFT.getRemainingVestingTime(1)).to.equal(0);
      });

      it("Should revert for non-existent token", async function () {
        await expect(
          vestingNFT.getRemainingVestingTime(99),
        ).to.be.revertedWithCustomError(vestingNFT, "TokenNotExists");
      });
    });

    describe("getVestingPosition", function () {
      it("Should return correct details for active position", async function () {
        const [amount, depositTime, matured, vestingComplete] =
          await vestingNFT.getVestingPosition(1);

        expect(amount).to.equal(depositAmount);
        expect(depositTime).to.be.gt(0);
        expect(matured).to.be.false;
        expect(vestingComplete).to.be.false;
      });

      it("Should return correct details after vesting ends", async function () {
        await time.increase(VESTING_PERIOD + 1);

        const [amount, depositTime, matured, vestingComplete] =
          await vestingNFT.getVestingPosition(1);

        expect(amount).to.equal(depositAmount);
        expect(depositTime).to.be.gt(0);
        expect(matured).to.be.false;
        expect(vestingComplete).to.be.true;
      });

      it("Should return correct details after matured withdrawal", async function () {
        await time.increase(VESTING_PERIOD + 1);
        await vestingNFT.connect(user1).withdrawMatured(1);

        const [amount, depositTime, matured, vestingComplete] =
          await vestingNFT.getVestingPosition(1);

        expect(amount).to.equal(depositAmount);
        expect(depositTime).to.be.gt(0);
        expect(matured).to.be.true;
        expect(vestingComplete).to.be.true;
      });

      it("Should return zeros for non-existent token", async function () {
        const [amount, depositTime, matured, vestingComplete] =
          await vestingNFT.getVestingPosition(99);

        expect(amount).to.equal(0);
        expect(depositTime).to.equal(0);
        expect(matured).to.be.false;
        expect(vestingComplete).to.be.false;
      });

      it("Should return zeros for early redeemed token", async function () {
        await vestingNFT.connect(user1).redeemEarly(1);

        const [amount, depositTime, matured, vestingComplete] =
          await vestingNFT.getVestingPosition(1);

        expect(amount).to.equal(0);
        expect(depositTime).to.equal(0);
        expect(matured).to.be.false;
        expect(vestingComplete).to.be.false;
      });
    });
  });

  describe("Edge Cases & Interactions", function () {
    const depositAmount = ethers.parseUnits("100", 18);

    it("Should handle operations on transferred tokens correctly", async function () {
      await dstakeToken.mint(user1.address, depositAmount);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), depositAmount);
      await vestingNFT.connect(user1).deposit(depositAmount);

      // Transfer NFT to user2
      await vestingNFT
        .connect(user1)
        .transferFrom(user1.address, user2.address, 1);

      // user1 should not be able to redeem
      await expect(
        vestingNFT.connect(user1).redeemEarly(1),
      ).to.be.revertedWithCustomError(vestingNFT, "NotTokenOwner");

      // user2 should be able to redeem
      await expect(vestingNFT.connect(user2).redeemEarly(1)).to.not.be.reverted;
    });

    it("Should correctly track totalDeposited through multiple operations", async function () {
      const amount1 = ethers.parseUnits("100", 18);
      const amount2 = ethers.parseUnits("200", 18);

      // Setup tokens
      await dstakeToken.mint(user1.address, amount1);
      await dstakeToken.mint(user2.address, amount2);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), amount1);
      await dstakeToken
        .connect(user2)
        .approve(await vestingNFT.getAddress(), amount2);

      // Both users deposit
      await vestingNFT.connect(user1).deposit(amount1);
      await vestingNFT.connect(user2).deposit(amount2);
      expect(await vestingNFT.totalDeposited()).to.equal(amount1 + amount2);

      // user1 redeems early
      await vestingNFT.connect(user1).redeemEarly(1);
      expect(await vestingNFT.totalDeposited()).to.equal(amount2);

      // user2 withdraws matured
      await time.increase(VESTING_PERIOD + 1);
      await vestingNFT.connect(user2).withdrawMatured(2);
      expect(await vestingNFT.totalDeposited()).to.equal(0);
    });

    it("Should handle max supply interactions correctly", async function () {
      const maxSupply = ethers.parseUnits("500", 18);
      await vestingNFT.connect(deployer).setMaxTotalSupply(maxSupply);

      // Setup tokens
      await dstakeToken.mint(user1.address, maxSupply);
      await dstakeToken.mint(user2.address, maxSupply);
      await dstakeToken
        .connect(user1)
        .approve(await vestingNFT.getAddress(), maxSupply);
      await dstakeToken
        .connect(user2)
        .approve(await vestingNFT.getAddress(), maxSupply);

      // user1 deposits full amount
      await vestingNFT.connect(user1).deposit(maxSupply);

      // user2 should not be able to deposit
      await expect(
        vestingNFT.connect(user2).deposit(1),
      ).to.be.revertedWithCustomError(vestingNFT, "MaxSupplyExceeded");

      // After user1 redeems, user2 should be able to deposit
      await vestingNFT.connect(user1).redeemEarly(1);
      await expect(vestingNFT.connect(user2).deposit(maxSupply)).to.not.be
        .reverted;
    });
  });
});

/**
 *
 */
async function deployVestingFixture() {
  const [owner] = await ethers.getSigners();

  // Deploy mock ERC20 token (dSTAKE)
  const TestERC20Factory = await ethers.getContractFactory("TestERC20");
  const dstakeToken = (await TestERC20Factory.deploy(
    "dSTAKE",
    "dSTAKE",
    18,
  )) as TestERC20;

  // Parameters
  const VESTING_PERIOD = 60; // 60 seconds for tests
  const MAX_TOTAL_SUPPLY = ethers.parseEther("1000000");
  const MIN_DEPOSIT_AMOUNT = 0;

  // Deploy ERC20VestingNFT contract
  const VestingNFTFactory = await ethers.getContractFactory("ERC20VestingNFT");
  const vestingNFT = (await VestingNFTFactory.deploy(
    "Vesting NFT",
    "vNFT",
    await dstakeToken.getAddress(),
    VESTING_PERIOD,
    MAX_TOTAL_SUPPLY,
    MIN_DEPOSIT_AMOUNT,
    owner.address,
  )) as ERC20VestingNFT;

  // Approve and deposit tokens
  const depositAmount = ethers.parseEther("100");
  await dstakeToken.approve(await vestingNFT.getAddress(), depositAmount);
  const tx = await vestingNFT.deposit(depositAmount);
  await tx.wait();

  const tokenId = 1; // first minted token ID

  return { vestingNFT, dstakeToken, VESTING_PERIOD, tokenId };
}

describe("ERC20VestingNFT: getRemainingVestingTime", function () {
  it("reverts with TokenNotExists for an invalid tokenId", async function () {
    const { vestingNFT } = await loadFixture(deployVestingFixture);

    await expect(
      vestingNFT.getRemainingVestingTime(999),
    ).to.be.revertedWithCustomError(vestingNFT, "TokenNotExists");
  });

  it("returns remaining time > 0 while vesting in progress", async function () {
    const { vestingNFT, tokenId } = await loadFixture(deployVestingFixture);

    const remaining = await vestingNFT.getRemainingVestingTime(tokenId);
    expect(remaining).to.be.gt(0n);
  });

  it("returns 0 after vesting period has elapsed", async function () {
    const { vestingNFT, VESTING_PERIOD, tokenId } =
      await loadFixture(deployVestingFixture);

    // Increase time to beyond vesting period
    await network.provider.send("evm_increaseTime", [VESTING_PERIOD]);
    await network.provider.send("evm_mine");

    const remaining = await vestingNFT.getRemainingVestingTime(tokenId);
    expect(remaining).to.equal(0n);
  });
});
