# Step 07: Create Hardhat Tests for Contracts

## Objective

Create comprehensive Hardhat tests for all Solidity contracts using mock contracts to ensure functionality works correctly.

## Implementation Tasks

### 1. Test Structure Setup

#### bot-solidity-contracts/test/RewardCompounderDLendOdos.test.ts

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomiclabs/hardhat-ethers/internal/helpers";

describe("RewardCompounderDLendOdos", function () {
  async function deployContractsFixture() {
    const [owner, user] = await ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    const dusd = await MockToken.deploy("dUSD", "DUSD", ethers.utils.parseEther("1000000"));
    const sfrxUSD = await MockToken.deploy("sfrxUSD", "SFRXUSD", ethers.utils.parseEther("1000000"));

    // Deploy mock contracts
    const MockRewardClaimable = await ethers.getContractFactory("MockRewardClaimable");
    const rewardClaimable = await MockRewardClaimable.deploy();

    const MockFlashLender = await ethers.getContractFactory("MockFlashLender");
    const flashLender = await MockFlashLender.deploy();

    const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");
    const dloopCore = await DLoopCoreMock.deploy(
      rewardClaimable.address,
      sfrxUSD.address,
      ethers.utils.parseEther("1000")
    );

    const MockOdosRouter = await ethers.getContractFactory("MockOdosRouter");
    const odosRouter = await MockOdosRouter.deploy();

    // Deploy main contract
    const RewardCompounderDLendOdos = await ethers.getContractFactory("RewardCompounderDLendOdos");
    const compounder = await RewardCompounderDLendOdos.deploy(
      dloopCore.address,
      rewardClaimable.address,
      flashLender.address,
      dusd.address,
      sfrxUSD.address,
      odosRouter.address
    );

    // Setup initial state
    await dusd.mint(flashLender.address, ethers.utils.parseEther("100000"));
    await sfrxUSD.mint(user.address, ethers.utils.parseEther("10000"));
    await flashLender.setMaxFlashLoan(dusd.address, ethers.utils.parseEther("100000"));

    return {
      compounder,
      dloopCore,
      rewardClaimable,
      flashLender,
      odosRouter,
      dusd,
      sfrxUSD,
      owner,
      user
    };
  }

  describe("Deployment", function () {
    it("Should deploy successfully with correct parameters", async function () {
      const { compounder, dloopCore, rewardClaimable, flashLender, dusd, sfrxUSD } = await loadFixture(deployContractsFixture);

      expect(await compounder.dloopCore()).to.equal(dloopCore.address);
      expect(await compounder.rewardClaimable()).to.equal(rewardClaimable.address);
      expect(await compounder.flashLender()).to.equal(flashLender.address);
      expect(await compounder.dusd()).to.equal(dusd.address);
      expect(await compounder.collateral()).to.equal(sfrxUSD.address);
    });
  });

  describe("Configuration", function () {
    it("Should allow owner to set max slippage", async function () {
      const { compounder, owner } = await loadFixture(deployContractsFixture);

      await expect(compounder.connect(owner).setMaxSlippage(100))
        .to.emit(compounder, "MaxSlippageUpdated")
        .withArgs(50, 100);

      expect(await compounder.maxSlippageBps()).to.equal(100);
    });

    it("Should reject invalid slippage values", async function () {
      const { compounder, owner } = await loadFixture(deployContractsFixture);

      await expect(compounder.connect(owner).setMaxSlippage(1100))
        .to.be.revertedWith("Slippage too high");
    });
  });

  describe("View Functions", function () {
    it("Should return correct exchange threshold", async function () {
      const { compounder, rewardClaimable } = await loadFixture(deployContractsFixture);

      expect(await compounder.getExchangeThreshold()).to.equal(await rewardClaimable.exchangeThreshold());
    });

    it("Should return correct treasury fee", async function () {
      const { compounder, rewardClaimable } = await loadFixture(deployContractsFixture);

      expect(await compounder.getTreasuryFeeBps()).to.equal(await rewardClaimable.treasuryFeeBps());
    });

    it("Should check deposit allowance correctly", async function () {
      const { compounder } = await loadFixture(deployContractsFixture);

      expect(await compounder.isDepositAllowed()).to.be.true;
    });
  });

  describe("Reward Compounding", function () {
    it("Should revert when deposits are disabled", async function () {
      const { compounder, dloopCore, owner } = await loadFixture(deployContractsFixture);

      await dloopCore.setMaxDeposit(0);

      await expect(compounder.compoundRewards(
        ethers.utils.parseEther("1000"),
        "0x",
        50
      )).to.be.revertedWith("DepositDisabled");
    });

    it("Should revert when slippage is too high", async function () {
      const { compounder } = await loadFixture(deployContractsFixture);

      await expect(compounder.compoundRewards(
        ethers.utils.parseEther("1000"),
        "0x",
        100 // Above max slippage of 50
      )).to.be.revertedWith("SlippageTooHigh");
    });

    it("Should execute successful compounding cycle", async function () {
      const { compounder, dusd, user } = await loadFixture(deployContractsFixture);

      // Prepare swap data (mock)
      const swapData = ethers.utils.defaultAbiCoder.encode(
        ["address", "address", "uint256", "uint256"],
        [dusd.address, ethers.constants.AddressZero, ethers.utils.parseEther("1000"), 0]
      );

      // Execute compounding
      await expect(compounder.compoundRewards(
        ethers.utils.parseEther("1000"),
        swapData,
        50
      )).to.emit(compounder, "RewardCompounded");

      // Verify results
      // (Add specific assertions based on expected behavior)
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to withdraw stuck tokens", async function () {
      const { compounder, dusd, owner } = await loadFixture(deployContractsFixture);

      // Send tokens to contract
      await dusd.mint(compounder.address, ethers.utils.parseEther("100"));

      const initialBalance = await dusd.balanceOf(owner.address);

      await compounder.emergencyWithdraw(
        dusd.address,
        owner.address,
        ethers.utils.parseEther("100")
      );

      expect(await dusd.balanceOf(owner.address)).to.equal(initialBalance.add(ethers.utils.parseEther("100")));
    });
  });
});
```

#### bot-solidity-contracts/test/RewardQuoteHelperDLend.test.ts

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomiclabs/hardhat-ethers/internal/helpers";

describe("RewardQuoteHelperDLend", function () {
  async function deployContractsFixture() {
    const [owner] = await ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockToken");
    const dusd = await MockToken.deploy("dUSD", "DUSD", ethers.utils.parseEther("1000000"));

    // Deploy mock contracts
    const MockRewardClaimable = await ethers.getContractFactory("MockRewardClaimable");
    const rewardClaimable = await MockRewardClaimable.deploy();

    const MockFlashLender = await ethers.getContractFactory("MockFlashLender");
    const flashLender = await MockFlashLender.deploy();

    const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");
    const dloopCore = await DLoopCoreMock.deploy(
      rewardClaimable.address,
      dusd.address,
      ethers.utils.parseEther("1000")
    );

    // Deploy main contract
    const RewardQuoteHelperDLend = await ethers.getContractFactory("RewardQuoteHelperDLend");
    const quoteHelper = await RewardQuoteHelperDLend.deploy(
      dloopCore.address,
      rewardClaimable.address,
      flashLender.address,
      dusd.address
    );

    return {
      quoteHelper,
      dloopCore,
      rewardClaimable,
      flashLender,
      dusd,
      owner
    };
  }

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      const { quoteHelper } = await loadFixture(deployContractsFixture);

      expect(quoteHelper.address).to.be.properAddress;
    });
  });

  describe("Reward Quotes", function () {
    it("Should generate valid reward quote", async function () {
      const { quoteHelper } = await loadFixture(deployContractsFixture);

      const sharesAmount = ethers.utils.parseEther("1000");
      const slippageBps = 50;

      const quote = await quoteHelper.getRewardQuote(sharesAmount, slippageBps);

      expect(quote.sharesAmount).to.equal(sharesAmount);
      expect(quote.isProfitable).to.be.a("boolean");
      expect(quote.expectedRewards).to.be.a("string");
      expect(quote.estimatedProfit).to.be.a("string");
    });

    it("Should use exchange threshold when shares amount is zero", async function () {
      const { quoteHelper, rewardClaimable } = await loadFixture(deployContractsFixture);

      const quote = await quoteHelper.getRewardQuote(0, 50);

      expect(quote.sharesAmount).to.equal(await rewardClaimable.exchangeThreshold());
    });
  });

  describe("Profitability Checks", function () {
    it("Should identify profitable scenarios", async function () {
      const { quoteHelper } = await loadFixture(deployContractsFixture);

      const [isProfitable, profit] = await quoteHelper.isProfitable(
        ethers.utils.parseEther("1000"),
        50
      );

      expect(isProfitable).to.be.a("boolean");
      expect(profit).to.be.a("string");
    });
  });

  describe("Reward Breakdown", function () {
    it("Should provide detailed reward breakdown", async function () {
      const { quoteHelper } = await loadFixture(deployContractsFixture);

      const breakdown = await quoteHelper.getRewardBreakdown(ethers.utils.parseEther("1000"));

      expect(breakdown.grossRewards).to.be.a("string");
      expect(breakdown.treasuryFeeAmount).to.be.a("string");
      expect(breakdown.netRewards).to.be.a("string");
      expect(breakdown.flashFeeAmount).to.be.a("string");
    });
  });

  describe("Configuration", function () {
    it("Should return correct exchange threshold", async function () {
      const { quoteHelper, rewardClaimable } = await loadFixture(deployContractsFixture);

      expect(await quoteHelper.getExchangeThreshold()).to.equal(
        await rewardClaimable.exchangeThreshold()
      );
    });

    it("Should return correct treasury fee", async function () {
      const { quoteHelper, rewardClaimable } = await loadFixture(deployContractsFixture);

      expect(await quoteHelper.getTreasuryFeeBps()).to.equal(
        await rewardClaimable.treasuryFeeBps()
      );
    });
  });
});
```

