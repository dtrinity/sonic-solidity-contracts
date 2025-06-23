// SPDX-License-Identifier: GNU AGPLv3
pragma solidity 0.8.20;

import "../odos/interface/IOdosRouterV2.sol";
import "../odos/OdosSwapUtils.sol";
import "./FlashMintLiquidatorAaveBorrowRepayBase.sol";

contract FlashMintLiquidatorAaveBorrowRepayOdos is
    FlashMintLiquidatorAaveBorrowRepayBase
{
    using SafeERC20 for ERC20;

    error InsufficientOutputAfterSwap(uint256 expected, uint256 actual);

    IOdosRouterV2 public immutable odosRouter;

    constructor(
        IERC3156FlashLender _flashMinter,
        ILendingPoolAddressesProvider _addressesProvider,
        ILendingPool _liquidateLender,
        IAToken _aDSTABLE,
        uint256 _slippageTolerance,
        IOdosRouterV2 _odosRouter
    )
        FlashMintLiquidatorAaveBorrowRepayBase(
            _flashMinter,
            _addressesProvider,
            _liquidateLender,
            _aDSTABLE,
            _slippageTolerance
        )
    {
        odosRouter = _odosRouter;
    }

    /// @inheritdoc FlashMintLiquidatorAaveBorrowRepayBase
    function _swapExactOutput(
        address _inputToken,
        address _outputToken,
        bytes memory _swapData,
        uint256 _amount,
        uint256 _maxIn
    ) internal override returns (uint256) {
        uint256 outputBalanceBefore = ERC20(_outputToken).balanceOf(address(this));
        
        uint256 amountSpent = OdosSwapUtils.excuteSwapOperation(
            odosRouter,
            _inputToken,
            _outputToken,
            _maxIn,
            _amount,
            _swapData
        );

        // Calculate actual output received
        uint256 outputBalanceAfter = ERC20(_outputToken).balanceOf(address(this));
        uint256 actualOutputReceived = outputBalanceAfter - outputBalanceBefore;

        // Validation is already done in OdosSwapUtils, but double-check for safety
        if (actualOutputReceived < _amount) {
            revert InsufficientOutputAfterSwap(_amount, actualOutputReceived);
        }

        // Transfer any leftover output to the caller
        if (actualOutputReceived > _amount) {
            uint256 leftover = actualOutputReceived - _amount;
            ERC20(_outputToken).safeTransfer(msg.sender, leftover);
        }

        return amountSpent;
    }
}
