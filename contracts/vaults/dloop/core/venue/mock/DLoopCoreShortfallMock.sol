// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DLoopCoreMock.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";

// Custom errors for gas optimization
error MockBorrowAmountTooSmall(uint256 amount);
error MockWithdrawAmountTooSmall(uint256 amount);
error MockPoolLacksLiquidity(uint256 requested, uint256 available);
error MockPoolLacksCollateral(uint256 requested, uint256 available);

/**
 * @title DLoopCoreShortfallMock
 * @dev Simulates a lending adapter that always returns **1 wei less** than requested
 *      on both borrow and withdraw operations.  Useful for reproducing the rounding
 *      shortfall DoS in deposit/withdraw flows.
 */
contract DLoopCoreShortfallMock is DLoopCoreMock {
    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _collateralToken,
        ERC20 _debtToken,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps,
        uint256 _minDeviationBps,
        uint256 _withdrawalFeeBps,
        address _mockPool
    )
        DLoopCoreMock(
            _name,
            _symbol,
            _collateralToken,
            _debtToken,
            _targetLeverageBps,
            _lowerBoundTargetLeverageBps,
            _upperBoundTargetLeverageBps,
            _maxSubsidyBps,
            _minDeviationBps,
            _withdrawalFeeBps,
            _mockPool
        )
    {}

    /**
     * @inheritdoc DLoopCoreMock
     * @dev Transfers `amount - 1` wei from the pool when borrowing.
     */
    function _borrowFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual override {
        _checkRequiredAllowance();
        if (amount <= 1) revert MockBorrowAmountTooSmall(amount);
        uint256 sendAmount = amount - 1;
        uint256 poolBalance = ERC20(token).balanceOf(mockPool);
        if (poolBalance < sendAmount)
            revert MockPoolLacksLiquidity(sendAmount, poolBalance);
        ERC20(token).transferFrom(mockPool, onBehalfOf, sendAmount);
        transferPortionBps = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        _setMockDebt(onBehalfOf, token, sendAmount);
    }

    /**
     * @inheritdoc DLoopCoreMock
     * @dev Transfers `amount - 1` wei from the pool when withdrawing collateral.
     */
    function _withdrawFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual override {
        _checkRequiredAllowance();
        if (amount <= 1) revert MockWithdrawAmountTooSmall(amount);
        uint256 sendAmount = amount - 1;
        uint256 poolBalance = ERC20(token).balanceOf(mockPool);
        if (poolBalance < sendAmount)
            revert MockPoolLacksCollateral(sendAmount, poolBalance);
        ERC20(token).transferFrom(mockPool, onBehalfOf, sendAmount);
        transferPortionBps = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
        // For testing we don't keep collateral accounting exact.
    }
}