### 2. Create Base Contract Tests

#### bot-solidity-contracts/test/RewardCompounderDLendBase.test.ts

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomiclabs/hardhat-ethers/internal/helpers";

describe("RewardCompounderDLendBase", function () {
  // Focus on testing abstract functionality
  // Concrete implementations will be tested in venue-specific test files

  it("Should serve as base for concrete implementations", async function () {
    // This is a placeholder - the base contract is abstract
    // and cannot be deployed directly
    expect(true).to.be.true;
  });
});
```

### 3. Create Mock Contract Tests

#### bot-solidity-contracts/test/mocks/MockFlashLender.test.ts

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomiclabs/hardhat-ethers/internal/helpers";

describe("MockFlashLender", function () {
  async function deployFixture() {
    const [owner, borrower] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    const token = await MockToken.deploy("Test Token", "TEST", ethers.utils.parseEther("1000000"));

    const MockFlashLender = await ethers.getContractFactory("MockFlashLender");
    const lender = await MockFlashLender.deploy();

    // Setup
    await token.mint(lender.address, ethers.utils.parseEther("10000"));
    await lender.setMaxFlashLoan(token.address, ethers.utils.parseEther("10000"));

    return { lender, token, owner, borrower };
  }

  describe("Configuration", function () {
    it("Should set flash fee", async function () {
      const { lender } = await loadFixture(deployFixture);

      await lender.setFlashFee(50); // 0.5%
      expect(await lender.flashFeeBps()).to.equal(50);
    });

    it("Should set max flash loan", async function () {
      const { lender, token } = await loadFixture(deployFixture);

      await lender.setMaxFlashLoan(token.address, ethers.utils.parseEther("50000"));
      expect(await lender.maxFlashLoan(token.address)).to.equal(ethers.utils.parseEther("50000"));
    });
  });

  describe("Flash Loans", function () {
    it("Should calculate correct flash fee", async function () {
      const { lender, token } = await loadFixture(deployFixture);

      const amount = ethers.utils.parseEther("1000");
      const fee = await lender.flashFee(token.address, amount);

      expect(fee).to.equal(amount.mul(10).div(10000)); // 0.1% of amount
    });

    it("Should execute flash loan successfully", async function () {
      const { lender, token, borrower } = await loadFixture(deployFixture);

      // Deploy mock borrower
      const MockBorrower = await ethers.getContractFactory("MockFlashBorrower");
      const mockBorrower = await MockBorrower.deploy(lender.address);

      const amount = ethers.utils.parseEther("1000");

      await expect(lender.flashLoan(
        mockBorrower.address,
        token.address,
        amount,
        "0x"
      )).to.emit(lender, "FlashLoanExecuted");
    });
  });
});
```

