# Step 06: Implement Mock Contracts for Testing

## Objective

Create mock contracts to enable testing without external dependencies (Odos, DLend rewards system).

## Implementation Tasks

### 1. Create Mock DLend Core Contract

#### bot-solidity-contracts/contracts/mocks/DLoopCoreMock.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IDLoopCoreDLend.sol";

/**
 * @title DLoopCoreMock
 * @notice Mock implementation of DLoopCoreDLend for testing
 * @dev Provides controlled behavior for testing reward compounding
 */
contract DLoopCoreMock is IDLoopCoreDLend, ERC20, Ownable {
    /// @notice Mock reward claimable contract
    address public rewardClaimable;

    /// @notice Mock collateral token
    address public collateralToken;

    /// @notice Exchange threshold
    uint256 public exchangeThreshold;

    /// @notice Maximum deposit amount
    uint256 public maxDepositAmount = type(uint256).max;

    /// @notice Mock reward amount per share
    uint256 public rewardPerShare = 1000 * 1e18; // 1000 dUSD per share

    /// @notice Events
    event CompoundRewardsCalled(
        uint256 sharesAmount,
        address[] rewardTokens,
        address receiver,
        uint256 rewardAmount
    );

    event MintCalled(uint256 shares, address receiver, uint256 collateralUsed);

    /// @notice Errors
    error DepositDisabled();
    error InsufficientShares();

    constructor(
        address _rewardClaimable,
        address _collateralToken,
        uint256 _exchangeThreshold
    ) ERC20("DLoop Shares", "DLOOP") {
        rewardClaimable = _rewardClaimable;
        collateralToken = _collateralToken;
        exchangeThreshold = _exchangeThreshold;
    }

    /**
     * @notice Set exchange threshold
     */
    function setExchangeThreshold(uint256 _threshold) external onlyOwner {
        exchangeThreshold = _threshold;
    }

    /**
     * @notice Set reward per share
     */
    function setRewardPerShare(uint256 _reward) external onlyOwner {
        rewardPerShare = _reward;
    }

    /**
     * @notice Set max deposit amount
     */
    function setMaxDeposit(uint256 _max) external onlyOwner {
        maxDepositAmount = _max;
    }

    /**
     * @notice Get max deposit amount
     */
    function maxDeposit(address) external view returns (uint256) {
        return maxDepositAmount;
    }

    /**
     * @notice Preview mint - calculate collateral required for shares
     */
    function previewMint(uint256 shares) external pure returns (uint256) {
        return shares * 1e18; // 1:1 ratio for simplicity
    }

    /**
     * @notice Preview deposit - calculate shares for collateral
     */
    function previewDeposit(uint256 assets) external pure returns (uint256) {
        return assets / 1e18;
    }

    /**
     * @notice Mint shares by depositing collateral
     */
    function mint(uint256 shares, address receiver) external returns (uint256) {
        uint256 collateralRequired = shares * 1e18;

        // Transfer collateral from caller
        IERC20(collateralToken).transferFrom(msg.sender, address(this), collateralRequired);

        // Mint shares
        _mint(receiver, shares);

        emit MintCalled(shares, receiver, collateralRequired);

        return shares;
    }

    /**
     * @notice Deposit collateral to mint shares
     */
    function deposit(uint256 assets, address receiver) external returns (uint256) {
        uint256 shares = assets / 1e18;
        require(mint(shares, receiver) == shares, "Mint failed");
        return shares;
    }

    /**
     * @notice Mock compound rewards function
     */
    function compoundRewards(
        uint256 amount,
        address[] calldata rewardTokens,
        address receiver
    ) external {
        require(amount >= exchangeThreshold, "Below exchange threshold");
        require(balanceOf(msg.sender) >= amount, "Insufficient shares");

        // Burn shares
        _burn(msg.sender, amount);

        // Calculate and mint rewards
        uint256 rewardAmount = amount * rewardPerShare / 1e18;

        // Mock: assume rewardTokens[0] is dUSD and mint it to receiver
        if (rewardTokens.length > 0) {
            // In real implementation, this would claim from external rewards controller
            // For mock, we'll just emit the event
        }

        emit CompoundRewardsCalled(amount, rewardTokens, receiver, rewardAmount);
    }
}
```

### 2. Create Mock Flash Lender Contract

#### bot-solidity-contracts/contracts/mocks/MockFlashLender.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC3156FlashLender.sol";
import "../interfaces/IERC3156FlashBorrower.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockFlashLender
 * @notice Mock ERC3156 flash lender for testing
 * @dev Provides flash loans with configurable fees
 */
contract MockFlashLender is IERC3156FlashLender, Ownable {
    /// @notice Flash loan fee in basis points (e.g., 10 = 0.1%)
    uint256 public flashFeeBps = 10;

    /// @notice Maximum flash loan amounts per token
    mapping(address => uint256) public maxFlashLoan;

    /// @notice Events
    event FlashLoanExecuted(
        address indexed borrower,
        address indexed token,
        uint256 amount,
        uint256 fee
    );

    /// @notice Errors
    error UnsupportedToken();
    error InsufficientLiquidity();

    constructor() {
        // Default max loan amounts
        maxFlashLoan[address(0x1234567890123456789012345678901234567890)] = 1000000 * 1e18; // Mock dUSD
    }

    /**
     * @notice Set flash loan fee
     */
    function setFlashFee(uint256 _feeBps) external onlyOwner {
        flashFeeBps = _feeBps;
    }

    /**
     * @notice Set maximum flash loan for a token
     */
    function setMaxFlashLoan(address token, uint256 amount) external onlyOwner {
        maxFlashLoan[token] = amount;
    }

    /**
     * @notice Get maximum flash loan amount
     */
    function maxFlashLoan(address token) external view returns (uint256) {
        return maxFlashLoan[token];
    }

    /**
     * @notice Get flash loan fee
     */
    function flashFee(address token, uint256 amount) external view returns (uint256) {
        return amount * flashFeeBps / 10000;
    }

    /**
     * @notice Execute flash loan
     */
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool) {
        uint256 maxLoan = maxFlashLoan[token];
        if (maxLoan == 0) {
            revert UnsupportedToken();
        }
        if (amount > maxLoan) {
            revert InsufficientLiquidity();
        }

        uint256 fee = this.flashFee(token, amount);

        // Transfer tokens to borrower
        IERC20(token).transfer(address(receiver), amount);

        // Call borrower callback
        bytes32 callbackResult = receiver.onFlashLoan(
            msg.sender,
            token,
            amount,
            fee,
            data
        );

        // Verify callback result
        if (callbackResult != keccak256("ERC3156FlashBorrower.onFlashLoan")) {
            revert("Invalid callback result");
        }

        // Transfer fee from borrower
        IERC20(token).transferFrom(address(receiver), address(this), fee);

        emit FlashLoanExecuted(address(receiver), token, amount, fee);

        return true;
    }

    /**
     * @notice Withdraw accumulated fees
     */
    function withdrawFees(address token, address to) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(to, balance);
    }
}
```

