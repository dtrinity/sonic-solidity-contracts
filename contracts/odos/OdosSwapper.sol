// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "./OdosSwapUtils.sol";
import "./interface/IOdosRouterV2.sol";
import "@rari-capital/solmate/src/utils/SafeTransferLib.sol";

/**
 * @title OdosSwapper
 * @notice Contract for executing Odos swaps using OdosSwapUtils library
 */
contract OdosSwapper {
    using OdosSwapUtils for *;
    using SafeTransferLib for ERC20;

    IOdosRouterV2 public immutable router;

    constructor(address _router) {
        router = IOdosRouterV2(payable(_router));
    }

    /**
     * @notice Performs an swap operation using Odos router with swap data
     * @param inputToken Input token
     * @param maxIn Maximum input amount
     * @param exactOut Exact output amount
     * @param swapData Encoded swap path data
     */
    function executeSwapOperation(
        address inputToken,
        uint256 maxIn,
        uint256 exactOut,
        bytes calldata swapData
    ) external {
        ERC20(inputToken).safeTransferFrom(msg.sender, address(this), maxIn);
        OdosSwapUtils.excuteSwapOperation(
            router,
            inputToken,
            maxIn,
            exactOut,
            swapData
        );
    }
}