#### bot-solidity-contracts/test/mocks/DLoopCoreMock.test.ts

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomiclabs/hardhat-ethers/internal/helpers";

describe("DLoopCoreMock", function () {
  async function deployFixture() {
    const [owner, user] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    const collateral = await MockToken.deploy("Collateral", "COLL", ethers.utils.parseEther("1000000"));

    const MockRewardClaimable = await ethers.getContractFactory("MockRewardClaimable");
    const rewardClaimable = await MockRewardClaimable.deploy();

    const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");
    const dloopCore = await DLoopCoreMock.deploy(
      rewardClaimable.address,
      collateral.address,
      ethers.utils.parseEther("1000")
    );

    return { dloopCore, collateral, rewardClaimable, owner, user };
  }

  describe("Configuration", function () {
    it("Should set exchange threshold", async function () {
      const { dloopCore } = await loadFixture(deployFixture);

      await dloopCore.setExchangeThreshold(ethers.utils.parseEther("2000"));
      expect(await dloopCore.exchangeThreshold()).to.equal(ethers.utils.parseEther("2000"));
    });

    it("Should set reward per share", async function () {
      const { dloopCore } = await loadFixture(deployFixture);

      await dloopCore.setRewardPerShare(ethers.utils.parseEther("2000"));
      expect(await dloopCore.rewardPerShare()).to.equal(ethers.utils.parseEther("2000"));
    });
  });

  describe("Mint and Deposit", function () {
    it("Should preview mint correctly", async function () {
      const { dloopCore } = await loadFixture(deployFixture);

      const shares = ethers.utils.parseEther("1000");
      const collateralRequired = await dloopCore.previewMint(shares);

      expect(collateralRequired).to.equal(ethers.utils.parseEther("1000")); // 1:1 ratio
    });

    it("Should mint shares correctly", async function () {
      const { dloopCore, collateral, user } = await loadFixture(deployFixture);

      await collateral.mint(user.address, ethers.utils.parseEther("2000"));
      await collateral.connect(user).approve(dloopCore.address, ethers.utils.parseEther("2000"));

      await expect(dloopCore.connect(user).mint(ethers.utils.parseEther("1000"), user.address))
        .to.emit(dloopCore, "MintCalled");

      expect(await dloopCore.balanceOf(user.address)).to.equal(ethers.utils.parseEther("1000"));
    });
  });

  describe("Compound Rewards", function () {
    it("Should compound rewards successfully", async function () {
      const { dloopCore, user } = await loadFixture(deployFixture);

      // Mint some shares first
      await dloopCore.mint(ethers.utils.parseEther("1000"), user.address);

      const rewardTokens = [ethers.constants.AddressZero]; // Mock reward token

      await expect(dloopCore.connect(user).compoundRewards(
        ethers.utils.parseEther("1000"),
        rewardTokens,
        user.address
      )).to.emit(dloopCore, "CompoundRewardsCalled");

      expect(await dloopCore.balanceOf(user.address)).to.equal(0); // Shares burned
    });

    it("Should reject if below exchange threshold", async function () {
      const { dloopCore, user } = await loadFixture(deployFixture);

      const rewardTokens = [ethers.constants.AddressZero];

      await expect(dloopCore.connect(user).compoundRewards(
        ethers.utils.parseEther("500"), // Below threshold of 1000
        rewardTokens,
        user.address
      )).to.be.revertedWith("Below exchange threshold");
    });
  });
});
```

### 4. Create Test Helper Contracts

#### bot-solidity-contracts/test/helpers/MockFlashBorrower.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../interfaces/IERC3156FlashBorrower.sol";

contract MockFlashBorrower is IERC3156FlashBorrower {
    address public lender;

    constructor(address _lender) {
        lender = _lender;
    }

    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32) {
        // Mock successful callback
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}
```