### 3. Create Mock Odos Router

#### bot-solidity-contracts/contracts/mocks/MockOdosRouter.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockOdosRouter
 * @notice Mock Odos router for testing swap functionality
 * @dev Simulates Odos swap behavior with configurable rates
 */
contract MockOdosRouter is Ownable {
    /// @notice Exchange rate (output per input token, scaled by 1e18)
    mapping(address => mapping(address => uint256)) public exchangeRates;

    /// @notice Swap fee in basis points
    uint256 public swapFeeBps = 30; // 0.3%

    /// @notice Events
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    /// @notice Errors
    error InsufficientInput();
    error SwapFailed();

    constructor() {
        // Set default exchange rates
        // 1 dUSD = 1 sfrxUSD (1:1)
        exchangeRates[address(0x123), address(0x456)] = 1e18;
        exchangeRates[address(0x456), address(0x123)] = 1e18;
    }

    /**
     * @notice Set exchange rate between two tokens
     */
    function setExchangeRate(
        address tokenIn,
        address tokenOut,
        uint256 rate
    ) external onlyOwner {
        exchangeRates[tokenIn][tokenOut] = rate;
    }

    /**
     * @notice Set swap fee
     */
    function setSwapFee(uint256 _feeBps) external onlyOwner {
        swapFeeBps = _feeBps;
    }

    /**
     * @notice Execute swap (mock implementation)
     */
    function executeSwap(bytes calldata swapData) external {
        // Decode swap data (simplified)
        // In real Odos, this would contain complex routing data
        (address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) =
            abi.decode(swapData, (address, address, uint256, uint256));

        if (amountIn == 0) {
            revert InsufficientInput();
        }

        // Transfer input tokens from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output amount
        uint256 rate = exchangeRates[tokenIn][tokenOut];
        if (rate == 0) {
            revert SwapFailed();
        }

        uint256 grossAmountOut = amountIn * rate / 1e18;
        uint256 fee = grossAmountOut * swapFeeBps / 10000;
        uint256 netAmountOut = grossAmountOut - fee;

        if (netAmountOut < minAmountOut) {
            revert SwapFailed();
        }

        // Transfer output tokens to caller
        IERC20(tokenOut).transfer(msg.sender, netAmountOut);

        emit SwapExecuted(tokenIn, tokenOut, amountIn, netAmountOut, fee);
    }

    /**
     * @notice Fallback function to handle arbitrary swap calls
     */
    fallback() external payable {
        // Mock successful swap
        emit SwapExecuted(address(0), address(0), 0, 0, 0);
    }

    receive() external payable {}
}
```

### 4. Create Mock Reward Claimable Contract

#### bot-solidity-contracts/contracts/mocks/MockRewardClaimable.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRewardClaimable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockRewardClaimable
 * @notice Mock reward claimable contract for testing
 * @dev Simulates reward claiming with configurable parameters
 */
contract MockRewardClaimable is IRewardClaimable, Ownable {
    /// @notice Treasury fee basis points
    uint256 public treasuryFeeBps = 500; // 5%

    /// @notice Exchange threshold
    uint256 public exchangeThreshold = 1000 * 1e18;

    /// @notice Total rewards claimed
    uint256 public totalRewardsClaimed;

    /// @notice Events
    event RewardsClaimed(uint256 amount, uint256 treasuryFee);

    /**
     * @notice Set treasury fee
     */
    function setTreasuryFeeBps(uint256 _feeBps) external onlyOwner {
        treasuryFeeBps = _feeBps;
    }

    /**
     * @notice Set exchange threshold
     */
    function setExchangeThreshold(uint256 _threshold) external onlyOwner {
        exchangeThreshold = _threshold;
    }

    /**
     * @notice Get treasury fee for amount
     */
    function getTreasuryFee(uint256 amount) external view returns (uint256) {
        return amount * treasuryFeeBps / 10000;
    }

    /**
     * @notice Mock claim rewards (simplified)
     */
    function claimRewards(uint256 amount) external {
        uint256 treasuryFee = this.getTreasuryFee(amount);
        uint256 netReward = amount - treasuryFee;

        totalRewardsClaimed += netReward;

        emit RewardsClaimed(netReward, treasuryFee);
    }
}
```

