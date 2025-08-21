// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "../interfaces/IERC20.sol";
import { IERC3156FlashBorrower, IERC3156FlashLender } from "../interfaces/IERC3156.sol";
import { IDLoopCoreDLend } from "../interfaces/IDLoopCoreDLend.sol";

/// @title RewardCompounderDLendBase
/// @notice Base flashloan-based periphery to compound DLoopCoreDLend rewards
abstract contract RewardCompounderDLendBase is IERC3156FlashBorrower {
    IERC20 public immutable DUSD;
    IERC20 public immutable COLLATERAL;
    IERC3156FlashLender public immutable FLASH;
    IDLoopCoreDLend public immutable CORE;
    address public immutable SWAP_AGG;

    bytes32 internal constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    event RunStarted(uint256 sharesTarget, uint256 flashAmount);
    event SwapExecuted(uint256 spentDUSD, uint256 gotCollateral);
    event Minted(uint256 sharesMinted, uint256 assetsUsed, uint256 kBorrowed);
    event Compounded(uint256 netDUSDReward);
    event FlashRepaid(uint256 totalDebt);
    event RunProfit(int256 profit);

    error InvalidLender();
    error InvalidToken();
    error ZeroThreshold();
    error DepositDisabled();
    error SwapFailed();
    error InsufficientCollateral();
    error NotEnoughToRepay();

    constructor(address _dusd, address _collateral, address _flash, address _core, address _swapAgg) {
        require(
            _dusd != address(0) && _collateral != address(0) && _flash != address(0) && _core != address(0) && _swapAgg != address(0),
            "bad params"
        );
        DUSD = IERC20(_dusd);
        COLLATERAL = IERC20(_collateral);
        FLASH = IERC3156FlashLender(_flash);
        CORE = IDLoopCoreDLend(_core);
        SWAP_AGG = _swapAgg;
    }

    /// @notice Execute one compounding attempt via flashloan
    /// @param swapCalldata venue-specific calldata to perform exact-out swap dUSD->collateral
    /// @param flashAmount dUSD amount to borrow from flash lender
    /// @param slippageBps buffer to increase required collateral target
    function run(bytes calldata swapCalldata, uint256 flashAmount, uint256 slippageBps) external {
        require(slippageBps <= 10_000, "slippage too high");
        if (CORE.maxDeposit(address(this)) == 0) revert DepositDisabled();

        uint256 S = CORE.exchangeThreshold();
        if (S == 0) revert ZeroThreshold();

        uint256 requiredCollateral = CORE.previewMint(S);
        uint256 bufferedCollateral = (requiredCollateral * (10_000 + slippageBps)) / 10_000;

        emit RunStarted(S, flashAmount);
        bytes memory data = abi.encode(swapCalldata, bufferedCollateral, S);
        bool ok = FLASH.flashLoan(address(this), address(DUSD), flashAmount, data);
        require(ok, "flashLoan failed");
    }

    /// @inheritdoc IERC3156FlashBorrower
    function onFlashLoan(
        address /*initiator*/,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external override returns (bytes32) {
        if (msg.sender != address(FLASH)) revert InvalidLender();
        if (token != address(DUSD)) revert InvalidToken();

        (bytes memory swapCalldata, uint256 collateralTarget, uint256 S) = abi.decode(data, (bytes, uint256, uint256));

        uint256 dusdBefore = DUSD.balanceOf(address(this));
        // Swap dUSD -> COLLATERAL using SWAP_AGG with provided calldata
        require(DUSD.approve(SWAP_AGG, amount), "approve fail");
        (bool ok, ) = SWAP_AGG.call(swapCalldata);
        if (!ok) revert SwapFailed();

        uint256 got = COLLATERAL.balanceOf(address(this));
        if (got < collateralTarget) revert InsufficientCollateral();
        uint256 spent = dusdBefore - DUSD.balanceOf(address(this));
        emit SwapExecuted(spent, got);

        // Mint exactly S shares
        require(COLLATERAL.approve(address(CORE), got), "approve core fail");
        uint256 dusdBeforeMint = DUSD.balanceOf(address(this));
        uint256 minted = CORE.mint(S, address(this));
        require(minted == S, "mint mismatch");
        uint256 kBorrowed = DUSD.balanceOf(address(this)) - dusdBeforeMint;
        emit Minted(minted, got, kBorrowed);

        // Compound rewards: burn shares and receive dUSD net rewards
        require(IERC20(address(CORE)).approve(address(CORE), S), "approve share fail");
        address[] memory rewardTokens = new address[](1);
        rewardTokens[0] = address(DUSD);
        uint256 dusdBeforeCompound = DUSD.balanceOf(address(this));
        CORE.compoundRewards(S, rewardTokens, address(this));
        uint256 netReward = DUSD.balanceOf(address(this)) - dusdBeforeCompound;
        emit Compounded(netReward);

        uint256 totalDebt = amount + fee;
        uint256 bal = DUSD.balanceOf(address(this));
        if (bal < totalDebt) revert NotEnoughToRepay();
        require(DUSD.approve(address(FLASH), totalDebt), "approve flash fail");
        emit FlashRepaid(totalDebt);

        emit RunProfit(int256(bal) - int256(totalDebt));
        return CALLBACK_SUCCESS;
    }
}