### 5. Create Shared Test Fixtures

#### bot-solidity-contracts/test/fixtures/deployment.ts

```typescript
import { ethers } from "hardhat";
import { Signers } from "./types";

export async function deployTestEnvironment(): Promise<any> {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user = signers[1];

  // Deploy mock tokens
  const MockToken = await ethers.getContractFactory("MockToken");
  const dusd = await MockToken.deploy("dUSD", "DUSD", ethers.utils.parseEther("1000000"));
  const sfrxUSD = await MockToken.deploy("sfrxUSD", "SFRXUSD", ethers.utils.parseEther("1000000"));

  // Deploy mock infrastructure
  const MockRewardClaimable = await ethers.getContractFactory("MockRewardClaimable");
  const rewardClaimable = await MockRewardClaimable.deploy();

  const MockFlashLender = await ethers.getContractFactory("MockFlashLender");
  const flashLender = await MockFlashLender.deploy();

  const DLoopCoreMock = await ethers.getContractFactory("DLoopCoreMock");
  const dloopCore = await DLoopCoreMock.deploy(
    rewardClaimable.address,
    sfrxUSD.address,
    ethers.utils.parseEther("1000")
  );

  // Deploy main contracts
  const RewardQuoteHelperDLend = await ethers.getContractFactory("RewardQuoteHelperDLend");
  const quoteHelper = await RewardQuoteHelperDLend.deploy(
    dloopCore.address,
    rewardClaimable.address,
    flashLender.address,
    dusd.address
  );

  const RewardCompounderDLendOdos = await ethers.getContractFactory("RewardCompounderDLendOdos");
  const compounder = await RewardCompounderDLendOdos.deploy(
    dloopCore.address,
    rewardClaimable.address,
    flashLender.address,
    dusd.address,
    sfrxUSD.address,
    ethers.constants.AddressZero // Mock Odos
  );

  // Setup initial state
  await dusd.mint(flashLender.address, ethers.utils.parseEther("100000"));
  await flashLender.setMaxFlashLoan(dusd.address, ethers.utils.parseEther("100000"));

  return {
    dusd,
    sfrxUSD,
    rewardClaimable,
    flashLender,
    dloopCore,
    quoteHelper,
    compounder,
    owner,
    user
  };
}
```

## Acceptance Criteria

- ✅ Comprehensive test coverage for all contracts
- ✅ Mock contracts used to isolate external dependencies
- ✅ Tests for successful scenarios and error cases
- ✅ Proper test fixtures and helper functions
- ✅ Tests pass with `npm test` or `make test`
- ✅ Gas usage tests included where appropriate

## Next Steps

Proceed to Step 08: Set up deployment scripts and network configs.