### 5. Create Test Token Contracts

#### bot-solidity-contracts/contracts/mocks/MockToken.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockToken
 * @notice Mock ERC20 token for testing
 * @dev Mintable token with faucet functionality
 */
contract MockToken is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }

    /**
     * @notice Mint tokens to address
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Faucet function for testing
     */
    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
```

### 6. Create Mock Reward Quote Helper

#### bot-solidity-contracts/contracts/mocks/RewardQuoteHelperMock.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../base/RewardQuoteHelperBase.sol";

/**
 * @title RewardQuoteHelperMock
 * @notice Mock reward quote helper for testing
 * @dev Provides controlled reward quoting for test scenarios
 */
contract RewardQuoteHelperMock is RewardQuoteHelperBase {
    /// @notice Mock gross reward per share
    uint256 public mockGrossRewardPerShare = 1000 * 1e18;

    /// @notice Mock flash fee
    uint256 public mockFlashFee = 1 * 1e18; // 1 dUSD

    constructor(
        address _dloopCore,
        address _rewardClaimable
    ) RewardQuoteHelperBase(_dloopCore, _rewardClaimable) {}

    /**
     * @notice Set mock gross reward per share
     */
    function setMockGrossRewardPerShare(uint256 _reward) external {
        mockGrossRewardPerShare = _reward;
    }

    /**
     * @notice Set mock flash fee
     */
    function setMockFlashFee(uint256 _fee) external {
        mockFlashFee = _fee;
    }

    /**
     * @notice Get expected rewards (mock implementation)
     */
    function _getExpectedRewards(
        uint256 sharesAmount
    ) internal view override returns (uint256 grossRewards, uint256 netRewards) {
        grossRewards = sharesAmount * mockGrossRewardPerShare / 1e18;
        uint256 treasuryFee = rewardClaimable.getTreasuryFee(grossRewards);
        netRewards = grossRewards - treasuryFee;

        return (grossRewards, netRewards);
    }

    /**
     * @notice Calculate flash requirements (mock implementation)
     */
    function _calculateFlashRequirements(
        uint256 collateralAmount,
        uint256 slippageBps
    ) internal view override returns (uint256 flashAmount, uint256 flashFee) {
        // Simplified calculation for testing
        flashAmount = collateralAmount; // Assume 1:1 ratio
        flashFee = mockFlashFee;

        return (flashAmount, flashFee);
    }
}
```

## Acceptance Criteria

- ✅ All mock contracts implement required interfaces
- ✅ Mock contracts provide controllable behavior for testing
- ✅ Mock contracts compile without errors
- ✅ Test token contracts created with minting capabilities
- ✅ Mock contracts isolate external dependencies
- ✅ Proper error handling in mock contracts

## Next Steps

Proceed to Step 07: Create Hardhat tests for contracts.
