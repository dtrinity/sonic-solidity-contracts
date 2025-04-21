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
        IAToken _aDUSD,
        uint256 _slippageTolerance,
        IOdosRouterV2 _odosRouter
    )
        FlashMintLiquidatorAaveBorrowRepayBase(
            _flashMinter,
            _addressesProvider,
            _liquidateLender,
            _aDUSD,
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
        uint256 amountOut = OdosSwapUtils.excuteSwapOperation(
            odosRouter,
            _inputToken,
            _maxIn,
            _amount,
            _swapData
        );

        // Overflow protection
        if (amountOut < _amount) {
            revert InsufficientOutputAfterSwap(amountOut, _amount);
        }

        // We already make sure amountOut is greater than _amount in swap operation, so we can just subtract the amount
        uint256 leftover = amountOut - _amount;

        // Transfer the leftover to the caller
        ERC20(_outputToken).safeTransfer(msg.sender, leftover);

        return amountOut;
    }
}
