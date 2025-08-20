// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC3156FlashBorrower} from "../interface/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "../interface/IERC3156FlashLender.sol";
import {IERC20} from "../interface/IERC20.sol";
import {IDLoopCoreDLend} from "../interface/IDLoopCoreDLend.sol";

abstract contract RewardCompounderDLendBase is IERC3156FlashBorrower {
    event RewardCompounded(uint256 shares, uint256 netReward);
    event FlashRepaid(uint256 amount, uint256 fee);
    event Profit(uint256 realized);

    error InvalidLender();
    error InvalidToken();
    error Slippage();
    error ExchangeThresholdNotMet(uint256 got, uint256 need);
    error DepositDisabled();
    error NotEnoughForRepay(uint256 balance, uint256 needed);

    IERC20 public immutable dusd;
    IERC20 public immutable collateral;
    IDLoopCoreDLend public immutable core;
    IERC3156FlashLender public immutable lender;

    constructor(
        IERC20 _dusd,
        IERC20 _collateral,
        IDLoopCoreDLend _core,
        IERC3156FlashLender _lender
    ) {
        dusd = _dusd;
        collateral = _collateral;
        core = _core;
        lender = _lender;
    }

    function run(uint256 flashAmount, bytes calldata swapData, uint256 minCollateralOut) external {
        if (core.maxDeposit(address(this)) == 0) revert DepositDisabled();
        lender.flashLoan(address(this), address(dusd), flashAmount, abi.encode(swapData, minCollateralOut));
    }

    function onFlashLoan(
        address,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32) {
        if (msg.sender != address(lender)) revert InvalidLender();
        if (token != address(dusd)) revert InvalidToken();

        (bytes memory swapData, uint256 minCollateralOut) = abi.decode(data, (bytes, uint256));

        // Swap dUSD -> collateral
        uint256 out = _swapExactIn(amount, minCollateralOut, swapData);
        if (out < minCollateralOut) revert Slippage();

        // Deposit collateral to mint shares and receive K dUSD from core
        uint256 sharesPreview = core.previewDeposit(out);
        if (sharesPreview < core.exchangeThreshold()) {
            revert ExchangeThresholdNotMet(sharesPreview, core.exchangeThreshold());
        }

        _approveIfNeeded(collateral, address(core), out);
        uint256 shares = core.deposit(out, address(this));

        // Approve shares to core and claim rewards via compoundRewards
        _approveIfNeeded(IERC20(address(core)), address(core), shares);
        address[] memory rewardTokens = new address[](1);
        rewardTokens[0] = address(dusd);
        uint256 beforeBal = dusd.balanceOf(address(this));
        core.compoundRewards(shares, rewardTokens, address(this));
        uint256 afterBal = dusd.balanceOf(address(this));
        uint256 netReward = afterBal - beforeBal;
        emit RewardCompounded(shares, netReward);

        // Repay flash
        uint256 repay = amount + fee;
        uint256 bal = dusd.balanceOf(address(this));
        if (bal < repay) revert NotEnoughForRepay(bal, repay);
        _approveIfNeeded(dusd, address(lender), repay);
        emit FlashRepaid(amount, fee);

        // Profit = current balance - repay
        uint256 profitAmt = bal - repay;
        emit Profit(profitAmt);

        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    function _approveIfNeeded(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) < amount) {
            token.approve(spender, type(uint256).max);
        }
    }

    function _swapExactIn(uint256 dusdIn, uint256 minOut, bytes memory swapData) internal virtual returns (uint256);
}

